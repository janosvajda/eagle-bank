import {
  Duration,
  RemovalPolicy,
  aws_ec2 as ec2,
  aws_logs as logs
} from "aws-cdk-lib";

export type DeploymentStage = "test" | "preprod" | "prod";

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
}

const STAGE_SETTINGS: Record<
  DeploymentStage,
  Omit<DeploymentConfig, "stage" | "resourcePrefix">
> = {
  test: {
    availabilityZoneCount: 2,
    natGateways: 1,
    serviceCpu: 256,
    serviceMemoryMiB: 512,
    desiredCount: 1,
    databaseInstanceType: ec2.InstanceType.of(
      ec2.InstanceClass.T4G,
      ec2.InstanceSize.MICRO
    ),
    databaseAllocatedStorageGiB: 20,
    databaseMaxAllocatedStorageGiB: 100,
    databaseBackupRetention: Duration.days(1),
    databaseMultiAz: false,
    databaseDeletionProtection: false,
    logRetention: logs.RetentionDays.ONE_WEEK,
    removalPolicy: RemovalPolicy.DESTROY,
    wafRateLimit: 5000
  },
  preprod: {
    availabilityZoneCount: 2,
    natGateways: 1,
    serviceCpu: 512,
    serviceMemoryMiB: 1024,
    desiredCount: 1,
    databaseInstanceType: ec2.InstanceType.of(
      ec2.InstanceClass.T4G,
      ec2.InstanceSize.SMALL
    ),
    databaseAllocatedStorageGiB: 50,
    databaseMaxAllocatedStorageGiB: 200,
    databaseBackupRetention: Duration.days(7),
    databaseMultiAz: false,
    databaseDeletionProtection: true,
    logRetention: logs.RetentionDays.ONE_MONTH,
    removalPolicy: RemovalPolicy.RETAIN,
    wafRateLimit: 2000
  },
  prod: {
    availabilityZoneCount: 2,
    natGateways: 2,
    serviceCpu: 1024,
    serviceMemoryMiB: 2048,
    desiredCount: 2,
    databaseInstanceType: ec2.InstanceType.of(
      ec2.InstanceClass.T4G,
      ec2.InstanceSize.MEDIUM
    ),
    databaseAllocatedStorageGiB: 100,
    databaseMaxAllocatedStorageGiB: 500,
    databaseBackupRetention: Duration.days(14),
    databaseMultiAz: true,
    databaseDeletionProtection: true,
    logRetention: logs.RetentionDays.THREE_MONTHS,
    removalPolicy: RemovalPolicy.RETAIN,
    wafRateLimit: 1000
  }
};

export function deploymentConfig(stage: DeploymentStage): DeploymentConfig {
  return {
    stage,
    resourcePrefix: `eagle-bank-${stage}`,
    ...STAGE_SETTINGS[stage]
  };
}

export function parseDeploymentStage(value: string): DeploymentStage {
  if (value === "test" || value === "preprod" || value === "prod") {
    return value;
  }
  throw new Error(
    `Unsupported deployment stage "${value}". Use test, preprod, or prod.`
  );
}
