import { Construct } from "constructs";
import { TerraformAsset, AssetType } from "cdktf";
import * as path from "path";

import { LambdaEventSourceMapping } from "@cdktf/provider-aws/lib/lambda-event-source-mapping";
import { LambdaFunction } from "@cdktf/provider-aws/lib/lambda-function";
import { LambdaLayerVersion } from "@cdktf/provider-aws/lib/lambda-layer-version";

import { ApiGatewayRestApi } from "@cdktf/provider-aws/lib/api-gateway-rest-api";
import { ApiGatewayAuthorizer } from "@cdktf/provider-aws/lib/api-gateway-authorizer";
import { ApiGatewayResource } from "@cdktf/provider-aws/lib/api-gateway-resource";
import { ApiGatewayMethod } from "@cdktf/provider-aws/lib/api-gateway-method";
import { ApiGatewayIntegration } from "@cdktf/provider-aws/lib/api-gateway-integration";
import { ApiGatewayMethodResponse } from "@cdktf/provider-aws/lib/api-gateway-method-response";
import { ApiGatewayIntegrationResponse } from "@cdktf/provider-aws/lib/api-gateway-integration-response";
import { ApiGatewayDeployment } from "@cdktf/provider-aws/lib/api-gateway-deployment";
import { ApiGatewayStage } from "@cdktf/provider-aws/lib/api-gateway-stage";

import { Apigatewayv2Api } from "@cdktf/provider-aws/lib/apigatewayv2-api";
import { Apigatewayv2Integration } from "@cdktf/provider-aws/lib/apigatewayv2-integration";
import { Apigatewayv2Route } from "@cdktf/provider-aws/lib/apigatewayv2-route";
import { Apigatewayv2Deployment } from "@cdktf/provider-aws/lib/apigatewayv2-deployment";
import { Apigatewayv2Stage } from "@cdktf/provider-aws/lib/apigatewayv2-stage";

import { SqsQueue } from "@cdktf/provider-aws/lib/sqs-queue";

import { Storage } from "./storage";

