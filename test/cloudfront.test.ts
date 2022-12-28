import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';

import { Config, getConfig } from "../lib/config";
import { CloudFrontStack } from "../lib/cloudfront";

test('Cloudfront Stack Created', () => {
    const app = new cdk.App();

    const stage = 'staging';
    const config: Config = getConfig(stage)
    const serviceName = `decidim`;

    const cloudfrontEnv = {
        account: config.aws.accountId,
        region: 'us-east-1'
    }

    const cloudfront = new CloudFrontStack(app, `${ stage }${ serviceName }CloudFrontStack`, {
        stage,
        serviceName,
        env: cloudfrontEnv,
        domain: config.domain,
        certificateArn: config.cloudfrontCertificate
    })

    const template = Template.fromStack(cloudfront);

    // Assert the template matches the snapshot.
    expect(template.toJSON()).toMatchSnapshot();
});

