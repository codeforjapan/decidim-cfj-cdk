import {
  aws_elasticache as elasticache,
  aws_cloudwatch as cloudwatch,
  aws_cloudwatch_actions as cw_actions,
  aws_sns as sns,
  Duration,
  Stack,
} from 'aws-cdk-lib';

import { Construct } from 'constructs';
import { BaseStackProps } from './props';
import { CfnReplicationGroup, CfnReplicationGroupProps } from 'aws-cdk-lib/aws-elasticache';
import { isPrd } from './config';

export interface ElastiCacheStackProps extends BaseStackProps {
  cacheNodeType: string;
  engineVersion: string;
  numCacheNodes: number;
  automaticFailoverEnabled: boolean;
  securityGroup: string;
  ecSubnetGroup: elasticache.CfnSubnetGroup;
}

export class ElasticacheStack extends Stack {
  public readonly redis: CfnReplicationGroup;

  constructor(scope: Construct, id: string, props: ElastiCacheStackProps) {
    super(scope, id, props);

    const parameterGroup = new elasticache.CfnParameterGroup(this, 'RedisParameterGroup', {
      cacheParameterGroupFamily: 'redis6.x',
      description: `${props.stage}-${props.serviceName} Redis parameter group`,
      properties: {
        'maxmemory-policy': 'volatile-lru',
      },
    });

    const elastiCacheProps: CfnReplicationGroupProps = {
      replicationGroupDescription: `${props.stage}-${props.serviceName}-cache`,
      engine: 'redis',
      replicationGroupId: `${props.stage}-${props.serviceName}-cache`,
      engineVersion: props.engineVersion,
      cacheNodeType: props.cacheNodeType,
      numCacheClusters: props.numCacheNodes,
      automaticFailoverEnabled: props.automaticFailoverEnabled,
      securityGroupIds: [props.securityGroup],
      cacheSubnetGroupName: props.ecSubnetGroup.cacheSubnetGroupName,
      cacheParameterGroupName: parameterGroup.ref,
    };

    if (isPrd(props.stage)) {
      this.redis = new elasticache.CfnReplicationGroup(this, 'prdElasticache', {
        ...elastiCacheProps,
        ...{
          multiAzEnabled: true,
        },
      });

      this.addProductionAlarms(`${props.stage}-${props.serviceName}-cache`, props.numCacheNodes);
    } else {
      this.redis = new elasticache.CfnReplicationGroup(this, 'elasticache', elastiCacheProps);
    }
  }

  /**
   * 本番Redisの健全性を監視するCloudWatchアラームを作成する。
   * 通知先はRDSと同じSNSトピック decidim-team-address。
   *
   * メトリクスのディメンションは CacheClusterId であり、ReplicationGroupId では
   * データが取れない。cluster mode disabled のメンバーノードは
   * <replicationGroupId>-001 ... -00N という名前で採番される。
   *
   * しきい値は実測（メモリ2〜3%、Evictions 0、EngineCPU 2%、CPUクレジット576で飽和）を
   * 踏まえた初期値であり、運用状況を見てチューニングする前提。
   */
  private addProductionAlarms(replicationGroupId: string, numCacheNodes: number): void {
    const period = Duration.minutes(5);
    const evaluationPeriods = 3; // 5分×3回=15分継続で発報

    const teamTopic = sns.Topic.fromTopicArn(
      this,
      'DecidimTeamTopic',
      `arn:aws:sns:${this.region}:${this.account}:decidim-team-address`
    );
    const snsAction = new cw_actions.SnsAction(teamTopic);

    for (let i = 1; i <= numCacheNodes; i++) {
      const suffix = String(i).padStart(3, '0');
      const nodeId = `${replicationGroupId}-${suffix}`;
      const metric = (metricName: string, statistic: string) =>
        new cloudwatch.Metric({
          namespace: 'AWS/ElastiCache',
          metricName,
          dimensionsMap: { CacheClusterId: nodeId },
          period,
          statistic,
        });

      const alarms: cloudwatch.Alarm[] = [
        new cloudwatch.Alarm(this, `PrdCacheHighMemoryUsage${suffix}`, {
          metric: metric('DatabaseMemoryUsagePercentage', 'Maximum'),
          threshold: 60,
          evaluationPeriods,
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
          alarmDescription: `本番Redis(${nodeId}) メモリ使用率が60%を15分継続で超過`,
        }),
        // Evictionsが出た時点でセッションが失われている。キャッシュと同居しているため
        // 強制ログアウトや匿名アンケートの識別子変化に直結する。1回でも発報させる。
        new cloudwatch.Alarm(this, `PrdCacheEvictions${suffix}`, {
          metric: metric('Evictions', 'Sum'),
          threshold: 0,
          evaluationPeriods: 1,
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
          alarmDescription: `本番Redis(${nodeId}) キーの追い出しが発生`,
        }),
        // Redisはシングルスレッドのため、2vCPUのCPUUtilizationでは飽和を捉えられない。
        new cloudwatch.Alarm(this, `PrdCacheHighEngineCpu${suffix}`, {
          metric: metric('EngineCPUUtilization', 'Maximum'),
          threshold: 80,
          evaluationPeriods,
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
          alarmDescription: `本番Redis(${nodeId}) エンジンCPU使用率が80%を15分継続で超過`,
        }),
        // t3はバーストのためクレジットを消費する。枯渇するとスロットルされる。
        new cloudwatch.Alarm(this, `PrdCacheLowCpuCredit${suffix}`, {
          metric: metric('CPUCreditBalance', 'Minimum'),
          threshold: 100,
          evaluationPeriods,
          comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
          alarmDescription: `本番Redis(${nodeId}) CPUクレジット残高が100を下回る（上限576）`,
        }),
      ];

      for (const alarm of alarms) {
        alarm.addAlarmAction(snsAction);
        alarm.addOkAction(snsAction);
      }
    }
  }
}
