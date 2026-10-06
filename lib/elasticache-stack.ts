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

    // 監視アラームのディメンションがこの ID から導出されるため、組み立てを2箇所に
    // 散らさない。片方だけ変わるとアラームが存在しないノードを指して沈黙する。
    const replicationGroupId = `${props.stage}-${props.serviceName}-cache`;

    const elastiCacheProps: CfnReplicationGroupProps = {
      replicationGroupDescription: replicationGroupId,
      engine: 'redis',
      replicationGroupId,
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

      this.addProductionAlarms(replicationGroupId, props.numCacheNodes);
    } else {
      this.redis = new elasticache.CfnReplicationGroup(this, 'elasticache', elastiCacheProps);
    }
  }
  /**
   * 本番Redisの健全性を監視するCloudWatchアラームを作成する。
   * ディメンションは CacheClusterId。DatabaseMemoryUsagePercentage は
   * ReplicationGroupId 次元を持たないため、ノード単位で張るしかない。
   */
  private addProductionAlarms(replicationGroupId: string, numCacheNodes: number): void {
    const period = Duration.minutes(5);
    const evaluationPeriods = 3;

    const teamTopic = sns.Topic.fromTopicArn(
      this,
      'DecidimTeamTopic',
      `arn:aws:sns:${this.region}:${this.account}:decidim-team-address`
    );
    const snsAction = new cw_actions.SnsAction(teamTopic);

    for (let i = 1; i <= numCacheNodes; i++) {
      const suffix = String(i).padStart(3, '0');
      const nodeId = `${replicationGroupId}-${suffix}`;
      const metric = (metricName: string, statistic: string, metricPeriod = period) =>
        new cloudwatch.Metric({
          namespace: 'AWS/ElastiCache',
          metricName,
          dimensionsMap: { CacheClusterId: nodeId },
          period: metricPeriod,
          statistic,
        });

      const alarms: cloudwatch.Alarm[] = [
        new cloudwatch.Alarm(this, `PrdCacheHighMemoryUsage${suffix}`, {
          metric: metric('DatabaseMemoryUsagePercentage', 'Maximum'),
          threshold: 60,
          evaluationPeriods,
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
          alarmDescription: `本番Redis(${nodeId}) メモリ使用率のピークが60%超、5分窓3回連続`,
        }),
        // Sidekiq のキュー系キーには TTL が無く、volatile-lru は TTL 付きキーが
        // 尽きると追い出しをやめて OOM を返すため、Evictions=0 でも逼迫しうる。
        new cloudwatch.Alarm(this, `PrdCacheEvictions${suffix}`, {
          metric: metric('Evictions', 'Sum'),
          threshold: 0,
          evaluationPeriods: 1,
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
          alarmDescription: `本番Redis(${nodeId}) キーの追い出しが発生`,
        }),
        new cloudwatch.Alarm(this, `PrdCacheHighHostCpu${suffix}`, {
          metric: metric('CPUUtilization', 'Maximum'),
          threshold: 45,
          evaluationPeriods,
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
          alarmDescription: `本番Redis(${nodeId}) ホストCPU使用率のピークが45%超、5分窓3回連続（2vCPUのため90/2）`,
        }),
        // 80 にすると上のホストCPU 45 とほぼ同時に鳴り、切り分けにならない。
        new cloudwatch.Alarm(this, `PrdCacheHighEngineCpu${suffix}`, {
          metric: metric('EngineCPUUtilization', 'Maximum'),
          threshold: 90,
          evaluationPeriods,
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
          alarmDescription: `本番Redis(${nodeId}) エンジンCPU使用率のピークが90%超、5分窓3回連続`,
        }),
        // 削らないこと。スロットル中はホストCPUがベースライン20%で頭打ちになり、
        // 上の45%が原理的に鳴らない。5分粒度でしか出ないため period は下げられない。
        new cloudwatch.Alarm(this, `PrdCacheLowCpuCredit${suffix}`, {
          metric: metric('CPUCreditBalance', 'Minimum'),
          threshold: 100,
          evaluationPeriods,
          comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
          alarmDescription: `本番Redis(${nodeId}) CPUクレジット残高が100を下回る（上限576、毎時24付与）`,
        }),
        // 生存カナリア。他は NOT_BREACHING なのでノードが死ぬと一斉に無音の OK に
        // なる。CurrConnections は ElastiCache 自身が4〜6本張るため0にならない。
        // datapointsToAlarm は設定しないこと（M=N でないと歯抜けで誤報する）。
        new cloudwatch.Alarm(this, `PrdCacheNodeUnreachable${suffix}`, {
          metric: metric('CurrConnections', 'Maximum', Duration.minutes(1)),
          threshold: 1,
          evaluationPeriods: 5,
          comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
          treatMissingData: cloudwatch.TreatMissingData.BREACHING,
          alarmDescription: `本番Redis(${nodeId}) メトリクス欠損または接続ゼロ（ノード消失の疑い）`,
        }),
      ];

      for (const alarm of alarms) {
        // アラームは作成直後に評価されるため、先に作られるとカナリアが誤報する。
        alarm.node.addDependency(this.redis);
        alarm.addAlarmAction(snsAction);
        alarm.addOkAction(snsAction);
      }
    }
  }
}
