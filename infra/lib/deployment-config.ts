import {
  Duration,
  RemovalPolicy,
  aws_ec2 as ec2,
  aws_logs as logs,
} from 'aws-cdk-lib';

const PREPROD_DATABASE_BACKUP_RETENTION_DAYS = 7;
const PROD_DATABASE_BACKUP_RETENTION_DAYS = 14;

export const DeploymentStage = {
  PREPROD: 'preprod',
  PROD: 'prod',
  TEST: 'test',
} as const;

export type DeploymentStage =
  (typeof DeploymentStage)[keyof typeof DeploymentStage];

export interface DeploymentConfig {
  stage: DeploymentStage;
  resourcePrefix: string;
  availabilityZoneCount: number;
  natGateways: number;
  serviceCpu: number;
  serviceMemoryMiB: number;
  desiredCount: number;
  databaseInstanceType: ec2.InstanceType;
  databaseAllocatedStorageGiB: number;
  databaseMaxAllocatedStorageGiB: number;
  databaseBackupRetention: Duration;
  databaseMultiAz: boolean;
  databaseDeletionProtection: boolean;
  logRetention: logs.RetentionDays;
  removalPolicy: RemovalPolicy;
  wafRateLimit: number;
  wafLoginRateLimit: number;
  wafRegistrationRateLimit: number;
}

// Keep environment differences in one place so the stack describes topology,
// while this table owns cost, durability, capacity, and protection trade-offs.
const STAGE_SETTINGS: Record<
  DeploymentStage,
  Omit<DeploymentConfig, 'stage' | 'resourcePrefix'>
> = {
  [DeploymentStage.TEST]: {
    availabilityZoneCount: 2,
    natGateways: 1,
    serviceCpu: 256,
    serviceMemoryMiB: 512,
    desiredCount: 1,
    databaseInstanceType: ec2.InstanceType.of(
      ec2.InstanceClass.T4G,
      ec2.InstanceSize.MICRO,
    ),
    databaseAllocatedStorageGiB: 20,
    databaseMaxAllocatedStorageGiB: 100,
    databaseBackupRetention: Duration.days(1),
    databaseMultiAz: false,
    databaseDeletionProtection: false,
    logRetention: logs.RetentionDays.ONE_WEEK,
    removalPolicy: RemovalPolicy.DESTROY,
    wafRateLimit: 5000,
    wafLoginRateLimit: 200,
    wafRegistrationRateLimit: 100,
  },
  [DeploymentStage.PREPROD]: {
    availabilityZoneCount: 2,
    natGateways: 1,
    serviceCpu: 512,
    serviceMemoryMiB: 1024,
    desiredCount: 1,
    databaseInstanceType: ec2.InstanceType.of(
      ec2.InstanceClass.T4G,
      ec2.InstanceSize.SMALL,
    ),
    databaseAllocatedStorageGiB: 50,
    databaseMaxAllocatedStorageGiB: 200,
    databaseBackupRetention: Duration.days(
      PREPROD_DATABASE_BACKUP_RETENTION_DAYS,
    ),
    databaseMultiAz: false,
    databaseDeletionProtection: true,
    logRetention: logs.RetentionDays.ONE_MONTH,
    removalPolicy: RemovalPolicy.RETAIN,
    wafRateLimit: 2000,
    wafLoginRateLimit: 100,
    wafRegistrationRateLimit: 50,
  },
  [DeploymentStage.PROD]: {
    availabilityZoneCount: 2,
    natGateways: 2,
    serviceCpu: 1024,
    serviceMemoryMiB: 2048,
    desiredCount: 2,
    databaseInstanceType: ec2.InstanceType.of(
      ec2.InstanceClass.T4G,
      ec2.InstanceSize.MEDIUM,
    ),
    databaseAllocatedStorageGiB: 100,
    databaseMaxAllocatedStorageGiB: 500,
    databaseBackupRetention: Duration.days(PROD_DATABASE_BACKUP_RETENTION_DAYS),
    databaseMultiAz: true,
    databaseDeletionProtection: true,
    logRetention: logs.RetentionDays.THREE_MONTHS,
    removalPolicy: RemovalPolicy.RETAIN,
    wafRateLimit: 1000,
    wafLoginRateLimit: 100,
    wafRegistrationRateLimit: 25,
  },
};

export function deploymentConfig(stage: DeploymentStage): DeploymentConfig {
  return {
    stage,
    resourcePrefix: `eagle-bank-${stage}`,
    ...STAGE_SETTINGS[stage],
  };
}

export function parseDeploymentStage(value: string): DeploymentStage {
  if (
    value === DeploymentStage.TEST ||
    value === DeploymentStage.PREPROD ||
    value === DeploymentStage.PROD
  ) {
    return value;
  }
  throw new Error(
    `Unsupported deployment stage "${value}". Use test, preprod, or prod.`,
  );
}
