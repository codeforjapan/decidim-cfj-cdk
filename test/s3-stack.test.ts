import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';

import { Config, getConfig } from "../lib/config";
import { S3Stack } from "../lib/s3-stack";

test('S3Stack Created', () => {
    const app = new cdk.App();

    const stage = 'staging';
    const config: Config = getConfig(stage)
    const serviceName = `decidim`;

    const env = {
        account: config.aws.accountId,
        region: config.aws.region
    }

    const s3stack = new S3Stack(app, `${ stage }${ serviceName }S3Stack`, {
        stage,
        env,
        serviceName,
        bucketName: config.s3Bucket,
    })

    const template = Template.fromStack(s3stack);

    // Assert the template matches the snapshot.
    expect(template.toJSON()).toMatchSnapshot();
});

