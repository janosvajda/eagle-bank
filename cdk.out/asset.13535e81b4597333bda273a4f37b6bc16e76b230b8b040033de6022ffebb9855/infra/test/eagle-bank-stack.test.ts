import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { EagleBankStack } from "../lib/eagle-bank-stack.js";
import {
  deploymentConfig,
  parseDeploymentStage,
  type DeploymentStage,
} from "../lib/deployment-config.js";

const TEST_ACCOUNT = "111111111111";
const TEST_REGION = "eu-west-2";
const TEST_CERTIFICATE_ARN =
  "arn:aws:acm:eu-west-2:111111111111:certificate/test";

function template(
  stage: DeploymentStage = "test",
  certificateArn?: string,
): Template {
  const app = new App();
  return Template.fromStack(
    new EagleBankStack(app, `TestStack-${stage}`, {
      env: { account: TEST_ACCOUNT, region: TEST_REGION },
      stage,
      certificateArn,
    }),
  );
}

function containers(output: Template): Array<Record<string, unknown>> {
  const tasks = output.findResources("AWS::ECS::TaskDefinition");
  return Object.values(tasks).flatMap(
    (task) =>
      (task.Properties.ContainerDefinitions as Array<
        Record<string, unknown>
      >) ?? [],
  );
}

function container(output: Template, name: string): Record<string, unknown> {
  const found = containers(output).find((item) => item.Name === name);
  expect(found, `Expected task container ${name}`).toBeDefined();
  return found!;
}

function environment(
  taskContainer: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    (taskContainer.Environment as Array<{ Name: string; Value: unknown }>).map(
      ({ Name, Value }) => [Name, Value],
    ),
  );
}

describe("deployment configuration", () => {
  it("validates deployment stages", () => {
    expect(parseDeploymentStage("test")).toBe("test");
    expect(parseDeploymentStage("preprod")).toBe("preprod");
    expect(parseDeploymentStage("prod")).toBe("prod");
    expect(() => parseDeploymentStage("local")).toThrow(
      "Unsupported deployment stage",
    );
  });

  it("makes production more resilient and restrictive", () => {
    const test = deploymentConfig("test");
    const preprod = deploymentConfig("preprod");
    const prod = deploymentConfig("prod");

    expect(prod.desiredCount).toBeGreaterThan(test.desiredCount);
    expect(prod.natGateways).toBeGreaterThan(test.natGateways);
    expect(prod.databaseMultiAz).toBe(true);
    expect(prod.databaseDeletionProtection).toBe(true);
    expect(prod.wafRateLimit).toBeLessThan(preprod.wafRateLimit);
    expect(preprod.wafRateLimit).toBeLessThan(test.wafRateLimit);
  });
});

