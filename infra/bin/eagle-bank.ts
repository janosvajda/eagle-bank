#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { EagleBankStack } from '../lib/eagle-bank-stack.js';
import {
  DeploymentStage,
  parseDeploymentStage,
} from '../lib/deployment-config.js';

const ENVIRONMENT_ENABLED_VALUE = 'true';
const app = new App();
const account = process.env.CDK_DEFAULT_ACCOUNT ?? '111111111111';
const region = process.env.CDK_DEFAULT_REGION ?? 'eu-west-2';
const stage = parseDeploymentStage(
  process.env.DEPLOYMENT_STAGE ?? DeploymentStage.TEST,
);
const activateServices =
  process.env.ACTIVATE_SERVICES === ENVIRONMENT_ENABLED_VALUE;
app.node.setContext(`availability-zones:account=${account}:region=${region}`, [
  `${region}a`,
  `${region}b`,
]);
new EagleBankStack(app, `EagleBank-${stage}`, {
  env: { account, region },
  stage,
  certificateArn: process.env.ALB_CERTIFICATE_ARN,
  activateServices,
});
