import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';

import { Config, getConfig } from '../lib/config';
import { NetworkStack } from '../lib/network';
import { RdsStack } from '../lib/rds-stack';

test('RdsStack Created', () => {
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

  const rds = new RdsStack(app, `${stage}${serviceName}RdsStack`, {
    stage,
    env,
    serviceName,
    vpc: network.vpc,
    securityGroup: network.sgForRds,
    rds: config.rds,
  });

  const template = Template.fromStack(rds);

  // staging にはアラームを生成しない（本番のみ）
  template.resourceCountIs('AWS::CloudWatch::Alarm', 0);

  // Assert the template matches the snapshot.
  expect(template.toJSON()).toMatchSnapshot();
});

test('RdsStack creates 4 CloudWatch alarms on production', () => {
  const app = new cdk.App();

  const stage = 'prd-v0292';
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

  const rds = new RdsStack(app, `${stage}${serviceName}RdsStack`, {
    stage,
    env,
    serviceName,
    vpc: network.vpc,
    securityGroup: network.sgForRds,
    rds: config.rds,
  });

  const template = Template.fromStack(rds);

  // 4種のアラーム（CPU / FreeableMemory / FreeStorageSpace / DBLoad）
  template.resourceCountIs('AWS::CloudWatch::Alarm', 4);

  // 各アラームに既存SNSトピックへの ALARM/OK アクションが設定されている
  template.hasResourceProperties('AWS::CloudWatch::Alarm', {
    AlarmActions: ['arn:aws:sns:ap-northeast-1:887442827229:decidim-team-address'],
    OKActions: ['arn:aws:sns:ap-northeast-1:887442827229:decidim-team-address'],
  });

  // Assert the template matches the snapshot.
  expect(template.toJSON()).toMatchSnapshot();
});
