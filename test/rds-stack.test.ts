import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';

import { Config, getConfig } from "../lib/config";
import { NetworkStack } from "../lib/network";
import { RdsStack } from "../lib/rds-stack";

test('RdsStack Created', () => {
    const app = new cdk.App();

    const stage = 'staging';
    const config: Config = getConfig(stage)
    const serviceName = `decidim`;

    const env = {
        account: config.aws.accountId,
        region: config.aws.region
    }

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

    const template = Template.fromStack(rds);

    // Assert the template matches the snapshot.
    expect(template.toJSON()).toMatchSnapshot();
});

