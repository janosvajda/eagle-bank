import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { EagleBankStack } from "../lib/eagle-bank-stack.js";

function template(): Template {
  const app = new App();
  return Template.fromStack(
    new EagleBankStack(app, "TestStack", {
      env: { account: "111111111111", region: "eu-west-2" }
    })
  );
}

describe("EagleBankStack", () => {
  it("models the required production infrastructure", () => {
    const output = template();
    output.resourceCountIs("AWS::ECS::Service", 5);
    output.resourceCountIs("AWS::SQS::Queue", 4);
    output.resourceCountIs("AWS::RDS::DBInstance", 1);
    output.hasResourceProperties("AWS::DynamoDB::Table", {
      BillingMode: "PAY_PER_REQUEST",
      TimeToLiveSpecification: {
        AttributeName: "expiresAtEpoch",
        Enabled: true
      },
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" }
      ]
    });
    output.hasResourceProperties("AWS::WAFv2::WebACLAssociation", {
      WebACLArn: Match.anyValue()
    });
  });

  it("does not put local AWS overrides or credentials into task definitions", () => {
    const json = JSON.stringify(template().toJSON());
    expect(json).not.toContain("DYNAMODB_ENDPOINT");
    expect(json).not.toContain("SQS_ENDPOINT");
    expect(json).not.toContain("AWS_ACCESS_KEY_ID");
    expect(json).not.toContain("AWS_SECRET_ACCESS_KEY");
  });
});
