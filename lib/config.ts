import { InstanceType } from 'aws-cdk-lib/aws-ec2';

export interface SubnetConfig {
  subnetId: string;
  availabilityZone: string;
  routeTableId: string;
}

export interface VpcConfig {
  vpcId: string;
  cidrBlock: string;
  availabilityZones: string[];
  publicSubnets: SubnetConfig[];
  privateSubnets: SubnetConfig[];
}

export interface RdsConfig {
  snapshot: boolean;
  snapshotIdentifier: string;
  instanceType: InstanceType;
  deletionProtection: boolean;
  allocatedStorage: number;
  maxAllocatedStorage: number;
  multiAz: boolean;
  enablePerformanceInsights: boolean;
}

export interface EcsConfig {
  smtpDomain: string;
  repository: string;
  certificates: string[];
  fargateCapacityProvider: capacityProviderStrategy;
  fargateSpotCapacityProvider: capacityProviderStrategy;
}

export interface capacityProviderStrategy {
  base?: number;
  weight: number;
}

export interface Config {
  stage: string;

  vpc?: VpcConfig;
  aws: {
    accountId: string;
    region: string;
  };

  s3Bucket: string;

  // rds
  rds: RdsConfig;

  // elastiCache
  cacheNodeType: string;
  engineVersion: string;
  numCacheNodes: number;
  automaticFailoverEnabled: boolean;

  ecs: EcsConfig;

  // service
  domain: string;
  cloudfrontCertificate: string;
}

export function getConfig(stage: string): Config {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-var-requires
  return require(`../config/${stage}.json`) as Config;
}
