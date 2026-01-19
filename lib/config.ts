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

/**
 * ECSタスクのリソース設定
 */
export interface EcsTaskResourceConfig {
  /**
   * CPU割り当て（CPU単位）
   * - 1024単位 = 1 vCPU
   * - 有効な値: 256, 512, 1024, 2048, 4096, 8192, 16384
   * - オプショナル: 指定しない場合はデフォルト値を使用
   */
  cpu?: number;

  /**
   * メモリ割り当て（MiB）
   * - CPUとメモリの組み合わせはAWS Fargateの制限に従う必要がある
   * - オプショナル: 指定しない場合はデフォルト値を使用
   */
  memory?: number;
}

export interface EcsConfig {
  smtpDomain: string;
  repository: string;
  certificates: string[];
  fargateCapacityProvider: capacityProviderStrategy;
  fargateSpotCapacityProvider: capacityProviderStrategy;

  /**
   * メインDecidimアプリケーションタスクのリソース設定
   * - オプショナル: 指定しない場合はデフォルト値（CPU: 2048, memory: 4096）を使用
   */
  mainApp?: EcsTaskResourceConfig;

  /**
   * Sidekiqワーカータスクのリソース設定
   * - オプショナル: 指定しない場合はデフォルト値（CPU: 512, memory: 2048）を使用
   */
  sidekiq?: EcsTaskResourceConfig;

  /**
   * スケジュールされたメンテナンスタスクのリソース設定
   * - 注意: 現在の実装ではメインアプリのタスク定義を使用
   * - このフィールドは将来の独立した設定のために予約されている
   * - オプショナル: 現在は使用されない
   */
  scheduledTasks?: EcsTaskResourceConfig;
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
