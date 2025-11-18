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
