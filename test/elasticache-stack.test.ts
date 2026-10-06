import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';

import { Config, getConfig } from '../lib/config';
import { NetworkStack } from '../lib/network';
import { ElasticacheStack } from '../lib/elasticache-stack';

const serviceName = `decidim`;
const teamTopicArn = 'arn:aws:sns:ap-northeast-1:887442827229:decidim-team-address';

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

// 各アラームの期待値。メトリクス名だけで検証するとノードを取り違えても
// 通過してしまうため、ディメンションと組にして1リソースずつ突き合わせる。
const expectedAlarms = [
  {
    metricName: 'DatabaseMemoryUsagePercentage',
    statistic: 'Maximum',
    period: 300,
    threshold: 60,
    evaluationPeriods: 3,
    comparisonOperator: 'GreaterThanThreshold',
    treatMissingData: 'notBreaching',
  },
  {
    metricName: 'Evictions',
    statistic: 'Sum',
    period: 300,
    threshold: 0,
    evaluationPeriods: 1,
    comparisonOperator: 'GreaterThanThreshold',
    treatMissingData: 'notBreaching',
  },
  {
    // 2vCPU のノードでは AWS が CPUUtilization を推奨している（閾値は 90/2）
    metricName: 'CPUUtilization',
    statistic: 'Maximum',
    period: 300,
    threshold: 45,
    evaluationPeriods: 3,
    comparisonOperator: 'GreaterThanThreshold',
    treatMissingData: 'notBreaching',
  },
  {
    metricName: 'EngineCPUUtilization',
    statistic: 'Maximum',
    period: 300,
    threshold: 80,
    evaluationPeriods: 3,
    comparisonOperator: 'GreaterThanThreshold',
    treatMissingData: 'notBreaching',
  },
  {
    metricName: 'CPUCreditBalance',
    statistic: 'Minimum',
    period: 300,
    threshold: 100,
    evaluationPeriods: 3,
    comparisonOperator: 'LessThanThreshold',
    treatMissingData: 'notBreaching',
  },
  {
    // 生存カナリア。breaching が notBreaching に変わると、ノード消失時に
    // アラーム群が一斉に無音の OK になる。period=60 も検知時間に直結する。
    metricName: 'CurrConnections',
    statistic: 'Maximum',
    period: 60,
    threshold: 1,
    evaluationPeriods: 5,
    comparisonOperator: 'LessThanThreshold',
    treatMissingData: 'breaching',
  },
];

test('Elasticache Stack Created', () => {
  const { template } = buildStack('staging');

  // 本番以外では監視アラームを作らない
  template.resourceCountIs('AWS::CloudWatch::Alarm', 0);

  // Assert the template matches the snapshot.
  expect(template.toJSON()).toMatchSnapshot();
});

test('ElasticacheStack creates alarms for every node on production', () => {
  const stage = 'prd-v030';
  const { template, config } = buildStack(stage);

  template.resourceCountIs('AWS::CloudWatch::Alarm', expectedAlarms.length * config.numCacheNodes);

  // 「少なくとも1本」ではなく全数を検証する。hasResourceProperties は1本でも
  // 一致すれば通るため、一部のアラームが通知を失っても気づけない。
  template.allResourcesProperties('AWS::CloudWatch::Alarm', {
    AlarmActions: [teamTopicArn],
    OKActions: [teamTopicArn],
  });

  for (let i = 1; i <= config.numCacheNodes; i++) {
    const nodeId = `${stage}-${serviceName}-cache-${String(i).padStart(3, '0')}`;

    for (const alarm of expectedAlarms) {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        Namespace: 'AWS/ElastiCache',
        MetricName: alarm.metricName,
        Statistic: alarm.statistic,
        Period: alarm.period,
        Threshold: alarm.threshold,
        EvaluationPeriods: alarm.evaluationPeriods,
        ComparisonOperator: alarm.comparisonOperator,
        TreatMissingData: alarm.treatMissingData,
        Dimensions: [{ Name: 'CacheClusterId', Value: nodeId }],
      });
    }
  }

  expect(template.toJSON()).toMatchSnapshot();
});

test('ElasticacheStack alarms depend on the replication group', () => {
  const { template } = buildStack('prd-v030');

  // アラームは作成直後に評価されるため、レプリケーショングループより先に
  // 作られると BREACHING のカナリアがメトリクス未発行のまま誤報する。
  const alarms = template.findResources('AWS::CloudWatch::Alarm');
  const names = Object.keys(alarms);
  expect(names.length).toBeGreaterThan(0);

  for (const name of names) {
    expect(alarms[name].DependsOn).toContain('prdElasticache');
  }
});
