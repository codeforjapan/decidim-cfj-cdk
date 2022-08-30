#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Config, getConfig } from "../lib/config";
import { S3Stack } from "../lib/s3-stack";
import { NetworkStack } from "../lib/network";
import { RdsStack } from "../lib/rds-stack";

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

const bucket = new S3Stack(app, `${stage}${serviceName}S3Stack`, {
  stage,
  env,
  serviceName,
  bucketName: config.bucketName
})

const network = new NetworkStack(app, `${stage}${serviceName}NetworkStack`, {
  stage,
  env,
  serviceName,
  vpc: config.vpc
})

const rds = new RdsStack(app, `${stage}${serviceName}RdsStack`, {
  stage,
  env,
  serviceName,
  rdsName: config.rdsName,
  postgresVersion: config.postgresVersion,
  snapshot: config.snapshot,
  snapshotIdentifier: config.snapshotIdentifier,
  instanceType: config.instanceType,
  vpc: network.vpc,
  securityGroup: network.sgForRds,
})

rds.addDependency(network)
