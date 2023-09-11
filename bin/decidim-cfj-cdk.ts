#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Config, getConfig } from "../lib/config";
import { S3Stack } from "../lib/s3-stack";
import { NetworkStack } from "../lib/network";
import { RdsStack } from "../lib/rds-stack";
import { ElasticacheStack } from "../lib/elasticache-stack";
import { DecidimStack } from "../lib/decidim-stack";
import { CloudFrontStack } from "../lib/cloudfront";
import { Tags } from 'aws-cdk-lib';

const app = new cdk.App();

const stages = ['dev', 'staging', 'prd-v0265', 'prd-v0274']
const stage = app.node.tryGetContext('stage')
const tag = app.node.tryGetContext('tag')
if (!stages.includes(stage)) {
  throw new Error('set stage value using -c option')
}

const config: Config = getConfig(stage)
const serviceName = `decidim`;

const env = {
  account: config.aws.accountId,
  region: config.aws.region
}

const cloudfrontEnv = {
  account: config.aws.accountId,
  region: 'us-east-1'
}

new S3Stack(app, `${ stage }${ serviceName }S3Stack`, {
  stage,
  env,
  serviceName
})

const network = new NetworkStack(app, `${ stage }${ serviceName }NetworkStack`, {
  stage,
  env,
  serviceName,
  vpc: config.vpc,
})

const rds = new RdsStack(app, `${ stage }${ serviceName }RdsStack`, {
  stage,
  env,
  serviceName,
  vpc: network.vpc,
  securityGroup: network.sgForRds,
  rds: config.rds
})

rds.addDependency(network)

const elastiCache = new ElasticacheStack(app, `${ stage }${ serviceName }ElastiCacheStack`, {
  stage,
  env,
  serviceName,
  engineVersion: config.engineVersion,
  cacheNodeType: config.cacheNodeType,
  numCacheNodes: config.numCacheNodes,
  automaticFailoverEnabled: config.automaticFailoverEnabled,
  securityGroup: network.sgForCache.securityGroupId,
  ecSubnetGroup: network.ecSubnetGroup
})

elastiCache.addDependency(network)

const service = new DecidimStack(app, `${ stage }${ serviceName }Stack`, {
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
  cache: elastiCache.redis.attrPrimaryEndPointAddress
})
service.addDependency(network)

const distribution = new CloudFrontStack(app, `${ stage }${ serviceName }CloudFrontStack`, {
  stage,
  serviceName,
  env: cloudfrontEnv,
  domain: config.domain,
  certificateArn: config.cloudfrontCertificate
})
distribution.addDependency(service)

Tags.of(app).add('Project', 'Decidim')
Tags.of(app).add('Repository', 'decidim-cfj-cdk')
Tags.of(app).add('GovernmentName', 'code4japan')
Tags.of(app).add('Env', stage)
Tags.of(app).add('ManagedBy', 'cdk')