export class LambdaDeployment extends Construct {
  constructor(scope: Construct, id: string, storage: Storage) {
    super(scope, id);

    const labRoleArn = "arn:aws:iam::012578104688:role/LabRole";

    // BUCKET DARI STORAGE
    const paymentBucket = storage.bucket;

    // PAYMENT QUEUE RESMI
    const paymentQueue = storage.queue;

    // LAYER
    const layerAsset = new TerraformAsset(this, "lks-layer-asset", {
      path: path.resolve(__dirname, "../../repo/lks-serverless/services/layer"),
      type: AssetType.ARCHIVE,
    });

    const lksLayer = new LambdaLayerVersion(this, "lks-layer", {
      layerName: "lks-layer",
      filename: layerAsset.path,
      compatibleRuntimes: ["nodejs16.x"],
    });

    // HELPER
    const createLambda = (
      name: string,
      handler: string, // e.g. "auth.handler"
      codeDir: string,
      memory: number,
      timeout: number,
      env: Record<string, string> = {},
      layers: string[] = [],
    ) => {
      const dirName = handler.split('.')[0];
      
      const assetPath = path.resolve(
          __dirname,
          `../../repo/lks-serverless/services/${codeDir}/${dirName}`
        );

      const asset = new TerraformAsset(this, `${name}-asset`, {
        path: assetPath,
        type: AssetType.ARCHIVE,
      });

      return new LambdaFunction(this, name, {
        functionName: name,
        runtime: "nodejs16.x",
        handler: "index.handler",
        memorySize: memory,
        timeout,
        role: labRoleArn,
        filename: asset.path,
        environment: { variables: env },
        layers,
      });
    };

    // ORDER QUEUE (dipakai oleh endpoint order)
    const orderQueueDlq = new SqsQueue(this, "lks-order-queue-dlq", {
      name: "lks-order-queue-dlq",
    });

    const orderQueue = new SqsQueue(this, "lks-order-queue", {
      name: "lks-order-queue",
      maxMessageSize: 262144,
      visibilityTimeoutSeconds: 30,
      receiveWaitTimeSeconds: 5,
      messageRetentionSeconds: 345600,
      redrivePolicy: JSON.stringify({
        deadLetterTargetArn: orderQueueDlq.arn,
        maxReceiveCount: 5,
      }),
    });

    // LAMBDA DEFINITIONS
    const lksAuth = createLambda("lks-auth", "auth.handler", "src", 128, 3);
    const lksToken = createLambda("lks-token", "token.handler", "src", 128, 5);

    const lksReadEvent = createLambda("lks-read-event", "eventRead.handler", "src", 128, 5, {}, [
      lksLayer.arn,
    ]);
    const lksWriteEvent = createLambda("lks-write-event", "eventWrite.handler", "src", 256, 5, {}, [
      lksLayer.arn,
    ]);

    const lksTicket = createLambda("lks-ticket", "ticket.handler", "src", 128, 5, {}, [
      lksLayer.arn,
    ]);

    const lksReadOrder = createLambda("lks-read-order", "orderRead.handler", "src", 128, 5, {}, [
      lksLayer.arn,
    ]);

    const lksQueueOrder = createLambda(
      "lks-queue-order",
      "orderQueue.handler",
      "src",
      128,
      3,
      { SQS_QUEUE_URL: orderQueue.url },
      [lksLayer.arn],
    );

    // @ts-ignore
    const lksWriteOrder = createLambda(
      "lks-write-order",
      "orderWrite.handler",
      "src",
      256,
      10,
      { SQS_QUEUE_URL: orderQueue.url },
      [lksLayer.arn],
    );

    new LambdaEventSourceMapping(this, "lks-order-queue-mapping", {
      eventSourceArn: orderQueue.arn,
      functionName: lksWriteOrder.arn,
    });

    // FIX PAYMENT → PAKAI QUEUE DARI STORAGE
    // @ts-ignore
    const lksQueuePayment = createLambda(
      "lks-queue-payment",
      "paymentQueue.handler",
      "src",
      128,
      3,
      { SQS_QUEUE_URL: paymentQueue.url },
      [lksLayer.arn],
    );

    // @ts-ignore
    const lksPayment = createLambda(
      "lks-payment",
      "payment.handler",
      "src",
      256,
      10,
      { SQS_QUEUE_URL: paymentQueue.url },
      [lksLayer.arn],
    );

    new LambdaEventSourceMapping(this, "lks-payment-queue-mapping", {
      eventSourceArn: paymentQueue.arn,
      functionName: lksPayment.arn,
    });

    const lksWebsocket = createLambda(
      "lks-websocket",
      "websocket.handler",
      "src",
      256,
      5,
    );

    // ===============================================
    // REST API GATEWAY
    // ===============================================
    const api = new ApiGatewayRestApi(this, "lks-api", {
      name: "lks-rest-api",
    });

    const authorizer = new ApiGatewayAuthorizer(this, "lks-authorizer", {
      name: "lks-auth",
      restApiId: api.id,
      type: "TOKEN",
      authorizerUri: lksAuth.invokeArn,
      identitySource: "method.request.header.Authorization",
    });

    // CORS HELPERS
    const createCorsOptions = (
      scope: Construct,
      name: string,
      restApiId: string,
      resourceId: string,
    ) => {
      const method = new ApiGatewayMethod(scope, `cors-${name}`, {
        restApiId,
        resourceId,
        httpMethod: "OPTIONS",
        authorization: "NONE",
      });

      const integ = new ApiGatewayIntegration(scope, `cors-int-${name}`, {
        restApiId,
        resourceId,
        httpMethod: "OPTIONS",
        type: "MOCK",
        requestTemplates: {
          "application/json": '{ "statusCode": 200 }',
        },
      });

      const resp = new ApiGatewayMethodResponse(scope, `cors-res-${name}`, {
        restApiId,
        resourceId,
        httpMethod: "OPTIONS",
        statusCode: "200",
        responseParameters: {
          "method.response.header.Access-Control-Allow-Headers": true,
          "method.response.header.Access-Control-Allow-Methods": true,
          "method.response.header.Access-Control-Allow-Origin": true,
        },
      });

      new ApiGatewayIntegrationResponse(scope, `cors-intres-${name}`, {
        restApiId,
        resourceId,
        httpMethod: "OPTIONS",
        statusCode: "200",
        dependsOn: [method, integ, resp],
        responseParameters: {
          "method.response.header.Access-Control-Allow-Headers":
            "'Authorization,Deviceid,Content-Type'",
          "method.response.header.Access-Control-Allow-Methods":
            "'POST,GET,PUT,DELETE,OPTIONS'",
          "method.response.header.Access-Control-Allow-Origin": "'*'",
        },
      });
    };

    const addCorsToMethod = (
      scope: Construct,
      name: string,
      method: ApiGatewayMethod,
    ) => {
      const methodResponse = new ApiGatewayMethodResponse(scope, `mresp-${name}`, {
        restApiId: method.restApiId,
        resourceId: method.resourceId,
        httpMethod: method.httpMethod,
        statusCode: "200",
        responseParameters: {
          "method.response.header.Access-Control-Allow-Origin": true,
        },
      });

      const integrationResponse = new ApiGatewayIntegrationResponse(scope, `intresp-${name}`, {
        restApiId: method.restApiId,
        resourceId: method.resourceId,
        httpMethod: method.httpMethod,
        statusCode: "200",
        responseParameters: {
          "method.response.header.Access-Control-Allow-Origin": "'*'",
        },
      });

      return { methodResponse, integrationResponse };
    };

    // TOKEN
    const tokenResource = new ApiGatewayResource(this, "token-res", {
      restApiId: api.id,
      parentId: api.rootResourceId,
      pathPart: "token",
    });

    const tokenMethod = new ApiGatewayMethod(this, "token-post", {
      restApiId: api.id,
      resourceId: tokenResource.id,
      httpMethod: "POST",
      authorization: "AWS_IAM",
    });

    new ApiGatewayIntegration(this, "token-int", {
      restApiId: api.id,
      resourceId: tokenResource.id,
      httpMethod: "POST",
      integrationHttpMethod: "POST",
      type: "AWS_PROXY",
      uri: lksToken.invokeArn,
    });

    // /event
    const eventResource = new ApiGatewayResource(this, "event-res", {
      restApiId: api.id,
      parentId: api.rootResourceId,
      pathPart: "event",
    });

    createCorsOptions(this, "event", api.id, eventResource.id);

    const eventGetMethod = new ApiGatewayMethod(this, "event-get", {
      restApiId: api.id,
      resourceId: eventResource.id,
      httpMethod: "GET",
      authorization: "CUSTOM",
      authorizerId: authorizer.id,
    });

    new ApiGatewayIntegration(this, "event-get-int", {
      restApiId: api.id,
      resourceId: eventResource.id,
      httpMethod: "GET",
      integrationHttpMethod: "POST",
      type: "AWS_PROXY",
      uri: lksReadEvent.invokeArn,
    });

    addCorsToMethod(this, "event-get", eventGetMethod);

    const eventPostMethod = new ApiGatewayMethod(this, "event-post", {
      restApiId: api.id,
      resourceId: eventResource.id,
      httpMethod: "POST",
      authorization: "CUSTOM",
      authorizerId: authorizer.id,
    });

    new ApiGatewayIntegration(this, "event-post-int", {
      restApiId: api.id,
      resourceId: eventResource.id,
      httpMethod: "POST",
      integrationHttpMethod: "POST",
      type: "AWS_PROXY",
      uri: lksWriteEvent.invokeArn,
    });

    addCorsToMethod(this, "event-post", eventPostMethod);

    const eventPutMethod = new ApiGatewayMethod(this, "event-put", {
      restApiId: api.id,
      resourceId: eventResource.id,
      httpMethod: "PUT",
      authorization: "CUSTOM",
      authorizerId: authorizer.id,
    });

    new ApiGatewayIntegration(this, "event-put-int", {
      restApiId: api.id,
      resourceId: eventResource.id,
      httpMethod: "PUT",
      integrationHttpMethod: "POST",
      type: "AWS_PROXY",
      uri: lksWriteEvent.invokeArn,
    });

    addCorsToMethod(this, "event-put", eventPutMethod);

    // /event/{id}
    const eventIdResource = new ApiGatewayResource(this, "event-id-res", {
      restApiId: api.id,
      parentId: eventResource.id,
      pathPart: "{id}",
    });

    createCorsOptions(this, "event-id", api.id, eventIdResource.id);

    const eventDeleteMethod = new ApiGatewayMethod(this, "event-delete", {
      restApiId: api.id,
      resourceId: eventIdResource.id,
      httpMethod: "DELETE",
      authorization: "CUSTOM",
      authorizerId: authorizer.id,
    });

    new ApiGatewayIntegration(this, "event-delete-int", {
      restApiId: api.id,
      resourceId: eventIdResource.id,
      httpMethod: "DELETE",
      integrationHttpMethod: "POST",
      type: "AWS_PROXY",
      uri: lksWriteEvent.invokeArn,
    });

    addCorsToMethod(this, "event-delete", eventDeleteMethod);

    // /ticket
    const ticketResource = new ApiGatewayResource(this, "ticket-res", {
      restApiId: api.id,
      parentId: api.rootResourceId,
      pathPart: "ticket",
    });

    createCorsOptions(this, "ticket", api.id, ticketResource.id);

    const ticketPostMethod = new ApiGatewayMethod(this, "ticket-post", {
      restApiId: api.id,
      resourceId: ticketResource.id,
      httpMethod: "POST",
      authorization: "CUSTOM",
      authorizerId: authorizer.id,
    });

    new ApiGatewayIntegration(this, "ticket-post-int", {
      restApiId: api.id,
      resourceId: ticketResource.id,
      httpMethod: "POST",
      integrationHttpMethod: "POST",
      type: "AWS_PROXY",
      uri: lksTicket.invokeArn,
    });

    addCorsToMethod(this, "ticket-post", ticketPostMethod);

    const ticketDeleteMethod = new ApiGatewayMethod(this, "ticket-delete", {
      restApiId: api.id,
      resourceId: ticketResource.id,
      httpMethod: "DELETE",
      authorization: "CUSTOM",
      authorizerId: authorizer.id,
    });

    new ApiGatewayIntegration(this, "ticket-delete-int", {
      restApiId: api.id,
      resourceId: ticketResource.id,
      httpMethod: "DELETE",
      integrationHttpMethod: "POST",
      type: "AWS_PROXY",
      uri: lksTicket.invokeArn,
    });

    addCorsToMethod(this, "ticket-delete", ticketDeleteMethod);

    // /ticket/{id}
    const ticketIdResource = new ApiGatewayResource(this, "ticket-id-res", {
      restApiId: api.id,
      parentId: ticketResource.id,
      pathPart: "{id}",
    });

    createCorsOptions(this, "ticket-id", api.id, ticketIdResource.id);

    const ticketIdDeleteMethod = new ApiGatewayMethod(this, "ticket-id-delete", {
      restApiId: api.id,
      resourceId: ticketIdResource.id,
      httpMethod: "DELETE",
      authorization: "CUSTOM",
      authorizerId: authorizer.id,
    });

    new ApiGatewayIntegration(this, "ticket-id-delete-int", {
      restApiId: api.id,
      resourceId: ticketIdResource.id,
      httpMethod: "DELETE",
      integrationHttpMethod: "POST",
      type: "AWS_PROXY",
      uri: lksTicket.invokeArn,
    });

    addCorsToMethod(this, "ticket-id-delete", ticketIdDeleteMethod);

    // /order
    const orderResource = new ApiGatewayResource(this, "order-res", {
      restApiId: api.id,
      parentId: api.rootResourceId,
      pathPart: "order",
    });

    createCorsOptions(this, "order", api.id, orderResource.id);

    const orderGetMethod = new ApiGatewayMethod(this, "order-get", {
      restApiId: api.id,
      resourceId: orderResource.id,
      httpMethod: "GET",
      authorization: "CUSTOM",
      authorizerId: authorizer.id,
    });

    new ApiGatewayIntegration(this, "order-get-int", {
      restApiId: api.id,
      resourceId: orderResource.id,
      httpMethod: "GET",
      integrationHttpMethod: "POST",
      type: "AWS_PROXY",
      uri: lksReadOrder.invokeArn,
    });

    addCorsToMethod(this, "order-get", orderGetMethod);

    const orderPostMethod = new ApiGatewayMethod(this, "order-post", {
      restApiId: api.id,
      resourceId: orderResource.id,
      httpMethod: "POST",
      authorization: "CUSTOM",
      authorizerId: authorizer.id,
    });

    new ApiGatewayIntegration(this, "order-post-int", {
      restApiId: api.id,
      resourceId: orderResource.id,
      httpMethod: "POST",
      integrationHttpMethod: "POST",
      type: "AWS_PROXY",
      uri: lksQueueOrder.invokeArn,
    });

    addCorsToMethod(this, "order-post", orderPostMethod);

    // /payment/{filename}
    const paymentResource = new ApiGatewayResource(this, "payment-res", {
      restApiId: api.id,
      parentId: api.rootResourceId,
      pathPart: "payment",
    });

    const paymentFileRes = new ApiGatewayResource(this, "payment-file-res", {
      restApiId: api.id,
      parentId: paymentResource.id,
      pathPart: "{filename}",
    });

    createCorsOptions(this, "payment-file", api.id, paymentFileRes.id);

    const paymentPutMethod = new ApiGatewayMethod(this, "payment-put", {
      restApiId: api.id,
      resourceId: paymentFileRes.id,
      httpMethod: "PUT",
      authorization: "CUSTOM",
      authorizerId: authorizer.id,
      requestParameters: {
        "method.request.path.filename": true,
      },
    });

    const paymentPutIntegration = new ApiGatewayIntegration(this, "payment-put-int", {
      restApiId: api.id,
      resourceId: paymentFileRes.id,
      httpMethod: "PUT",
      type: "AWS",
      integrationHttpMethod: "PUT",
      uri: `arn:aws:apigateway:us-west-2:s3:path/${paymentBucket.bucket}/profOfPayment/{filename}`,
      credentials: labRoleArn,
      requestParameters: {
        "integration.request.path.filename": "method.request.path.filename",
      },
    });

    const { methodResponse: paymentPutMethodResponse, integrationResponse: paymentPutIntegrationResponse } = addCorsToMethod(this, "payment-put", paymentPutMethod);

    // DEPLOY
    const deployment = new ApiGatewayDeployment(this, "deploy", {
      restApiId: api.id,
      triggers: { redeployment: new Date().toISOString() },
      lifecycle: {
        createBeforeDestroy: true,
      },
      dependsOn: [
        tokenMethod,
        paymentPutMethod,
        paymentPutIntegration,
        paymentPutMethodResponse,
        paymentPutIntegrationResponse,
        eventGetMethod,
        eventPostMethod,
        eventPutMethod,
        eventDeleteMethod,
        ticketPostMethod,
        ticketDeleteMethod,
        ticketIdDeleteMethod,
        orderGetMethod,
        orderPostMethod,
      ],
    });

    new ApiGatewayStage(this, "stage-prod", {
      restApiId: api.id,
      deploymentId: deployment.id,
      stageName: "production",
      cacheClusterEnabled: true,
      cacheClusterSize: "0.5",
    });

    // ===============================================
    // WEBSOCKET API
    // ===============================================
    const wsApi = new Apigatewayv2Api(this, "ws-api", {
      name: "lks-websocket-api",
      protocolType: "WEBSOCKET",
      routeSelectionExpression: "$request.body.action",
    });

    const wsIntegration = new Apigatewayv2Integration(this, "ws-int", {
      apiId: wsApi.id,
      integrationType: "AWS_PROXY",
      integrationUri: lksWebsocket.invokeArn,
    });

    ["$connect", "$disconnect", "$default", "sendMessage", "getConnectionId", "broadcastMessage"].forEach((route) => {
      new Apigatewayv2Route(this, `ws-route-${route}`, {
        apiId: wsApi.id,
        routeKey: route,
        target: `integrations/${wsIntegration.id}`,
      });
    });

    const wsDeployment = new Apigatewayv2Deployment(this, "ws-deploy", {
      apiId: wsApi.id,
      triggers: { redeployment: new Date().toISOString() },
      lifecycle: {
        createBeforeDestroy: true,
      },
    });

    new Apigatewayv2Stage(this, "ws-stage-prod", {
      apiId: wsApi.id,
      deploymentId: wsDeployment.id,
      name: "prod",
    } as any);
  }
}
