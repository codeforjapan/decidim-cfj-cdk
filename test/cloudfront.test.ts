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

const hostIs = (host: string) =>
  Match.objectLike({ ByteMatchStatement: Match.objectLike({ SearchString: host }) });

test('/system は正規化したパスで判定し、各環境の代表ホストでだけ許可する', () => {
  const staging = buildCloudFrontStack('staging');
  staging.hasResourceProperties('AWS::WAFv2::WebACL', {
    Rules: Match.arrayWith([
      Match.objectLike({
        Name: 'staging-decidim-AllowSystemLogin',
        Priority: 7,
        Statement: {
          AndStatement: {
            Statements: [hostIs('staging-decidim.diycities.jp'), normalizedSystemPath],
          },
        },
        Action: { Allow: {} },
      }),
      Match.objectLike({
        Name: 'staging-decidim-SystemLoginBlock',
        Priority: 8,
        Statement: normalizedSystemPath,
        Action: { Block: Match.anyValue() },
        VisibilityConfig: Match.objectLike({ MetricName: 'staging-decidim-SystemLoginBlock' }),
      }),
    ]),
  });

  const prd = buildCloudFrontStack('prd-v030');
  prd.hasResourceProperties('AWS::WAFv2::WebACL', {
    Rules: Match.arrayWith([
      Match.objectLike({
        Name: 'prd-v030-decidim-AllowSystemLogin',
        Priority: 7,
        Statement: {
          AndStatement: {
            Statements: [
              {
                OrStatement: {
                  Statements: [
                    hostIs('prd-v030-decidim.diycities.jp'),
                    hostIs('production.diycities.jp'),
                  ],
                },
              },
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

test('本番以外は代表ホストを CloudFront の別名と DNS に加える', () => {
  const staging = buildCloudFrontStack('staging');
  staging.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: Match.objectLike({
      Aliases: ['staging-decidim-alb-origin.diycities.jp', 'staging-decidim.diycities.jp'],
    }),
  });
  staging.hasResourceProperties('AWS::Route53::RecordSet', {
    Name: 'staging-decidim.diycities.jp.',
    Type: 'A',
  });

  const prd = buildCloudFrontStack('prd-v030');
  prd.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: Match.objectLike({
      Aliases: ['prd-v030-decidim-alb-origin.diycities.jp', '*.diycities.jp'],
    }),
  });
  prd.resourceCountIs('AWS::Route53::RecordSet', 0);
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
