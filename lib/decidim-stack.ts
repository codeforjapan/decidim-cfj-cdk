import * as cdk from 'aws-cdk-lib';
import {
  aws_ec2, aws_ecr,
  aws_ecs as ecs,
  aws_elasticloadbalancingv2 as elbv2,
  aws_logs as logs, aws_s3,
  aws_ssm as ssm,
  Duration,
  RemovalPolicy
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { BaseStackProps } from "./props";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { ApplicationTargetGroup, ListenerCertificate } from "aws-cdk-lib/aws-elasticloadbalancingv2";

export interface DecidimStackProps extends BaseStackProps {
  vpc: aws_ec2.IVpc
  certificate: ListenerCertificate[]
  securityGroup: aws_ec2.SecurityGroup
  securityGroupForAlb: aws_ec2.SecurityGroup
  containerSpec?: {
    cpu: number;
    memoryLimitMiB: number;
  }
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

    const decidimRepository = new aws_ecr.Repository(this, 'DecidimRepository', {
      repositoryName: props.repository
    })

    const container = taskDefinition.addContainer('appContainer', {
      image: ecs.ContainerImage.fromEcrRepository(decidimRepository),
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


    // ALB Definition
    const loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc: props.vpc,
      internetFacing: true,
      http2Enabled: true,
      loadBalancerName: `${ props.stage }-Decidim-Alb`,
      securityGroup: props.securityGroupForAlb
    })

    const targetGroup = new ApplicationTargetGroup(this, 'TargetGroup', {
      protocol: elbv2.ApplicationProtocol.HTTP,
      port: 3000,
      healthCheck: {
        port: '3000',
        path: '/',
        protocol: elbv2.Protocol.HTTP
      },
      targets: [ecsService],
      targetGroupName: `${ props.stage }-${ props.serviceName }-TargetGroup`,
      vpc: props.vpc
    })

    loadBalancer.addListener('httpListener', {
      protocol: elbv2.ApplicationProtocol.HTTP,
      port: 80,
      defaultTargetGroups: [targetGroup]
    })

    loadBalancer.addListener('httpsListener', {
      protocol: elbv2.ApplicationProtocol.HTTP,
      port: 443,
      defaultTargetGroups: [targetGroup],
      certificates: props.certificate
    })

    // ALB Log
    const logBucket = new aws_s3.Bucket(this, `${ props.stage }AlbLogBucket`, {
      bucketName: `${ props.stage }-${ props.serviceName }-alb-logs`,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    })
    loadBalancer.logAccessLogs(logBucket)
  }
}
