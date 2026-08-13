import {
  aws_ec2,
  aws_rds as rds,
  aws_cloudwatch as cloudwatch,
  aws_cloudwatch_actions as cw_actions,
  aws_sns as sns,
  Duration,
  RemovalPolicy,
  Stack,
  aws_ssm as ssm,
  SecretValue,
} from 'aws-cdk-lib';

import { Construct } from 'constructs';
import { BaseStackProps } from './props';
import {
  DatabaseInstanceEngine,
  DatabaseInstanceSourceProps,
  IDatabaseInstance,
  StorageType,
} from 'aws-cdk-lib/aws-rds';
import { RdsConfig, isPrd } from './config';

export interface RdsStackProps extends BaseStackProps {
  rds: RdsConfig;
  vpc: aws_ec2.IVpc;
  securityGroup: aws_ec2.SecurityGroup;
}

export class RdsStack extends Stack {
  public readonly rds: IDatabaseInstance;

  constructor(scope: Construct, id: string, props: RdsStackProps) {
    super(scope, id, props);

    const config = props.rds;

    const rdsProps: DatabaseInstanceSourceProps = {
      engine: DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16_13 }),
      instanceType: config.instanceType,
      instanceIdentifier: `${props.stage}-${props.serviceName}-postgresql`,
      vpc: props.vpc,
      securityGroups: [props.securityGroup],
      multiAz: config.multiAz,
      removalPolicy: RemovalPolicy.DESTROY,
      deletionProtection: config.deletionProtection,
      storageType: StorageType.GP3,
      allocatedStorage: config.allocatedStorage,
      maxAllocatedStorage: config.maxAllocatedStorage,
      autoMinorVersionUpgrade: true,
      deleteAutomatedBackups: false,
      enablePerformanceInsights: config.enablePerformanceInsights,
    };

    // snapshotから復元するかどうか
    if (config.snapshot) {
      this.rds = new rds.DatabaseInstanceFromSnapshot(this, 'restoreRds', {
        ...rdsProps,
        ...{
          snapshotIdentifier: config.snapshotIdentifier,
        },
      });
    } else {
      this.rds = new rds.DatabaseInstance(this, 'createRds', {
        ...rdsProps,
        ...{
          databaseName: ssm.StringParameter.valueForTypedStringParameterV2(
            this,
            `/decidim-cfj/${props.stage}/RDS_DB_NAME`
          ),
          credentials: {
            username: ssm.StringParameter.valueForTypedStringParameterV2(
              this,
              `/decidim-cfj/${props.stage}/RDS_USERNAME`
            ),
            // TODO: AWS Secrets Managerへの移行を検討（自動ローテーション対応）
            password: SecretValue.unsafePlainText(
              ssm.StringParameter.valueForTypedStringParameterV2(
                this,
                `/decidim-cfj/${props.stage}/RDS_PASSWORD`
              )
            ),
          },
        },
      });
    }

    // 本番のみRDS監視アラームを作成（DevOps Guru無効化の代替、Issue #95）
    if (isPrd(props.stage)) {
      this.addProductionAlarms(this.rds);
    }
  }

  /**
   * 本番RDSの健全性を監視するCloudWatchアラームを作成する。
   * 通知先は既存のSNSトピック decidim-team-address（→ decidim@code4japan.org）。
   * しきい値・評価回数は初期値であり、運用状況を見てチューニングする前提。
   */
  private addProductionAlarms(dbInstance: IDatabaseInstance): void {
    const period = Duration.minutes(5);
    const evaluationPeriods = 3; // 5分×3回=15分継続で発報

    // 既存のチーム通知トピックを参照（アカウント/リージョンはstack由来でconfig駆動に揃える）
    const teamTopic = sns.Topic.fromTopicArn(
      this,
      'DecidimTeamTopic',
      `arn:aws:sns:${this.region}:${this.account}:decidim-team-address`
    );
    const snsAction = new cw_actions.SnsAction(teamTopic);

    const alarms: cloudwatch.Alarm[] = [
      new cloudwatch.Alarm(this, 'PrdRdsHighCpu', {
        metric: dbInstance.metricCPUUtilization({ period }),
        threshold: 80,
        evaluationPeriods,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: '本番RDS CPU使用率が80%を15分継続で超過',
      }),
      new cloudwatch.Alarm(this, 'PrdRdsLowFreeableMemory', {
        metric: dbInstance.metricFreeableMemory({ period }),
        threshold: 400 * 1024 * 1024, // 約400MB（全4GiBの約10%）
        evaluationPeriods,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: '本番RDS 空きメモリが約400MBを下回る',
      }),
      new cloudwatch.Alarm(this, 'PrdRdsLowFreeStorage', {
        metric: dbInstance.metricFreeStorageSpace({ period }),
        threshold: 4 * 1024 * 1024 * 1024, // 約4GB（自動拡張上限40GBに対する空き容量の低下を検知）
        evaluationPeriods,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: '本番RDS 空きストレージが約4GBを下回る',
      }),
      new cloudwatch.Alarm(this, 'PrdRdsHighDbLoad', {
        metric: dbInstance.metric('DBLoad', { period }),
        threshold: 2, // vCPU数(=2)を継続的に超過
        evaluationPeriods,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: '本番RDS DBLoadがvCPU数(2)を15分継続で超過',
      }),
    ];

    for (const alarm of alarms) {
      alarm.addAlarmAction(snsAction);
      alarm.addOkAction(snsAction);
    }
  }
}
