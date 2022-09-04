#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Config, getConfig } from "../lib/config";
import { S3Stack } from "../lib/s3-stack";
import { NetworkStack } from "../lib/network";
import { RdsStack } from "../lib/rds-stack";
import { ElasticacheStack } from "../lib/elasticache-stack";
import { DecidimStack } from "../lib/decidim-stack";

const app = new cdk.App();

const stages = ['dev', 'stg', 'prd']
const stage = app.node.tryGetContext('stage')
if (!stages.includes(stage)) {
  throw new Error('set stage value using -c option')
}

const config: Config = getConfig(stage)
const serviceName = `decidim`;

const env = {
  account: config.aws.accountId,
  region: config.aws.region
}

new S3Stack(app, `${ stage }${ serviceName }S3Stack`, {
  stage,
  env,
  serviceName,
  bucketName: config.bucketName
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

const service = new DecidimStack(app, `${ stage }${ serviceName }DecidimStack`, {
  stage,
  env,
  serviceName,
  vpc: network.vpc,
  certificates: config.certificates,
  securityGroup: network.sgForDecidimService,
  securityGroupForAlb: network.sgForAlb,
  bucketName: config.bucketName,
  domain: config.domain,
  repository: config.repository,
  tag: config.tag,
  rds: rds.rds.dbInstanceEndpointAddress,
  cache: elastiCache.redis.attrReaderEndPointAddress,
})
service.addDependency(network)
