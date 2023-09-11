import { aws_ec2, aws_rds as rds, RemovalPolicy, Stack, aws_ssm as ssm, SecretValue } from "aws-cdk-lib";

import { Construct } from "constructs";
import { BaseStackProps } from "./props";
import {
  DatabaseInstance,
  DatabaseInstanceEngine,
  DatabaseInstanceSourceProps,
  StorageType
} from "aws-cdk-lib/aws-rds";
import { RdsConfig } from "./config";

export interface RdsStackProps extends BaseStackProps {
  rds: RdsConfig
  vpc: aws_ec2.IVpc
  securityGroup: aws_ec2.SecurityGroup
}

export class RdsStack extends Stack {
  public readonly rds: DatabaseInstance;

  constructor(scope: Construct, id: string, props: RdsStackProps) {
    super(scope, id, props);

    const config = props.rds;

    const rdsProps: DatabaseInstanceSourceProps = {
      engine: DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_12_14 }),
      instanceType: config.instanceType,
      instanceIdentifier: `${ props.stage }-${ props.serviceName }-postgresql`,
      vpc: props.vpc,
      securityGroups: [props.securityGroup],
      multiAz: config.multiAz,
      removalPolicy: RemovalPolicy.DESTROY,
      deletionProtection: config.deletionProtection,
      storageType: StorageType.GP2,
      allocatedStorage: config.allocatedStorage,
      maxAllocatedStorage: config.maxAllocatedStorage,
      autoMinorVersionUpgrade: true,
      deleteAutomatedBackups: false,
      enablePerformanceInsights: config.enablePerformanceInsights
    }

    // snapshotから復元するかどうか
    if (config.snapshot) {
      this.rds = new rds.DatabaseInstanceFromSnapshot(this, 'restoreRds', {
        ...rdsProps,
        ...{
          snapshotIdentifier: config.snapshotIdentifier,
        }
      })
    } else {
      this.rds = new rds.DatabaseInstance(this, 'createRds', {
        ...rdsProps,
        ...{
          databaseName: ssm.StringParameter.valueForTypedStringParameterV2(this, `/decidim-cfj/${ props.stage }/RDS_DB_NAME`),
          credentials: {
            username: ssm.StringParameter.valueForTypedStringParameterV2(this, `/decidim-cfj/${ props.stage }/RDS_USERNAME`),
            password: SecretValue.unsafePlainText(ssm.StringParameter.valueForTypedStringParameterV2(this, `/decidim-cfj/${ props.stage }/RDS_PASSWORD`)),
          }
        }
      })
    }
  }
}
