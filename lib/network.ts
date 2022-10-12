import { VpcConfig } from "./config";
import { BaseStackProps } from "./props";
import {
  Stack,
  aws_ec2 as ec2,
  CfnOutput,
  aws_elasticache as elasticache,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { IVpc } from "aws-cdk-lib/aws-ec2";

export interface NetworkStackProps extends BaseStackProps {
  vpc?: VpcConfig;
}

export class NetworkStack extends Stack {
  public readonly vpc: ec2.IVpc;

  public readonly sgForDecidimService: ec2.SecurityGroup
  public readonly sgForAlb: ec2.SecurityGroup
  public readonly sgForRds: ec2.SecurityGroup
  public readonly sgForCache: ec2.SecurityGroup
  public readonly ecSubnetGroup: elasticache.CfnSubnetGroup


  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);
    let vpc: ec2.IVpc | undefined;

    if (props.vpc) {
      vpc = this.outputVpcInfo(props);
    } else {
      vpc = this.createVpc(props);
    }

    this.vpc = vpc;

    // SG for ALB
    const sgForAlb = new ec2.SecurityGroup(this, `${ props.stage }SecurityGroupForAlb`, {
      vpc,
      securityGroupName: `${ props.stage }ForAlb`
    })

    const fromPeer: ec2.IPeer = ec2.Peer.anyIpv4() // Open to All
    const ports = [80, 443]
    ports.forEach((port) => {
      sgForAlb.addIngressRule(fromPeer, ec2.Port.tcp(port))
    })
    this.sgForAlb = sgForAlb


    // SG for DecidimService
    const sgForDecidimService = new ec2.SecurityGroup(
      this,
      `${ props.stage }SecurityGroupForDecidimService`,
      {
        vpc,
        securityGroupName: `${ props.stage }ForDecidimService`
      }
    )
    sgForDecidimService.addIngressRule(sgForAlb, ec2.Port.tcp(80))
    this.sgForDecidimService = sgForDecidimService

    // SG for Rds
    const sgForRds = new ec2.SecurityGroup(
      this,
      `${ props.stage }SecurityGroupForRDS`,
      {
        vpc,
        securityGroupName: `${ props.stage }ForRDS`
      }
    )
    sgForRds.addIngressRule(sgForDecidimService, ec2.Port.tcp(5432))
    this.sgForRds = sgForRds

    let publicSubnets: string[] = []

    vpc.publicSubnets.forEach((value) => {
      publicSubnets.push(value.subnetId)
    });

    this.ecSubnetGroup = new elasticache.CfnSubnetGroup(this, 'ElastiCacheSubnetGroup', {
      description: 'Elasticache Subnet Group',
      subnetIds: publicSubnets,
      cacheSubnetGroupName: `${ props.stage }-${ props.serviceName }-SubnetGroup`
    });

    // SG for ElasticCache
    const sgForCache = new ec2.SecurityGroup(
      this,
      `${ props.stage }SecurityGroupForElasticCache`,
      {
        vpc,
        securityGroupName: `${ props.stage }ForElasticCache`
      }
    )
    sgForCache.addIngressRule(sgForDecidimService, ec2.Port.tcp(6379))
    this.sgForCache = sgForCache
  }

  /**
   * VPC不要の際にOutputだけ行う
   * @param props
   * @returns
   */
  private outputVpcInfo(props: NetworkStackProps): IVpc {
    const vpc = props.vpc!;

    new CfnOutput(this, `VpcId`, {
      value: vpc.vpcId,
      exportName: `${ props.stage }${ props.serviceName }VpcId`,
    });

    new CfnOutput(this, `VpcCidrBlock`, {
      value: vpc.cidrBlock,
      exportName: `${ props.stage }${ props.serviceName }VpcCidrBlock`,
    });

    vpc.availabilityZones.forEach((az, i) => {
      new CfnOutput(this, `AvailabilityZone${ i }`, {
        value: az,
        exportName: `${ props.stage }${ props.serviceName }AvailabilityZone${ i }`,
      });
    });

    vpc.publicSubnets.forEach((s, i) => {
      new CfnOutput(this, `PublicSubnetId${ i }`, {
        value: s.subnetId,
        exportName: `${ props.stage }${ props.serviceName }PublicSubnetId${ i }`,
      });
      new CfnOutput(this, `PublicSubnetAz${ i }`, {
        value: s.availabilityZone,
        exportName: `${ props.stage }${ props.serviceName }PublicSubnetAz${ i }`,
      });
      new CfnOutput(this, `PublicSubnetRouteTableId${ i }`, {
        value: s.routeTableId,
        exportName: `${ props.stage }${ props.serviceName }PublicSubnetRouteTableId${ i }`,
      });
    });

    vpc.privateSubnets.forEach((s, i) => {
      new CfnOutput(this, `PrivateSubnetId${ i }`, {
        value: s.subnetId,
        exportName: `${ props.stage }${ props.serviceName }PrivateSubnetId${ i }`,
      });
      new CfnOutput(this, `PrivateSubnetAz${ i }`, {
        value: s.availabilityZone,
        exportName: `${ props.stage }${ props.serviceName }PrivateSubnetAz${ i }`,
      });
      new CfnOutput(this, `PrivateSubnetRouteTableId${ i }`, {
        value: s.routeTableId,
        exportName: `${ props.stage }${ props.serviceName }PrivateSubnetRouteTableId${ i }`,
      });
    });

    return ec2.Vpc.fromLookup(this, "Vpc", {
      vpcId: vpc.vpcId
    });
  }

  /**
   * VPC作成の際に使用される
   * @param props
   * @returns
   */
  private createVpc(props: NetworkStackProps): IVpc {
    const vpc = new ec2.Vpc(this, `Vpc`, {
      cidr: "10.0.0.0/16",
      vpcName: `${ props.stage }${ props.serviceName }`,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
        },
      ],
    });

    new CfnOutput(this, `VpcId`, {
      value: vpc.vpcId,
      exportName: `${ props.stage }${ props.serviceName }VpcId`,
    });

    new CfnOutput(this, `VpcCidrBlock`, {
      value: vpc.vpcCidrBlock,
      exportName: `${ props.stage }${ props.serviceName }VpcCidrBlock`,
    });

    vpc.availabilityZones.forEach((az, i) => {
      new CfnOutput(this, `AvailabilityZone${ i }`, {
        value: az,
        exportName: `${ props.stage }${ props.serviceName }AvailabilityZone${ i }`,
      });
    });

    vpc.publicSubnets.forEach((s, i) => {
      new CfnOutput(this, `PublicSubnetId${ i }`, {
        value: s.subnetId,
        exportName: `${ props.stage }${ props.serviceName }PublicSubnetId${ i }`,
      });
      new CfnOutput(this, `PublicSubnetAz${ i }`, {
        value: s.availabilityZone,
        exportName: `${ props.stage }${ props.serviceName }PublicSubnetAz${ i }`,
      });
      new CfnOutput(this, `PublicSubnetRouteTableId${ i }`, {
        value: s.routeTable.routeTableId,
        exportName: `${ props.stage }${ props.serviceName }PublicSubnetRouteTableId${ i }`,
      });
    });

    vpc.privateSubnets.forEach((s, i) => {
      new CfnOutput(this, `PrivateSubnetId${ i }`, {
        value: s.subnetId,
        exportName: `${ props.stage }${ props.serviceName }PrivateSubnetId${ i }`,
      });
      new CfnOutput(this, `PrivateSubnetAz${ i }`, {
        value: s.availabilityZone,
        exportName: `${ props.stage }${ props.serviceName }PrivateSubnetAz${ i }`,
      });
      new CfnOutput(this, `PrivateSubnetRouteTableId${ i }`, {
        value: s.routeTable.routeTableId,
        exportName: `${ props.stage }${ props.serviceName }PrivateSubnetRouteTableId${ i }`,
      });
    });

    return vpc;
  }

}
