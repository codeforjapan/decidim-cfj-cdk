import { aws_ec2,   aws_rds as rds, Stack } from "aws-cdk-lib";

import { Construct } from "constructs";
import { BaseStackProps } from "./props";
import { InstanceType } from "aws-cdk-lib/aws-ec2";
import { DatabaseInstanceEngine } from "aws-cdk-lib/aws-rds";

export interface RdsStackProps extends BaseStackProps {
  rdsName: string
  postgresVersion: rds.PostgresEngineVersion
  snapshot: boolean
  snapshotIdentifier: string
  instanceType: InstanceType
  vpc: aws_ec2.IVpc
  securityGroup: aws_ec2.SecurityGroup
}

export class RdsStack extends Stack {
  constructor(scope: Construct, id: string, props: RdsStackProps) {
    super(scope, id, props);

    // snapshotから復元するかどうか
    if (props.snapshot) {
      new rds.DatabaseInstanceFromSnapshot(this, 'restoreRds', {
        snapshotIdentifier: props.snapshotIdentifier,
        engine: rds.DatabaseInstanceEngine.postgres({ version: props.postgresVersion }),
        databaseName: props.rdsName,
        instanceType: props.instanceType,
        vpc: props.vpc,
        vpcSubnets: {
          subnets: props.vpc.publicSubnets
        },
        securityGroups: [props.securityGroup]
      })
    } else {
      new rds.DatabaseInstance(this, 'createRds', {
        engine: DatabaseInstanceEngine.postgres({version: props.postgresVersion}),
        instanceType: props.instanceType,
        databaseName: props.rdsName,
        vpc: props.vpc,
        vpcSubnets: {
          subnets: props.vpc.isolatedSubnets
        },
        securityGroups: [props.securityGroup]

      })
    }
  }
}