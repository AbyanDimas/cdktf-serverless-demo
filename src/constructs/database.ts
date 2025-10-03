import { Construct } from "constructs";
import { DbInstance } from "@cdktf/provider-aws/lib/db-instance";
import { DbSubnetGroup } from "@cdktf/provider-aws/lib/db-subnet-group";
import { SsmParameter } from "@cdktf/provider-aws/lib/ssm-parameter";
import { Password } from "@cdktf/provider-random/lib/password";
import { Network } from "./network";
import { TerraformOutput } from "cdktf";

export class Database extends Construct {
  public readonly dbInstance: DbInstance;

  constructor(scope: Construct, id: string, network: Network) {
    super(scope, id);

    const dbname = new SsmParameter(this, "dbname", {
      name: "/lks/database/dbname",
      type: "String",
      value: "lksdb",
      overwrite: true,
    });

    const dbuser = new SsmParameter(this, "dbuser", {
      name: "/lks/database/username",
      type: "String",
      value: "lksadmin",
      overwrite: true,
    });

    const dbpassword = new Password(this, "dbpassword", {
      length: 16,
      special: true,
      overrideSpecial: "_!%@",
    });

    const dbpasswordSsm = new SsmParameter(this, "dbpassword_ssm", {
      name: "/lks/database/password",
      type: "SecureString",
      value: dbpassword.result,
    });

    const dbSubnetGroup = new DbSubnetGroup(this, "db_subnet_group", {
      name: "lks-db-subnet-group",
      subnetIds: [network.publicSubnet1.id, network.publicSubnet2.id],
    });

    this.dbInstance = new DbInstance(this, "db_instance", {
      allocatedStorage: 20,
      engine: "postgres",
      engineVersion: "17.4",
      instanceClass: "db.t3.micro",
      dbName: dbname.value,
      username: dbuser.value,
      password: dbpassword.result,
      dbSubnetGroupName: dbSubnetGroup.name,
      multiAz: true,
      skipFinalSnapshot: true,
      tags: {
        Name: "lks-db-instance",
      },
    });

    const dbendpoint = new SsmParameter(this, "dbendpoint", {
      name: "/lks/database/endpoint",
      type: "String",
      value: this.dbInstance.endpoint,
    });

    new TerraformOutput(this, "db_instance_identifier", {
      value: this.dbInstance.identifier,
    });

    new TerraformOutput(this, "db_instance_endpoint", {
      value: this.dbInstance.endpoint,
    });

    new TerraformOutput(this, "ssm_db_name", {
      value: dbname.name,
    });

    new TerraformOutput(this, "ssm_db_user", {
      value: dbuser.name,
    });

    new TerraformOutput(this, "ssm_db_password", {
      value: dbpasswordSsm.name,
    });

    new TerraformOutput(this, "ssm_db_endpoint", {
      value: dbendpoint.name,
    });
  }
}

