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
   * 通知先はRDSと同じSNSトピック decidim-team-address。
   *
   * アラームは CacheClusterId ディメンションでノード単位に張る。
   * DatabaseMemoryUsagePercentage はこのディメンションでしか公開されていない
   * （ReplicationGroupId 自体は DatabaseMemoryUsageCountedForEvictPercentage 等では
   * 有効だが、そちらはクラスタ単位でノード別に見られない）。
   * cluster mode disabled のメンバーノードは
   * <replicationGroupId>-001 ... -00N という名前で採番される。
   *
   * しきい値は実測（メモリ2〜3%、Evictions 0、EngineCPU 2%、CPUクレジット576で飽和）を
   * 踏まえた初期値であり、運用状況を見てチューニングする前提。
   */
  private addProductionAlarms(replicationGroupId: string, numCacheNodes: number): void {
    const period = Duration.minutes(5);
    // ElastiCache のメトリクスは60秒粒度なので、period=5分 + Maximum は
    // 「5つの1分サンプルのピーク」を見る。RDS 側は Average だが、Redis は
    // シングルスレッドで1分スパイクがそのまま体感レイテンシになるため Maximum を採る。
    const evaluationPeriods = 3; // 5分窓×3回連続で発報

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
          alarmDescription: `本番Redis(${nodeId}) メモリ使用率のピークが60%超、5分窓3回連続`,
        }),
        // volatile-lru は TTL 付きキーのみを落とすため、Evictions が出た時点で
        // セッションが失われうる（キャッシュエントリだけに当たる場合もある）。
        // 匿名アンケートは session_token で識別されるため回答の重複行に繋がりうる。
        //
        // 逆に Evictions=0 は安全を意味しない。Sidekiq のキュー系キーには TTL が無く、
        // TTL 付きキーが尽きると Redis は追い出さずに OOM エラーで書き込みを失敗させる
        // （このとき Evictions は 0 のまま）。この経路を拾うのは上の HighMemoryUsage だけ。
        //
        // AWS は Evictions に数値推奨を出していない（想定内の追い出しもあるため）。
        // 1回で発報させるのはキャッシュとセッションが同居する本構成固有の判断。
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
          alarmDescription: `本番Redis(${nodeId}) エンジンCPU使用率のピークが80%超、5分窓3回連続`,
        }),
        // t3 はバーストのためクレジットを消費する。枯渇すると急落ではなく
        // ベースライン性能（2vCPU × 20% = ノード全体40%）まで段階的に低下する。
        // ElastiCache の T3 は standard のみで、EC2 の unlimited のように
        // 課金で超過分を吸収できない。
        new cloudwatch.Alarm(this, `PrdCacheLowCpuCredit${suffix}`, {
          metric: metric('CPUCreditBalance', 'Minimum'),
          threshold: 100,
          evaluationPeriods,
          comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
          alarmDescription: `本番Redis(${nodeId}) CPUクレジット残高が100を下回る（上限576、毎時24付与）`,
        }),
        // 生存カナリア。上の4本は全て NOT_BREACHING なので、ノードが死んで
        // メトリクスが止まると一斉に「無音の OK」になる。Redis が落ちても
        // RedisCacheStore は failsafe で例外を握り潰すためアプリは動き続け、
        // ALB のヘルスチェックも通る。実際に起きるのは全ユーザーの強制ログアウトと
        // Sidekiq の全停止で、気づく手段がこのアカウントに他に無い。
        //
        // CurrConnections は60秒粒度で常時発行される（CPUCreditBalance は5分粒度
        // なので欠損判定に使えない）。実測は primary 22〜35 / replica 5〜7 なので
        // 閾値1なら誤報しない。Rails も Sidekiq も常時接続を保持するため、
        // 接続ゼロはそれ自体が障害。
        //
        // デプロイやメンテナンスでの一時的な欠損で即発報しないよう、
        // 評価回数は他と同じ3回（15分）を維持する。BREACHING なので短くしない。
        new cloudwatch.Alarm(this, `PrdCacheNodeUnreachable${suffix}`, {
          metric: metric('CurrConnections', 'Maximum'),
          threshold: 1,
          evaluationPeriods,
          comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
          treatMissingData: cloudwatch.TreatMissingData.BREACHING,
          alarmDescription: `本番Redis(${nodeId}) メトリクス欠損または接続ゼロ（ノード消失の疑い）`,
        }),
      ];

      for (const alarm of alarms) {
        alarm.addAlarmAction(snsAction);
        alarm.addOkAction(snsAction);
      }
    }
  }
}
