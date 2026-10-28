import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';

import { Config, getConfig } from '../lib/config';
import { CloudFrontStack } from '../lib/cloudfront';

function buildCloudFrontStack(stage: string) {
  const app = new cdk.App();
  const config: Config = getConfig(stage);
  const serviceName = `decidim`;

  const cloudfront = new CloudFrontStack(app, `${stage}${serviceName}CloudFrontStack`, {
    stage,
    serviceName,
    env: { account: config.aws.accountId, region: 'us-east-1' },
    domain: config.domain,
    certificateArn: config.cloudfrontCertificate,
    s3BucketName: `${config.s3Bucket}-bucket`,
  });

  return Template.fromStack(cloudfront);
}

const normalizedSystemPath = Match.objectLike({
  OrStatement: {
    Statements: [
      Match.objectLike({
        ByteMatchStatement: Match.objectLike({
          SearchString: '/system',
          PositionalConstraint: 'EXACTLY',
          TextTransformations: [
            { Priority: 0, Type: 'URL_DECODE' },
            { Priority: 1, Type: 'NORMALIZE_PATH' },
            { Priority: 2, Type: 'LOWERCASE' },
          ],
        }),
      }),
      Match.objectLike({
        ByteMatchStatement: Match.objectLike({
          SearchString: '/system/',
          PositionalConstraint: 'STARTS_WITH',
        }),
      }),
    ],
  },
});

test('/system は正規化したパスで判定し、本番は production.diycities.jp だけ許可する', () => {
  const staging = buildCloudFrontStack('staging');
  staging.hasResourceProperties('AWS::WAFv2::WebACL', {
    Rules: Match.arrayWith([
      Match.objectLike({
        Name: 'staging-decidim-SystemLoginBlock',
        Statement: normalizedSystemPath,
        Action: { Block: Match.anyValue() },
        VisibilityConfig: Match.objectLike({ MetricName: 'staging-decidim-SystemLoginBlock' }),
      }),
    ]),
  });
  const stagingAcl = Object.values(staging.findResources('AWS::WAFv2::WebACL'))[0] as {
    Properties: { Rules: { Name: string }[] };
  };
  const stagingRuleNames = stagingAcl.Properties.Rules.map((r) => r.Name);
  expect(stagingRuleNames).not.toContain('staging-decidim-AllowSystemLogin');
  expect(stagingRuleNames).not.toContain('production-AllowSystemLogin');

  const prd = buildCloudFrontStack('prd-v030');
  prd.hasResourceProperties('AWS::WAFv2::WebACL', {
    Rules: Match.arrayWith([
      Match.objectLike({
        Name: 'production-AllowSystemLogin',
        Priority: 7,
        Statement: {
          AndStatement: {
            Statements: [
              Match.objectLike({
                ByteMatchStatement: Match.objectLike({ SearchString: 'production.diycities.jp' }),
              }),
              normalizedSystemPath,
            ],
          },
        },
        Action: { Allow: {} },
      }),
      Match.objectLike({
        Name: 'prd-v030-decidim-SystemLoginBlock',
        Priority: 8,
        Statement: normalizedSystemPath,
      }),
    ]),
  });
});

test('Cloudfront Stack Created', () => {
  const app = new cdk.App();

  const stage = 'staging';
  const config: Config = getConfig(stage);
  const serviceName = `decidim`;

  const cloudfrontEnv = {
    account: config.aws.accountId,
    region: 'us-east-1',
  };

  const cloudfront = new CloudFrontStack(app, `${stage}${serviceName}CloudFrontStack`, {
    stage,
    serviceName,
    env: cloudfrontEnv,
    domain: config.domain,
    certificateArn: config.cloudfrontCertificate,
    s3BucketName: `${config.s3Bucket}-bucket`,
  });

  const template = Template.fromStack(cloudfront);

  // Assert the template matches the snapshot.
  expect(template.toJSON()).toMatchSnapshot();
});
