import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';

import { Config, getConfig } from '../lib/config';
import { S3Stack } from '../lib/s3-stack';

test('S3Stack Created', () => {
  const app = new cdk.App();

  const stage = 'staging';
  const config: Config = getConfig(stage);
  const serviceName = `decidim`;

  const env = {
    account: config.aws.accountId,
    region: config.aws.region,
  };

  const s3stack = new S3Stack(app, `${stage}${serviceName}S3Stack`, {
    stage,
    env,
    serviceName,
    bucketName: config.s3Bucket,
  });

  const template = Template.fromStack(s3stack);

  // Assert the template matches the snapshot.
  expect(template.toJSON()).toMatchSnapshot();
});

test.each(['prd-v030', 'prd-v032'])(
  '%s は CDK 管理外の CloudFront にもバケットを読ませる',
  (stage) => {
    const app = new cdk.App();
    const config: Config = getConfig(stage);

    const s3stack = new S3Stack(app, `${stage}decidimS3Stack`, {
      stage,
      env: { account: config.aws.accountId, region: config.aws.region },
      serviceName: 'decidim',
      bucketName: config.s3Bucket,
      extraCloudFrontDistributionArns: config.extraCloudFrontDistributionArns,
    });

    Template.fromStack(s3stack).hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'AllowExternalCloudFrontOACRead',
            Action: 's3:GetObject',
            Condition: {
              StringEquals: {
                'AWS:SourceArn': [
                  'arn:aws:cloudfront::754230892200:distribution/E2MTSCGBQNOTFD',
                  'arn:aws:cloudfront::887442827229:distribution/E2XE21ENN7AJRM',
                ],
              },
            },
          }),
        ]),
      },
    });
  }
);
