import { Construct } from "constructs";
import { DynamodbTable } from "@cdktf/provider-aws/lib/dynamodb-table";
import { AppautoscalingTarget } from "@cdktf/provider-aws/lib/appautoscaling-target";
import { AppautoscalingPolicy } from "@cdktf/provider-aws/lib/appautoscaling-policy";
import { TerraformOutput } from "cdktf";

export class DynamoDB extends Construct {
  public readonly tokenTable: DynamodbTable;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.tokenTable = new DynamodbTable(this, "token_table", {
      name: "tokens",
      billingMode: "PROVISIONED",
      readCapacity: 10,
      writeCapacity: 5,
      hashKey: "token",
      rangeKey: "deviceid",
      attribute: [
        { name: "token", type: "S" },
        { name: "deviceid", type: "S" },
      ],
    });

    const readTarget = new AppautoscalingTarget(this, "read_target", {
      maxCapacity: 100,
      minCapacity: 10,
      resourceId: `table/${this.tokenTable.name}`,
      scalableDimension: "dynamodb:table:ReadCapacityUnits",
      serviceNamespace: "dynamodb",
    });

    new AppautoscalingPolicy(this, "read_policy", {
      name: `DynamoDBReadCapacityUtilization:${readTarget.resourceId}`,
      policyType: "TargetTrackingScaling",
      resourceId: readTarget.resourceId,
      scalableDimension: readTarget.scalableDimension,
      serviceNamespace: readTarget.serviceNamespace,
      targetTrackingScalingPolicyConfiguration: {
        predefinedMetricSpecification: {
          predefinedMetricType: "DynamoDBReadCapacityUtilization",
        },
        targetValue: 70,
      },
    });

    const writeTarget = new AppautoscalingTarget(this, "write_target", {
      maxCapacity: 25,
      minCapacity: 5,
      resourceId: `table/${this.tokenTable.name}`,
      scalableDimension: "dynamodb:table:WriteCapacityUnits",
      serviceNamespace: "dynamodb",
    });

    new AppautoscalingPolicy(this, "write_policy", {
      name: `DynamoDBWriteCapacityUtilization:${writeTarget.resourceId}`,
      policyType: "TargetTrackingScaling",
      resourceId: writeTarget.resourceId,
      scalableDimension: writeTarget.scalableDimension,
      serviceNamespace: writeTarget.serviceNamespace,
      targetTrackingScalingPolicyConfiguration: {
        predefinedMetricSpecification: {
          predefinedMetricType: "DynamoDBWriteCapacityUtilization",
        },
        targetValue: 70,
      },
    });

    new TerraformOutput(this, "dynamodb_table_name", {
        value: this.tokenTable.name,
    });

    new TerraformOutput(this, "dynamodb_table_arn", {
        value: this.tokenTable.arn,
    });
  }
}