describe("EagleBankStack", () => {
  it("models the complete private runtime topology", () => {
    const output = template();
    output.resourceCountIs("AWS::EC2::VPC", 1);
    output.resourceCountIs("AWS::ECS::Service", 5);
    output.resourceCountIs("AWS::ECS::TaskDefinition", 6);
    output.resourceCountIs("AWS::SQS::Queue", 4);
    output.resourceCountIs("AWS::RDS::DBInstance", 1);
    output.resourceCountIs("AWS::Logs::LogGroup", 6);

    output.allResourcesProperties("AWS::ECS::Service", {
      NetworkConfiguration: {
        AwsvpcConfiguration: {
          AssignPublicIp: "DISABLED",
        },
      },
      DeploymentConfiguration: Match.objectLike({
        DeploymentCircuitBreaker: {
          Enable: true,
          Rollback: true,
        },
        MinimumHealthyPercent: 100,
      }),
    });
    output.hasResourceProperties("AWS::ECS::Cluster", {
      ClusterSettings: [{ Name: "containerInsights", Value: "enabled" }],
      ServiceConnectDefaults: Match.anyValue(),
    });
    output.hasResourceProperties("AWS::ECS::Service", {
      ServiceConnectConfiguration: Match.objectLike({
        Enabled: true,
        Services: [
          Match.objectLike({
            DiscoveryName: "auth-service",
            PortName: "auth-service",
          }),
        ],
      }),
    });
    output.hasResourceProperties("AWS::ECS::Service", {
      ServiceConnectConfiguration: Match.objectLike({
        Enabled: true,
        Services: [
          Match.objectLike({
            DiscoveryName: "ledger-service",
            PortName: "ledger-service",
          }),
        ],
      }),
    });
  });

  it("provides deployable database and private-service configuration", () => {
    const output = template();
    const api = container(output, "api");
    const auth = container(output, "auth-service");
    const migration = container(output, "migration");
    const apiEnvironment = environment(api);

    expect(apiEnvironment.AUTH_SERVICE_BASE_URL).toBe(
      "http://auth-service:3001",
    );
    expect(apiEnvironment.LEDGER_SERVICE_BASE_URL).toBe(
      "http://ledger-service:3002",
    );
    expect(apiEnvironment.DATABASE_NAME).toBe("eagle_bank");
    expect(JSON.stringify(api.Command)).toContain("export DATABASE_URL=");
    expect(JSON.stringify(auth.Command)).toContain("export DATABASE_URL=");
    expect(JSON.stringify(migration.Command)).toContain(
      '\\"prisma\\" \\"migrate\\" \\"deploy\\"'
    );

    const migrationSecrets = migration.Secrets as Array<{ Name: string }>;
    expect(migrationSecrets.map(({ Name }) => Name).sort()).toEqual([
      "DATABASE_PASSWORD",
      "DATABASE_USERNAME",
    ]);
  });

  it("protects persistence and messaging resources", () => {
    const output = template();
    output.hasResourceProperties("AWS::RDS::DBInstance", {
      DBName: "eagle_bank",
      Engine: "postgres",
      PubliclyAccessible: false,
      StorageEncrypted: true,
    });
    output.hasResourceProperties("AWS::DynamoDB::Table", {
      BillingMode: "PAY_PER_REQUEST",
      SSESpecification: { SSEEnabled: true },
      TimeToLiveSpecification: {
        AttributeName: "expiresAtEpoch",
        Enabled: true,
      },
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
    });
    output.allResourcesProperties("AWS::SQS::Queue", {
      SqsManagedSseEnabled: true,
    });
    output.hasResourceProperties("AWS::SQS::Queue", {
      FifoQueue: true,
      QueueName: Match.stringLikeRegexp("ledger-commands\\.fifo$"),
    });
    output.hasResourceProperties("AWS::SQS::QueuePolicy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Condition: {
              Bool: { "aws:SecureTransport": "false" },
            },
            Effect: "Deny",
          }),
        ]),
      }),
    });
  });

  it("routes only API and Auth publicly and returns 404 by default", () => {
    const output = template();
    output.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
      DefaultActions: [
        {
          FixedResponseConfig: { StatusCode: "404" },
          Type: "fixed-response",
        },
      ],
    });
    output.hasResourceProperties("AWS::ElasticLoadBalancingV2::ListenerRule", {
      Priority: 10,
      Conditions: [
        {
          Field: "path-pattern",
          PathPatternConfig: { Values: ["/v1/auth/*"] },
        },
      ],
    });
    output.hasResourceProperties("AWS::ElasticLoadBalancingV2::ListenerRule", {
      Priority: 20,
      Conditions: [
        {
          Field: "path-pattern",
          PathPatternConfig: {
            Values: ["/health", "/ready", "/v1/*"],
          },
        },
      ],
    });
    output.resourceCountIs("AWS::ElasticLoadBalancingV2::TargetGroup", 2);
  });

  it("configures all required WAF protections and stage rate limits", () => {
    const output = template();
    output.hasResourceProperties("AWS::WAFv2::WebACL", {
      Rules: Match.arrayWith([
        Match.objectLike({
          Statement: {
            ManagedRuleGroupStatement: {
              Name: "AWSManagedRulesCommonRuleSet",
              VendorName: "AWS",
            },
          },
        }),
        Match.objectLike({
          Statement: {
            ManagedRuleGroupStatement: {
              Name: "AWSManagedRulesKnownBadInputsRuleSet",
              VendorName: "AWS",
            },
          },
        }),
        Match.objectLike({
          Statement: {
            ManagedRuleGroupStatement: {
              Name: "AWSManagedRulesSQLiRuleSet",
              VendorName: "AWS",
            },
          },
        }),
        Match.objectLike({
          Statement: {
            ManagedRuleGroupStatement: {
              Name: "AWSManagedRulesAmazonIpReputationList",
              VendorName: "AWS",
            },
          },
        }),
        Match.objectLike({
          Statement: {
            RateBasedStatement: {
              AggregateKeyType: "IP",
              Limit: 5000,
            },
          },
        }),
      ]),
    });
    output.hasResourceProperties("AWS::WAFv2::WebACLAssociation", {
      ResourceArn: Match.anyValue(),
      WebACLArn: Match.anyValue(),
    });
  });

  it("uses least-privilege service roles and no local AWS overrides", () => {
    const output = template();
    const json = JSON.stringify(output.toJSON());
    expect(json).not.toContain("DYNAMODB_ENDPOINT");
    expect(json).not.toContain("SQS_ENDPOINT");
    expect(json).not.toContain("AWS_ACCESS_KEY_ID");
    expect(json).not.toContain("AWS_SECRET_ACCESS_KEY");

    const policies = output.findResources("AWS::IAM::Policy");
    const apiPolicies = Object.entries(policies)
      .filter(([id]) => id.startsWith("ApiTaskTaskRole"))
      .map(([, policy]) => JSON.stringify(policy));
    expect(apiPolicies.join("")).not.toContain("dynamodb:");
    expect(apiPolicies.join("")).not.toContain("sqs:");

    const authPolicies = Object.entries(policies)
      .filter(([id]) => id.startsWith("AuthTaskTaskRole"))
      .map(([, policy]) => JSON.stringify(policy));
    expect(authPolicies.join("")).toContain("dynamodb:GetItem");
    expect(authPolicies.join("")).not.toContain("sqs:");

    const publisherPolicies = Object.entries(policies)
      .filter(([id]) => id.startsWith("LedgerEventPublisherTaskTaskRole"))
      .map(([, policy]) => JSON.stringify(policy));
    expect(publisherPolicies.join("")).toContain("sqs:SendMessage");

    const workerPolicies = Object.entries(policies)
      .filter(([id]) => id.startsWith("LedgerWorkerTaskTaskRole"))
      .map(([, policy]) => JSON.stringify(policy));
    expect(workerPolicies.join("")).toContain("sqs:ReceiveMessage");
    expect(workerPolicies.join("")).not.toContain("dynamodb:");
  });

  it("requires TLS and stronger availability for production", () => {
    expect(() => template("prod")).toThrow(
      "certificateArn is required for the prod stage",
    );

    const output = template("prod", TEST_CERTIFICATE_ARN);
    output.hasResourceProperties("AWS::RDS::DBInstance", {
      DeletionProtection: true,
      MultiAZ: true,
    });
    output.allResourcesProperties("AWS::ECS::Service", {
      DesiredCount: 2,
    });
    output.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
      Port: 443,
      Protocol: "HTTPS",
    });
    output.hasResourceProperties("AWS::WAFv2::WebACL", {
      Rules: Match.arrayWith([
        Match.objectLike({
          Statement: {
            RateBasedStatement: {
              AggregateKeyType: "IP",
              Limit: 1000,
            },
          },
        }),
      ]),
    });
  });
});
