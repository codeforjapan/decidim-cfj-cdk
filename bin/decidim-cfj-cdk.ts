#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Config, getConfig } from '../lib/config';
import { S3Stack } from '../lib/s3-stack';
import { NetworkStack } from '../lib/network';
import { RdsStack } from '../lib/rds-stack';
import { ElasticacheStack } from '../lib/elasticache-stack';
import { DecidimStack } from '../lib/decidim-stack';
import { CloudFrontStack } from '../lib/cloudfront';
import { Tags } from 'aws-cdk-lib';

const app = new cdk.App();

const stages = ['dev', 'staging', 'prd-v0292', 'dev2'] as const;
const stage = app.node.tryGetContext('stage') as string;
const tag = app.node.tryGetContext('tag') as string;
if (!stages.includes(stage as (typeof stages)[number])) {
  throw new Error('set stage value using -c option');
}

const config: Config = getConfig(stage);
const serviceName = `decidim`;

const env = {
  account: config.aws.accountId,
  region: config.aws.region,
};

const cloudfrontEnv = {
  account: config.aws.accountId,
  region: 'us-east-1',
};

const s3Stack = new S3Stack(app, `${stage}${serviceName}S3Stack`, {
  stage: stage,
  env,
  serviceName,
  bucketName: config.s3Bucket,
});

const network = new NetworkStack(app, `${stage}${serviceName}NetworkStack`, {
  stage: stage,
  env,
  serviceName,
  vpc: config.vpc,
});

const rds = new RdsStack(app, `${stage}${serviceName}RdsStack`, {
  stage: stage,
  env,
  serviceName,
  vpc: network.vpc,
  securityGroup: network.sgForRds,
  rds: config.rds,
});

rds.addDependency(network);

const elastiCache = new ElasticacheStack(app, `${stage}${serviceName}ElastiCacheStack`, {
  stage: stage,
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

const service = new DecidimStack(app, `${stage}${serviceName}Stack`, {
  stage: stage,
  env,
  tag: tag,
  serviceName,
  vpc: network.vpc,
  ecs: config.ecs,
  securityGroup: network.sgForDecidimService,
  securityGroupForAlb: network.sgForAlb,
  domain: config.domain,
  rds: rds.rds.dbInstanceEndpointAddress,
  cache: elastiCache.redis.attrPrimaryEndPointAddress,
  bucketName: config.s3Bucket,
});
service.addDependency(network);

const distribution = new CloudFrontStack(app, `${stage}${serviceName}CloudFrontStack`, {
  stage: stage,
  serviceName,
  env: cloudfrontEnv,
  domain: config.domain,
  certificateArn: config.cloudfrontCertificate,
  s3BucketName: `${config.s3Bucket}-bucket`,
});
distribution.addDependency(service);
distribution.addDependency(s3Stack);

Tags.of(app).add('Project', 'Decidim');
Tags.of(app).add('Repository', 'decidim-cfj-cdk');
Tags.of(app).add('GovernmentName', 'code4japan');
Tags.of(app).add('Env', stage);
Tags.of(app).add('ManagedBy', 'cdk');
Tags.of(app).add('AppManagerCFNStackKey', `${stage}${serviceName}Resources`);
