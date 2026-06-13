#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { EagleBankStack } from "../lib/eagle-bank-stack.js";

const app = new App();
const account = process.env.CDK_DEFAULT_ACCOUNT ?? "111111111111";
const region = process.env.CDK_DEFAULT_REGION ?? "eu-west-2";
app.node.setContext(
  `availability-zones:account=${account}:region=${region}`,
  [`${region}a`, `${region}b`]
);
new EagleBankStack(app, "EagleBankStack", {
  env: { account, region }
});
