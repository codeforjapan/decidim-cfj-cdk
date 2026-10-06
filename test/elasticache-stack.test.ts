import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';

import { Config, getConfig } from '../lib/config';
import { NetworkStack } from '../lib/network';
import { ElasticacheStack } from '../lib/elasticache-stack';

test('Elasticache Stack Created', () => {
  const app = new cdk.App();

  const stage = 'staging';
  const config: Config = getConfig(stage);
  const serviceName = `decidim`;

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

  const template = Template.fromStack(elastiCache);

  // Assert the template matches the snapshot.
  expect(template.toJSON()).toMatchSnapshot();
});

test('ElasticacheStack creates no alarms outside production', () => {
  const app = new cdk.App();

  const stage = 'staging';
  const config: Config = getConfig(stage);
  const serviceName = `decidim`;

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

  Template.fromStack(elastiCache).resourceCountIs('AWS::CloudWatch::Alarm', 0);
});

test('ElasticacheStack creates 4 CloudWatch alarms per node on production', () => {
  const app = new cdk.App();

  const stage = 'prd-v030';
  const config: Config = getConfig(stage);
  const serviceName = `decidim`;

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

  const template = Template.fromStack(elastiCache);

  template.resourceCountIs('AWS::CloudWatch::Alarm', 4 * config.numCacheNodes);

  template.hasResourceProperties('AWS::CloudWatch::Alarm', {
    AlarmActions: ['arn:aws:sns:ap-northeast-1:887442827229:decidim-team-address'],
    OKActions: ['arn:aws:sns:ap-northeast-1:887442827229:decidim-team-address'],
  });

  // ディメンションは CacheClusterId。ReplicationGroupId ではメトリクスが取得できず、
  // アラームが永久に INSUFFICIENT_DATA のまま沈黙する。
  template.hasResourceProperties('AWS::CloudWatch::Alarm', {
    Dimensions: [{ Name: 'CacheClusterId', Value: `${stage}-${serviceName}-cache-001` }],
  });
  template.hasResourceProperties('AWS::CloudWatch::Alarm', {
    Dimensions: [{ Name: 'CacheClusterId', Value: `${stage}-${serviceName}-cache-002` }],
  });

  // 個々のアラームのメトリクス・しきい値・比較演算子を明示検証
  // （スナップショット更新で誤った値が素通りするのを防ぐ）
  template.hasResourceProperties('AWS::CloudWatch::Alarm', {
    MetricName: 'DatabaseMemoryUsagePercentage',
    Threshold: 60,
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
    ComparisonOperator: 'GreaterThanThreshold',
  });
  template.hasResourceProperties('AWS::CloudWatch::Alarm', {
    MetricName: 'CPUCreditBalance',
    Threshold: 100,
    ComparisonOperator: 'LessThanThreshold',
  });
});
