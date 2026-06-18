export const Environment = {
  LOCAL: 'local',
  PREPROD: 'preprod',
  PROD: 'prod',
  TEST: 'test',
} as const;

export type Environment = (typeof Environment)[keyof typeof Environment];

export function isAwsDeploymentEnvironment(environment: Environment): boolean {
  return (
    environment === Environment.PREPROD || environment === Environment.PROD
  );
}
