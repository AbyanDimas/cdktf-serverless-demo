import { Construct } from "constructs";
import { TerraformStack } from "cdktf";
import { AwsProvider } from "@cdktf/provider-aws/lib/provider";
import { RandomProvider } from "@cdktf/provider-random/lib/provider";
import { Network } from "../constructs/network";
import { Database } from "../constructs/database";
import { Storage } from "../constructs/storage";
import { DynamoDB } from "../constructs/dynamodb";
import { LambdaDeployment } from "../constructs/lambda";

export class MainStack extends TerraformStack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    new AwsProvider(this, "AWS", {
      region: "us-west-2",
    });

    new RandomProvider(this, "random");

    const network = new Network(this, "Network");
    new Database(this, "Database", network);

    // SIMPAN STORAGE INSTANCE
    const storage = new Storage(this, "Storage");

    new DynamoDB(this, "DynamoDB");

    // KIRIM STORAGE KE LAMBDA
    new LambdaDeployment(this, "Lambda", storage);
  }
}
