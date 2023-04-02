import * as cdk from 'aws-cdk-lib';
import {
  aws_certificatemanager,
  aws_ec2,
  aws_ecr,
  aws_ecs as ecs,
  aws_elasticloadbalancingv2 as elbv2, aws_iam,
  aws_logs as logs,
  aws_route53,
  aws_route53_targets,
  aws_s3,
  aws_ssm as ssm,
  CfnOutput,
  Duration,
  RemovalPolicy
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { BaseStackProps } from "./props";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { ApplicationTargetGroup, ListenerCertificate } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { DockerImageAsset } from 'aws-cdk-lib/aws-ecr-assets';
import { DockerImageName, ECRDeployment } from 'cdk-ecr-deployment';
import path = require('path');
import { capacityProviderStrategy } from "../lib/config";

export interface DecidimStackProps extends BaseStackProps {
  vpc: aws_ec2.IVpc
  securityGroup: aws_ec2.SecurityGroup
  securityGroupForAlb: aws_ec2.SecurityGroup
  containerSpec?: {
    cpu: number;
    memoryLimitMiB: number;
  }
  domain: string
  tag: string
  rds: string
  cache: string
  ecs: {
    smtpDomain: string
    repository: string
    certificates: string[]
    fargateCapacityProvider: capacityProviderStrategy
    fargateSpotCapacityProvider: capacityProviderStrategy
  }
}

export class DecidimStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DecidimStackProps) {
    super(scope, id, props);

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'DecidimCluster', {
      vpc: props.vpc,
      clusterName: `${ props.stage }DecidimCluster`,
      enableFargateCapacityProviders: true,
    })

    const ECSExecPolicyStatement = new aws_iam.PolicyStatement({
      sid: 'allowS3access',
      resources: [`arn:aws:s3:::${ props.stage }-${ props.serviceName }-bucket*`],
      actions: ['s3:*'],
    });

    const backendTaskRole = new aws_iam.Role(this, 'BackendTaskRole', {
      assumedBy: new aws_iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    backendTaskRole.addToPolicy(ECSExecPolicyStatement);

    // Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(
      this,
      "decidimTaskDefinition",
      {
        cpu: props.containerSpec ? props.containerSpec.cpu : 2048,
        memoryLimitMiB: props.containerSpec
          ? props.containerSpec?.memoryLimitMiB
          : 4096,
        family: `${ props.stage }DecidimTaskDefinition`,
        taskRole: backendTaskRole
      }
    );

    // Task Definition
    const sidekiqTaskDefinition = new ecs.FargateTaskDefinition(
      this,
      "sidekiqTaskDefinition",
      {
        cpu: 1024,
        memoryLimitMiB: 2048,
        family: `${ props.stage }SidekiqTaskDefinition`,
        taskRole: backendTaskRole
      }
    );

    const repo = new Repository(this, 'repo', {
      repositoryName: `${ props.stage }-${ props.serviceName }-nginx-repository`,
      removalPolicy: RemovalPolicy.DESTROY
    })

    const image = new DockerImageAsset(this, 'docker-image', {
      directory: path.join(__dirname, 'nginx') // Dockerfileがあるディレクトリを指定
    })

    new ECRDeployment(this, 'DeployDockerImage', {
      src: new DockerImageName(image.imageUri),
      dest: new DockerImageName(`${ repo.repositoryUri }:latest`)
    })

    const DecidimContainerEnvironment: { [key: string]: string } = {
      AWS_CLOUD_FRONT_END_POINT: ssm.StringParameter.valueForTypedStringParameterV2(this, `/decidim-cfj/${ props.stage }/AWS_CLOUD_FRONT_END_POINT`),
      REDIS_URL: `redis://${ props.cache }:6379`,
      RDS_DB_NAME: ssm.StringParameter.valueForTypedStringParameterV2(this, `/decidim-cfj/${ props.stage }/RDS_DB_NAME`),
      RDS_HOSTNAME: props.rds,
      RDS_USERNAME: ssm.StringParameter.valueForTypedStringParameterV2(this, `/decidim-cfj/${ props.stage }/RDS_USERNAME`),
      RDS_PASSWORD: ssm.StringParameter.valueForTypedStringParameterV2(this, `/decidim-cfj/${ props.stage }/RDS_PASSWORD`),
      SECRET_KEY_BASE: ssm.StringParameter.valueForTypedStringParameterV2(this, `/decidim-cfj/${ props.stage }/SECRET_KEY_BASE`),
      SMTP_ADDRESS: ssm.StringParameter.valueForTypedStringParameterV2(this, `/decidim-cfj/${ props.stage }/SMTP_ADDRESS`),
      SMTP_USERNAME: ssm.StringParameter.valueForTypedStringParameterV2(this, `/decidim-cfj/${ props.stage }/SMTP_USERNAME`),
      SMTP_PASSWORD: ssm.StringParameter.valueForTypedStringParameterV2(this, `/decidim-cfj/${ props.stage }/SMTP_PASSWORD`),
      SMTP_DOMAIN: props.ecs.smtpDomain,
      AWS_BUCKET_NAME: `${ props.stage }-${ props.serviceName }-bucket`,
      DECIDIM_COMMENTS_LIMIT: "30",
      SLACK_API_TOKEN: ssm.StringParameter.valueForTypedStringParameterV2(this, `/decidim-cfj/${ props.stage }/SLACK_API_TOKEN`),
    };

    const decidimRepository = aws_ecr.Repository.fromRepositoryName(this, 'DecidimRepository', props.ecs.repository)

    const container = taskDefinition.addContainer('nginxContainer', {
      image: ecs.ContainerImage.fromEcrRepository(repo, 'latest'),
      environment: DecidimContainerEnvironment,
      logging: ecs.LogDriver.awsLogs({
        logGroup: new logs.LogGroup(this, 'NginxLogGroup', {
          logGroupName: `${ props.stage }-${ props.serviceName }-nginxLogGroup`,
          removalPolicy: RemovalPolicy.DESTROY,
          retention: RetentionDays.TWO_WEEKS
        }),
        streamPrefix: 'nginx'
      }),
      healthCheck: {
        command: [
          'CMD-SHELL',
          `curl --fail -s http://localhost || exit 1`
        ],
        retries: 3,
        startPeriod: Duration.minutes(2),
        interval: Duration.minutes(1),
      },
    })

    taskDefinition.addContainer('appContainer', {
      image: new ecs.EcrImage(decidimRepository, props.tag),
      environment: {
        ...DecidimContainerEnvironment, ...{
          NEW_RELIC_AGENT_ENABLED: props.stage === 'prd-v0265' ? 'true' : 'false',
          NEW_RELIC_LICENSE_KEY: props.stage === 'prd-v0265' ? ssm.StringParameter.valueForTypedStringParameterV2(this, `/decidim-cfj/${ props.stage }/NEW_RELIC_LICENSE_KEY`) : '',
          NEW_RELIC_APP_NAME: `decidim-app${ props.stage }`,
        }
      },
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
      containerPort: 80
    })

    sidekiqTaskDefinition.addContainer('sidekiqContainer', {
      image: new ecs.EcrImage(decidimRepository, props.tag),
      environment: DecidimContainerEnvironment,
      logging: ecs.LogDriver.awsLogs({
        logGroup: new logs.LogGroup(this, 'sidekiqLogGroup', {
          logGroupName: `${ props.stage }-${ props.serviceName }-sidekiqLogGroup`,
          removalPolicy: RemovalPolicy.DESTROY,
          retention: RetentionDays.TWO_WEEKS
        }),
        streamPrefix: 'sidekiq'
      }),
      command: ['bundle', 'exec', 'sidekiq', '-C', '/app/config/sidekiq.yml'],
      healthCheck: {
        command: [
          'CMD-SHELL',
          `ps aux | grep '[s]idekiq'`
        ],
        retries: 3,
        startPeriod: Duration.minutes(2),
        interval: Duration.minutes(1),
      }
    })

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
      enableExecuteCommand: true, // For Debug
      capacityProviderStrategies: [
        {
          capacityProvider: 'FARGATE_SPOT',
          base: props.ecs.fargateSpotCapacityProvider.base,
          weight: props.ecs.fargateSpotCapacityProvider.weight
        },
        {
          capacityProvider: 'FARGATE',
          base: props.ecs.fargateCapacityProvider.base,
          weight: props.ecs.fargateCapacityProvider.weight
        }
      ],
      propagateTags: ecs.PropagatedTagSource.TASK_DEFINITION
    })
    const autoscaling = ecsService.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 5
    })

    autoscaling.scaleOnCpuUtilization('ScalingOnCpu', {
      targetUtilizationPercent: 50
    })
    autoscaling.scaleOnMemoryUtilization('ScalingOnMemory', {
      targetUtilizationPercent: 50
    })

    new ecs.FargateService(this, 'sidekiqService', {
      cluster,
      taskDefinition: sidekiqTaskDefinition,
      serviceName: `${ props.stage }SidekiqService`,
      vpcSubnets: {
        subnets: props.vpc.publicSubnets
      },
      securityGroups: [props.securityGroup],
      desiredCount: 1,
      assignPublicIp: true,
      enableExecuteCommand: true, // For Debug
      capacityProviderStrategies: [
        {
          capacityProvider: 'FARGATE_SPOT',
          base: props.ecs.fargateSpotCapacityProvider.base,
          weight: props.ecs.fargateSpotCapacityProvider.weight
        },
        {
          capacityProvider: 'FARGATE',
          base: props.ecs.fargateCapacityProvider.base,
          weight: props.ecs.fargateCapacityProvider.weight
        }
      ],
      propagateTags: ecs.PropagatedTagSource.TASK_DEFINITION
    })

    // ALB Log
    const logBucket = new aws_s3.Bucket(this, `${ props.stage }AlbLogBucket`, {
      bucketName: `${ props.stage }-${ props.serviceName }-alb-logs`,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
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
      port: 80,
      healthCheck: {
        port: '80',
        path: '/',
        protocol: elbv2.Protocol.HTTP,
        healthyHttpCodes: '301',
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

    const certificates: ListenerCertificate[] = [];

    props.ecs.certificates.forEach((certificate, i) => {
      certificates.push(aws_certificatemanager.Certificate.fromCertificateArn(this, `Certificate${ i }`, certificate))
    })

    loadBalancer.addListener('httpsListener', {
      protocol: elbv2.ApplicationProtocol.HTTPS,
      port: 443,
      defaultTargetGroups: [targetGroup],
      certificates: certificates
    })

    loadBalancer.logAccessLogs(logBucket)

    const hostZone = aws_route53.HostedZone.fromLookup(this, 'Zone', { domainName: props.domain })
    new aws_route53.ARecord(this, 'addARecord', {
      zone: hostZone,
      target: aws_route53.RecordTarget.fromAlias(new aws_route53_targets.LoadBalancerTarget(loadBalancer)),
      recordName: `${ props.stage }-${ props.serviceName }-alb-origin`,
      deleteExisting: true
    }).applyRemovalPolicy(RemovalPolicy.DESTROY)

    new CfnOutput(this, `PublicDomain`, {
      value: `${ props.stage }-${ props.serviceName }-alb-origin.${ props.domain }`,
      exportName: `${ props.stage }${ props.serviceName }accessDomain`,
    });
  }
}
