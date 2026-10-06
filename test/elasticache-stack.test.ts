import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';

import { Config, getConfig } from '../lib/config';
import { NetworkStack } from '../lib/network';
import { ElasticacheStack } from '../lib/elasticache-stack';

const serviceName = `decidim`;

function buildStack(stage: string) {
  const app = new cdk.App();
  const config: Config = getConfig(stage);

  const env = {
    account: config.aws.accountId,
    region: config.aws.region,
  };

  const network = new NetworkStack(app, `${stage}${serviceName}NetworkStack`, {
    stage,
    env,
    serviceName,
    vpc: config.vpc,
  });

  const elastiCache = new ElasticacheStack(app, `${stage}${serviceName}ElastiCacheStack`, {
    stage,
    env,
    serviceName,
    engineVersion: config.engineVersion,
    cacheNodeType: config.cacheNodeType,
    numCacheNodes: config.numCacheNodes,
    automaticFailoverEnabled: config.automaticFailoverEnabled,
    securityGroup: network.sgForCache.securityGroupId,
    ecSubnetGroup: network.ecSubnetGroup,
  });

  return { template: Template.fromStack(elastiCache), config };
}

test('Elasticache Stack Created', () => {
  const { template } = buildStack('staging');

  // 本番以外では監視アラームを作らない
  template.resourceCountIs('AWS::CloudWatch::Alarm', 0);

  // Assert the template matches the snapshot.
  expect(template.toJSON()).toMatchSnapshot();
});

test('ElasticacheStack creates 5 CloudWatch alarms per node on production', () => {
  const stage = 'prd-v030';
  const { template, config } = buildStack(stage);

  template.resourceCountIs('AWS::CloudWatch::Alarm', 5 * config.numCacheNodes);

  // 各アラームに既存SNSトピックへの ALARM/OK アクションが設定されている
  template.hasResourceProperties('AWS::CloudWatch::Alarm', {
    AlarmActions: ['arn:aws:sns:ap-northeast-1:887442827229:decidim-team-address'],
    OKActions: ['arn:aws:sns:ap-northeast-1:887442827229:decidim-team-address'],
  });

  // メトリクス・統計量・ディメンションを「組」で検証する。
  // 別々に検証すると、-002 のアラームが誤って -001 を指していても
  // すべてのアサーションが通過してしまう。
  const expected = [
    ['DatabaseMemoryUsagePercentage', 'Maximum', 'notBreaching'],
    ['Evictions', 'Sum', 'notBreaching'],
    ['EngineCPUUtilization', 'Maximum', 'notBreaching'],
    ['CPUCreditBalance', 'Minimum', 'notBreaching'],
    // 生存カナリアだけは欠損を異常として扱う。ここが notBreaching に
    // 変わると、ノード消失時にアラーム群が一斉に無音の OK になる。
    ['CurrConnections', 'Maximum', 'breaching'],
  ];

  for (let i = 1; i <= config.numCacheNodes; i++) {
    const nodeId = `${stage}-${serviceName}-cache-${String(i).padStart(3, '0')}`;

    for (const [metricName, statistic, treatMissingData] of expected) {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        Namespace: 'AWS/ElastiCache',
        MetricName: metricName,
        Statistic: statistic,
        Period: 300,
        TreatMissingData: treatMissingData,
        Dimensions: [{ Name: 'CacheClusterId', Value: nodeId }],
      });
    }
  }

  // しきい値と比較演算子を明示検証する
  // （スナップショット更新で誤った値が素通りするのを防ぐ）
  template.hasResourceProperties('AWS::CloudWatch::Alarm', {
    MetricName: 'DatabaseMemoryUsagePercentage',
    Threshold: 60,
    EvaluationPeriods: 3,
    ComparisonOperator: 'GreaterThanThreshold',
  });
  template.hasResourceProperties('AWS::CloudWatch::Alarm', {
    MetricName: 'Evictions',
    Threshold: 0,
    EvaluationPeriods: 1,
    ComparisonOperator: 'GreaterThanThreshold',
  });
  template.hasResourceProperties('AWS::CloudWatch::Alarm', {
    MetricName: 'EngineCPUUtilization',
    Threshold: 80,
    EvaluationPeriods: 3,
    ComparisonOperator: 'GreaterThanThreshold',
  });
  template.hasResourceProperties('AWS::CloudWatch::Alarm', {
    MetricName: 'CPUCreditBalance',
    Threshold: 100,
    EvaluationPeriods: 3,
    ComparisonOperator: 'LessThanThreshold',
  });
  template.hasResourceProperties('AWS::CloudWatch::Alarm', {
    MetricName: 'CurrConnections',
    Threshold: 1,
    EvaluationPeriods: 3,
    ComparisonOperator: 'LessThanThreshold',
  });

  expect(template.toJSON()).toMatchSnapshot();
});
