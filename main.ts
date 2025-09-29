import { Eip } from "@cdktf/provider-aws/lib/eip";
import { NatGateway } from "@cdktf/provider-aws/lib/nat-gateway";
import { Construct } from "constructs";
import { App, TerraformStack } from "cdktf";
import { AwsProvider } from "@cdktf/provider-aws/lib/provider";
import { Vpc } from "@cdktf/provider-aws/lib/vpc";
import { Subnet } from "@cdktf/provider-aws/lib/subnet";
import { RouteTable } from "@cdktf/provider-aws/lib/route-table";
import { Route } from "@cdktf/provider-aws/lib/route";
import { InternetGateway } from "@cdktf/provider-aws/lib/internet-gateway";
import { RouteTableAssociation } from "@cdktf/provider-aws/lib/route-table-association";
import { VpcEndpoint } from "@cdktf/provider-aws/lib/vpc-endpoint";
import { TerraformOutput } from "cdktf";

class MyStack extends TerraformStack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    // define resources here
    new AwsProvider(this, "AWS", {
      region: "us-west-2",
    });

    const vpc = new Vpc(this, "serverless-VPC", {
      cidrBlock: "15.32.0.0/16",
      enableDnsSupport: true,
      enableDnsHostnames: true,
      tags: {
        Name: "serverless-vpc",
      },
    });

    const igw = new InternetGateway(this, "igw", {
      vpcId: vpc.id,
      tags: {
        Name: "serverless-subnet",
      },
    });

    const publicRouteTable = new RouteTable(this, "publicRouteTable", {
      vpcId: vpc.id,
      tags: {
        Name: "public-route-table",
      },
    });

    new Route(this, "PublicRoute", {
      routeTableId: publicRouteTable.id,
      destinationCidrBlock: "0.0.0.0/0",
      gatewayId: igw.id,
    });

    const PublicSubnet1 = new Subnet(this, "PublicSubnet1", {
      vpcId: vpc.id,
      cidrBlock: "15.32.1.0/25",
      availabilityZone: "us-west-2a",
      mapPublicIpOnLaunch: true,
      tags: {
        Name: "Public-Subnet1",
      },
    });

    const PublicSubnet2 = new Subnet(this, "PublicSubnet2", {
      vpcId: vpc.id,
      cidrBlock: "15.32.2.0/25",
      availabilityZone: "us-west-2b",
      mapPublicIpOnLaunch: true,
      tags: {
        Name: "Public-Subnet2",
      },
    });

    new RouteTableAssociation(this, "rta-public-1", {
      subnetId: PublicSubnet1.id,
      routeTableId: publicRouteTable.id,
    });

    new RouteTableAssociation(this, "rta-public-2", {
      subnetId: PublicSubnet2.id,
      routeTableId: publicRouteTable.id,
    });

    const PrivateSubnet = [
      { cidr: "15.32.10.0/25", az: "us-west-2a", name: "private-subnet-1a" },
      { cidr: "15.32.11.0/25", az: "us-west-2a", name: "private-subnet-2a" },
      { cidr: "15.32.20.0/25", az: "us-west-2b", name: "private-subnet-1b" },
      { cidr: "15.32.21.0/25", az: "us-west-2b", name: "private-subnet-2b" },
    ];

    const privateSubnets = PrivateSubnet.map((subnet, index) => {
      return new Subnet(this, `PrivateSubnet${index + 1}`, {
        vpcId: vpc.id,
        cidrBlock: subnet.cidr,
        availabilityZone: subnet.az,
        mapPublicIpOnLaunch: false,
        tags: {
          Name: subnet.name,
        },
      });
    });

    const eip = new Eip(this, "nat-eip", {
      domain: "vpc",
      tags: {
        Name: "nat-eip",
      },
    });

    const natGateway = new NatGateway(this, "nat-gateway", {
      allocationId: eip.id,
      subnetId: PublicSubnet1.id,
      tags: {
        Name: "nat-gateway",
      },
    });

    const privateRouteTable = new RouteTable(this, "private-route-table", {
      vpcId: vpc.id,
      tags: {
        Name: "private-route-table",
      },
    });

    new Route(this, "private-route", {
      routeTableId: privateRouteTable.id,
      destinationCidrBlock: "0.0.0.0/0",
      natGatewayId: natGateway.id,
    });

    privateSubnets.forEach((subnet, index) => {
      new RouteTableAssociation(this, `rta-private-${index + 1}`, {
        subnetId: subnet.id,
        routeTableId: privateRouteTable.id,
      });
    });

    new VpcEndpoint(this, "s3-endpoint", {
      vpcId: vpc.id,
      serviceName: `com.amazonaws.us-west-2.s3`,
      routeTableIds: [publicRouteTable.id, privateRouteTable.id],
      vpcEndpointType: "Gateway",
    });

    new TerraformOutput(this, "vpc_id", {
      value: vpc.id,
      description: "The ID of the VPC",
      sensitive: false,
    });

    new TerraformOutput(this, "public_subnet_1", {
      value: PublicSubnet1.id,
      description: "The ID of the public subnet 1",
      sensitive: false,
    });

    new TerraformOutput(this, "public_subnet_2", {
      value: PublicSubnet2.id,
      description: "The ID of the public subnet 2",
      sensitive: false,
    });

    new TerraformOutput(this, "igw_id", {
      value: igw.id,
      description: "The ID of the internet gateway",
      sensitive: false,
    });

    new TerraformOutput(this, "public_route_table_id", {
      value: publicRouteTable.id,
      description: "The ID of the public route table",
      sensitive: false,
    });
  }
}

const app = new App();
new MyStack(app, "serverless");
app.synth();
