#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { EagleBankStack } from "../lib/eagle-bank-stack.js";

const app = new App();
new EagleBankStack(app, "EagleBankStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT ?? "111111111111",
    region: process.env.CDK_DEFAULT_REGION ?? "eu-west-2"
  }
});
