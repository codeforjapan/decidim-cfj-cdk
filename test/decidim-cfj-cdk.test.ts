import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { DecidimStack } from '../lib/decidim-stack';

import { Config, getConfig } from '../lib/config';
import { NetworkStack } from '../lib/network';
import { S3Stack } from '../lib/s3-stack';
import { RdsStack } from '../lib/rds-stack';
import { ElasticacheStack } from '../lib/elasticache-stack';

function buildDecidimStack(enforceOriginVerify: boolean) {
  const app = new cdk.App();
  // WHEN

  const stage = 'staging';
  const tag = 'tag-test1';
  const config: Config = getConfig(stage);
  const serviceName = `decidim`;

  const env = {
    account: config.aws.accountId,
    region: config.aws.region,
  };

  new S3Stack(app, `${stage}${serviceName}S3Stack`, {
    stage,
    env,
    serviceName,
    bucketName: config.s3Bucket,
  });

  const network = new NetworkStack(app, `${stage}${serviceName}NetworkStack`, {
    stage,
    env,
    serviceName,
    vpc: config.vpc,
    enforceOriginVerify,
  });

  const rds = new RdsStack(app, `${stage}${serviceName}RdsStack`, {
    stage,
    env,
    serviceName,
    vpc: network.vpc,
    securityGroup: network.sgForRds,
    rds: config.rds,
  });

  rds.addDependency(network);

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

  elastiCache.addDependency(network);

  const props = {
    stage,
    env,
    tag,
    serviceName,
    vpc: network.vpc,
    ecs: config.ecs,
    securityGroup: network.sgForDecidimService,
    securityGroupForAlb: network.sgForAlb,
    domain: config.domain,
    rds: rds.rds.dbInstanceEndpointAddress,
    cache: elastiCache.redis.attrReaderEndPointAddress,
    bucketName: config.s3Bucket,
    enforceOriginVerify,
  };
  const stack = new DecidimStack(app, 'DecidimStack', props);

  return { network: Template.fromStack(network), service: Template.fromStack(stack) };
}

test('DecidimStack Created', () => {
  const template = buildDecidimStack(false).service;
  // console.dir(template);

  template.resourceCountIs('AWS::IAM::Role', 7);
  template.hasResourceProperties('AWS::S3::Bucket', {
    BucketName: 'staging-decidim-alb-logs',
  });
  template.resourceCountIs('AWS::ECS::Service', 3);

  // Assert the template matches the snapshot.
  expect(template.toJSON()).toMatchSnapshot();
});

test('enforceOriginVerify で CloudFront 以外からのアクセスを拒否する', () => {
  const { network, service } = buildDecidimStack(true);

  network.hasResourceProperties('AWS::EC2::SecurityGroup', {
    GroupName: 'stagingForAlb',
    SecurityGroupIngress: Match.absent(),
  });
  network.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
    SourcePrefixListId: Match.anyValue(),
    FromPort: 443,
    ToPort: 443,
  });

  for (const port of [80, 443]) {
    service.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: port,
      DefaultActions: [Match.objectLike({ Type: 'fixed-response' })],
    });
  }
  service.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
    Priority: 100,
    Actions: [Match.objectLike({ Type: 'forward' })],
    Conditions: [Match.objectLike({ Field: 'http-header' })],
  });
});
