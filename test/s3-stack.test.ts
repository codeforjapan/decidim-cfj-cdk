import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';

import { Config, getConfig } from '../lib/config';
import { S3Stack } from '../lib/s3-stack';

function buildS3Stack(stage: string) {
  const app = new cdk.App();
  const config: Config = getConfig(stage);
  const serviceName = `decidim`;

  const s3stack = new S3Stack(app, `${stage}${serviceName}S3Stack`, {
    stage,
    env: { account: config.aws.accountId, region: config.aws.region },
    serviceName,
    bucketName: config.s3Bucket,
    extraCloudFrontDistributionArns: config.extraCloudFrontDistributionArns,
  });

  return Template.fromStack(s3stack);
}

const externalCloudFrontRead = (arns: string[]) =>
  Match.objectLike({
    Sid: 'AllowExternalCloudFrontOACRead',
    Action: 's3:GetObject',
    Condition: { StringEquals: { 'AWS:SourceArn': arns } },
  });

test('S3Stack Created', () => {
  const template = buildS3Stack('staging');

  // Assert the template matches the snapshot.
  expect(template.toJSON()).toMatchSnapshot();
});

test.each(['prd-v030', 'prd-v032'])(
  '%s は CDK 管理外の CloudFront にもバケットを読ませる',
  (stage) => {
    const template = buildS3Stack(stage);
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          externalCloudFrontRead([
            'arn:aws:cloudfront::754230892200:distribution/E2MTSCGBQNOTFD',
            'arn:aws:cloudfront::887442827229:distribution/E2XE21ENN7AJRM',
          ]),
        ]),
      },
    });
  }
);

test('staging は CDK 管理外の CloudFront を許可しない', () => {
  const policy = buildS3Stack('staging').findResources('AWS::S3::BucketPolicy');
  expect(JSON.stringify(policy)).not.toContain('AllowExternalCloudFrontOACRead');
});
