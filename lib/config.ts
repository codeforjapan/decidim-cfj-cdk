import { InstanceType } from "aws-cdk-lib/aws-ec2";

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
  snapshot: boolean
  snapshotIdentifier: string
  instanceType: InstanceType
  deletionProtection: boolean
  allocatedStorage: number
  multiAz: boolean
}

export interface Config {
  stage: string

  vpc?: VpcConfig;
  aws: {
    accountId: string;
    region: string;
  };

  // rds
  rds: RdsConfig

  // elastiCache
  cacheNodeType: string
  engineVersion: string
  numCacheNodes: number
  automaticFailoverEnabled: boolean

  // service
  smtpDomain: string,
  domain: string,
  repository: string
  certificates: string[]
  cloudfrontCertificate: string
  nginxRepository: string
}

export function getConfig (stage: string): Config {
  return require(`../config/${ stage }.json`)
}
