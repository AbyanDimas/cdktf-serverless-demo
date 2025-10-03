import { Construct } from "constructs";
import { Vpc } from "@cdktf/provider-aws/lib/vpc";
import { Subnet } from "@cdktf/provider-aws/lib/subnet";
import { InternetGateway } from "@cdktf/provider-aws/lib/internet-gateway";
import { RouteTable } from "@cdktf/provider-aws/lib/route-table";
import { Route } from "@cdktf/provider-aws/lib/route";
import { RouteTableAssociation } from "@cdktf/provider-aws/lib/route-table-association";
import { Eip } from "@cdktf/provider-aws/lib/eip";
import { NatGateway } from "@cdktf/provider-aws/lib/nat-gateway";
import { VpcEndpoint } from "@cdktf/provider-aws/lib/vpc-endpoint";

export class Network extends Construct {
  public readonly vpc: Vpc;
  public readonly publicSubnet1: Subnet;
  public readonly publicSubnet2: Subnet;
  public readonly privateSubnets: Subnet[];
  public readonly igw: InternetGateway;
  public readonly publicRouteTable: RouteTable;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.vpc = new Vpc(this, "serverless-VPC", {
      cidrBlock: "15.32.0.0/16",
      enableDnsSupport: true,
      enableDnsHostnames: true,
      tags: {
        Name: "serverless-vpc",
      },
    });

    this.igw = new InternetGateway(this, "igw", {
      vpcId: this.vpc.id,
      tags: {
        Name: "serverless-subnet",
      },
    });

    this.publicRouteTable = new RouteTable(this, "publicRouteTable", {
      vpcId: this.vpc.id,
      tags: {
        Name: "public-route-table",
      },
    });

    new Route(this, "PublicRoute", {
      routeTableId: this.publicRouteTable.id,
      destinationCidrBlock: "0.0.0.0/0",
      gatewayId: this.igw.id,
    });

    this.publicSubnet1 = new Subnet(this, "PublicSubnet1", {
      vpcId: this.vpc.id,
      cidrBlock: "15.32.1.0/25",
      availabilityZone: "us-west-2a",
      mapPublicIpOnLaunch: true,
      tags: {
        Name: "Public-Subnet1",
      },
    });

    this.publicSubnet2 = new Subnet(this, "PublicSubnet2", {
      vpcId: this.vpc.id,
      cidrBlock: "15.32.2.0/25",
      availabilityZone: "us-west-2b",
      mapPublicIpOnLaunch: true,
      tags: {
        Name: "Public-Subnet2",
      },
    });

    new RouteTableAssociation(this, "rta-public-1", {
      subnetId: this.publicSubnet1.id,
      routeTableId: this.publicRouteTable.id,
    });

    new RouteTableAssociation(this, "rta-public-2", {
      subnetId: this.publicSubnet2.id,
      routeTableId: this.publicRouteTable.id,
    });

    const privateSubnetData = [
      { cidr: "15.32.10.0/25", az: "us-west-2a", name: "private-subnet-1a" },
      { cidr: "15.32.11.0/25", az: "us-west-2a", name: "private-subnet-2a" },
      { cidr: "15.32.20.0/25", az: "us-west-2b", name: "private-subnet-1b" },
      { cidr: "15.32.21.0/25", az: "us-west-2b", name: "private-subnet-2b" },
    ];

    this.privateSubnets = privateSubnetData.map((subnet, index) => {
      return new Subnet(this, `PrivateSubnet${index + 1}`, {
        vpcId: this.vpc.id,
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
      subnetId: this.publicSubnet1.id,
      tags: {
        Name: "nat-gateway",
      },
    });

    const privateRouteTable = new RouteTable(this, "private-route-table", {
      vpcId: this.vpc.id,
      tags: {
        Name: "private-route-table",
      },
    });

    new Route(this, "private-route", {
      routeTableId: privateRouteTable.id,
      destinationCidrBlock: "0.0.0.0/0",
      natGatewayId: natGateway.id,
    });

    this.privateSubnets.forEach((subnet, index) => {
      new RouteTableAssociation(this, `rta-private-${index + 1}`, {
        subnetId: subnet.id,
        routeTableId: privateRouteTable.id,
      });
    });

    new VpcEndpoint(this, "s3-endpoint", {
        vpcId: this.vpc.id,
        serviceName: `com.amazonaws.us-west-2.s3`,
        routeTableIds: [this.publicRouteTable.id, privateRouteTable.id],
        vpcEndpointType: "Gateway",
      });
  }
}
