import * as cdk from 'aws-cdk-lib';
import {
  aws_ec2,
  aws_ecs as ecs,
  aws_elasticloadbalancingv2 as elbv2,
  aws_logs as logs,
  aws_ssm as ssm,
  Duration,
  RemovalPolicy
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { BaseStackProps } from "./props";
import { RetentionDays } from "aws-cdk-lib/aws-logs";


export interface DecidimStackProps extends BaseStackProps {
  vpc: aws_ec2.IVpc,
  loadBalancer: elbv2.ApplicationLoadBalancer
  securityGroup: aws_ec2.SecurityGroup
  containerSpec?: {
    cpu: number;
    memoryLimitMiB: number;
  };
  bucketName: string
  domain: string
  repository: string
  rds: string
  cache: string
}

export class DecidimStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DecidimStackProps) {
    super(scope, id, props);

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'DecidimCluster', {
      vpc: props.vpc,
      clusterName: `${ props.stage }DecidimCluster`
    })

    // Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(
      this,
      "decidimTaskDefinition",
      {
        cpu: props.containerSpec ? props.containerSpec.cpu : 1024,
        memoryLimitMiB: props.containerSpec
          ? props.containerSpec?.memoryLimitMiB
          : 2048,
        family: `${ props.stage }DecidimTaskDefinition`,
      }
    );

    const DecidimContainerEnvironment: { [key: string]: string } = {
      AWS_ACCESS_KEY_ID: ssm.StringParameter.valueForTypedStringParameter(this, `/decidim-cfj/${props.stage}/AWS_ACCESS_KEY_ID`),
      AWS_SECRET_ACCESS_KEY: ssm.StringParameter.valueForTypedStringParameter(this, `/decidim-cfj/${props.stage}/AWS_SECRET_ACCESS_KEY`),
      AWS_CLOUD_FRONT_END_POINT: ssm.StringParameter.valueForTypedStringParameter(this, `/decidim-cfj/${props.stage}/AWS_CLOUD_FRONT_END_POINT`),
      REDIS_URL: `redis://${props.cache}:6379`,
      RDS_DB_NAME: ssm.StringParameter.valueForTypedStringParameter(this, `/decidim-cfj/${props.stage}/RDS_DB_NAME`),
      RDS_HOSTNAME: props.rds,
      RDS_USERNAME: ssm.StringParameter.valueForTypedStringParameter(this, `/decidim-cfj/${props.stage}/RDS_USERNAME`),
      RDS_PASSWORD: ssm.StringParameter.valueForTypedStringParameter(this, `/decidim-cfj/${props.stage}/RDS_PASSWORD`),
      SECRET_KEY_BASE: ssm.StringParameter.valueForTypedStringParameter(this, `/decidim-cfj/${props.stage}/SECRET_KEY_BASE`),
      NEW_RELIC_LICENSE_KEY: ssm.StringParameter.valueForTypedStringParameter(this, `/decidim-cfj/${props.stage}/NEW_RELIC_LICENSE_KEY`),
      SMTP_ADDRESS: ssm.StringParameter.valueForTypedStringParameter(this, `/decidim-cfj/${props.stage}/SMTP_ADDRESS`),
      SMTP_USERNAME: ssm.StringParameter.valueForTypedStringParameter(this, `/decidim-cfj/${props.stage}/SMTP_USERNAME`),
      SMTP_PASSWORD: ssm.StringParameter.valueForTypedStringParameter(this, `/decidim-cfj/${props.stage}/SMTP_PASSWORD`),
      SMTP_DOMAIN: props.domain,
      AWS_BUCKET_NAME: props.bucketName,
      DECIDIM_COMMENTS_LIMIT: "30",
    };

    const container = taskDefinition.addContainer('appContainer', {
      image: ecs.ContainerImage.fromRegistry(props.repository),
      environment: DecidimContainerEnvironment,
      logging: ecs.LogDriver.awsLogs({
        logGroup: new logs.LogGroup(this, 'DecidimLogGroup', {
          logGroupName: `${ props.stage }-${ props.serviceName }-serviceLogGroup`,
          removalPolicy: RemovalPolicy.DESTROY,
          retention: RetentionDays.TWO_WEEKS
        }),
        streamPrefix: 'app'
      }),
      healthCheck: {
        command: [
          'CMD-SHELL',
          `curl --fail -s http://localhost:3000 || exit 1`
        ],
        retries: 3,
        startPeriod: Duration.minutes(2),
        interval: Duration.minutes(1),
      },
    })
    container.addPortMappings({
      containerPort: 3000
    })

    // taskDefinition.addContainer('sidekiqContainer', {
    //   image: ecs.ContainerImage.fromRegistry(props.repository),
    //   environment: DecidimContainerEnvironment,
    //   logging: ecs.LogDriver.awsLogs({
    //     logGroup: new logs.LogGroup(this, 'sidekiqLogGroup', {
    //       logGroupName: `${ props.stage }-${ props.serviceName }-sidekiqLogGroup`,
    //       removalPolicy: RemovalPolicy.DESTROY,
    //       retention: RetentionDays.TWO_WEEKS
    //     }),
    //     streamPrefix: 'app'
    //   }),
    //   command: ['bundle exec sidekiq -C /app/config/sidekiq.yml'],
    //   healthCheck: {
    //     command: [
    //       'CMD-SHELL',
    //       `test -f sidekiq.pid`
    //     ]
    //   }
    // })

    taskDefinition.defaultContainer = container

    const ecsService = new ecs.FargateService(this, 'DecidimService', {
      cluster,
      taskDefinition,
      serviceName: `${ props.stage }DecidimService`,
      vpcSubnets: {
        subnets: props.vpc.publicSubnets
      },
      securityGroups: [props.securityGroup],
      desiredCount: 1,
      assignPublicIp: true,
      enableExecuteCommand: true // For Debug
    })
    ecsService.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 5
    })

    const http = props.loadBalancer.addListener('httpListener', {
      protocol: elbv2.ApplicationProtocol.HTTP,
      port: 80
    })
    //
    // const https = props.loadBalancer.addListener('httpsListener', {
    //   protocol: elbv2.ApplicationProtocol.HTTPS,
    //   port: 443
    // })

    const target = {
      protocol: elbv2.ApplicationProtocol.HTTP,
      port: 3000,
      targets: [ecsService],
      healthCheck: {
        port: '3000',
        path: '/',
        protocol: elbv2.Protocol.HTTP
      }
    }

    // Add Targate Group to ALB Listener
    http.addTargets('DeicidimHttpTargetGroup', {
      ...target, ...{
        targetGroupName: `${ props.stage }-${ props.serviceName }-httpTargetGroup`,
      }
    })

    // Add Targate Group to ALB Listener
    // https.addTargets('DeicidimHttpsTargetGroup', {
    //   ...target, ...{
    //     targetGroupName: `${ props.stage }-${ props.serviceName }-httpsTargetGroup`,
    //   }
    // })
  }
}
