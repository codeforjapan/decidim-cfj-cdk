import { aws_ec2, aws_rds as rds, Stack } from "aws-cdk-lib";

import { Construct } from "constructs";
import { BaseStackProps } from "./props";
import { InstanceType } from "aws-cdk-lib/aws-ec2";
import { DatabaseInstanceBase, DatabaseInstanceEngine, DatabaseInstanceProps, DatabaseInstanceSourceProps } from "aws-cdk-lib/aws-rds";

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


    const rdsProps: DatabaseInstanceSourceProps = {
      engine: DatabaseInstanceEngine.postgres({ version: props.postgresVersion }),
      instanceType: props.instanceType,
      databaseName: props.rdsName,
      vpc: props.vpc,
      vpcSubnets: {
        subnets: props.vpc.isolatedSubnets
      },
      securityGroups: [props.securityGroup]
    }

    // snapshotから復元するかどうか
    if (props.snapshot) {
      new rds.DatabaseInstanceFromSnapshot(this, 'restoreRds', {
        ...rdsProps,
        ...{
          snapshotIdentifier: props.snapshotIdentifier,
        }
      })
    } else {
      new rds.DatabaseInstance(this, 'createRds', rdsProps)
    }
  }
}