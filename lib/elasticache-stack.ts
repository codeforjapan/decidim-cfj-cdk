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
   * DatabaseMemoryUsagePercentage は ReplicationGroupId 次元を持たないため、
   * ノード単位で張るしかない（ReplicationGroupId 自体は
   * DatabaseMemoryUsageCountedForEvictPercentage 等では有効なディメンション）。
   * cluster mode disabled のメンバーノードは
   * <replicationGroupId>-001 ... -00N という名前で採番される。
   *
   * しきい値は実測（メモリ2〜3%、Evictions 0、ホストCPU平均2.4%/最大10%、
   * CPUクレジット576で飽和）を踏まえた初期値であり、運用状況を見てチューニングする前提。
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
        // AWS は 2vCPU 以下のノードでは CPUUtilization（ホスト全体）を見ることを
        // 推奨している。ElastiCache の管理プロセスがホストCPUの無視できない割合を
        // 使うため、EngineCPUUtilization だけではホストの過負荷を取りこぼす。
        // Redis はシングルスレッドなので閾値は 90% をコア数で割る: 90/2 = 45。
        new cloudwatch.Alarm(this, `PrdCacheHighHostCpu${suffix}`, {
          metric: metric('CPUUtilization', 'Maximum'),
          threshold: 45,
          evaluationPeriods,
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
          alarmDescription: `本番Redis(${nodeId}) ホストCPU使用率のピークが45%超、5分窓3回連続（2vCPUのため90/2）`,
        }),
        // エンジンスレッド単体の負荷。上のホストCPUと併用することで
        // 「エンジンが飽和」と「管理プロセス込みでホストが飽和」を切り分けられる。
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
        //
        // CPUCreditBalance だけは5分粒度でしか発行されないため period は下げられない。
        new cloudwatch.Alarm(this, `PrdCacheLowCpuCredit${suffix}`, {
          metric: metric('CPUCreditBalance', 'Minimum'),
          threshold: 100,
          evaluationPeriods,
          comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
          alarmDescription: `本番Redis(${nodeId}) CPUクレジット残高が100を下回る（上限576、毎時24付与）`,
        }),
        // 生存カナリア。他は全て NOT_BREACHING なので、ノードが死んで
        // メトリクスが止まると一斉に「無音の OK」になる。Redis が落ちても
        // RedisCacheStore は failsafe で例外を握り潰すためアプリは動き続け、
        // ALB のヘルスチェックも通る。実際に起きるのは全ユーザーの強制ログアウトと
        // Sidekiq の全停止で、気づく手段がこのアカウントに他に無い。
        //
        // CurrConnections の下限を支えているのはアプリではなく ElastiCache 自身の
        // 監視接続で、AWS が「4〜6本を監視に使う」と明記している。つまりアプリが
        // 全台落ちても 0 にはならず、0 または欠損ならノード自体の異常と断言できる。
        // 閾値1が実データで満たされることは無く、発報経路は実質 BREACHING のみ。
        //
        // 検知までの時間は period × evaluationPeriods では決まらない。CloudWatch は
        // EvaluationPeriods より広い evaluation range を取るため、period=5分/ev=3 だと
        // 25分かかる。ノード死亡の検知としては遅すぎるので、60秒粒度で発行される
        // 利点を活かして period を1分に下げ、7分程度で発報するようにしている。
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
        // アラームは作成直後に評価され、評価期間の経過を待たない。レプリケーション
        // グループより先に作られると、BREACHING のカナリアがメトリクス未発行のまま
        // 約1分後に誤報する（新ステージのブルーグリーン初回で必ず踏む）。
        alarm.node.addDependency(this.redis);
        alarm.addAlarmAction(snsAction);
        alarm.addOkAction(snsAction);
      }
    }
  }
}
