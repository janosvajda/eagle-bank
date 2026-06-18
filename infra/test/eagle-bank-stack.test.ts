import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { EagleBankStack } from '../lib/eagle-bank-stack.js';
import {
  deploymentConfig,
  parseDeploymentStage,
  type DeploymentStage,
} from '../lib/deployment-config.js';

const TEST_ACCOUNT = '111111111111';
const TEST_REGION = 'eu-west-2';
const TEST_CERTIFICATE_ARN =
  'arn:aws:acm:eu-west-2:111111111111:certificate/test';

function template(
  stage: DeploymentStage = 'test',
  certificateArn?: string,
  activateServices = true,
): Template {
  const app = new App();
  const effectiveCertificateArn =
    certificateArn ??
    (stage === 'test' && activateServices ? TEST_CERTIFICATE_ARN : undefined);
  return Template.fromStack(
    new EagleBankStack(app, `TestStack-${stage}`, {
      env: { account: TEST_ACCOUNT, region: TEST_REGION },
      stage,
      certificateArn: effectiveCertificateArn,
      activateServices,
    }),
  );
}

function containers(output: Template): Array<Record<string, unknown>> {
  const tasks = output.findResources('AWS::ECS::TaskDefinition');
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

describe('deployment configuration', () => {
  it('validates deployment stages', () => {
    expect(parseDeploymentStage('test')).toBe('test');
    expect(parseDeploymentStage('preprod')).toBe('preprod');
    expect(parseDeploymentStage('prod')).toBe('prod');
    expect(() => parseDeploymentStage('local')).toThrow(
      'Unsupported deployment stage',
    );
  });

  it('makes production more resilient and restrictive', () => {
    const test = deploymentConfig('test');
    const preprod = deploymentConfig('preprod');
    const prod = deploymentConfig('prod');

    expect(prod.desiredCount).toBeGreaterThan(test.desiredCount);
    expect(prod.natGateways).toBeGreaterThan(test.natGateways);
    expect(prod.databaseMultiAz).toBe(true);
    expect(prod.databaseDeletionProtection).toBe(true);
    expect(prod.wafRateLimit).toBeLessThan(preprod.wafRateLimit);
    expect(preprod.wafRateLimit).toBeLessThan(test.wafRateLimit);
  });
});

describe('EagleBankStack', () => {
  it('models the complete private runtime topology', () => {
    const output = template();
    output.resourceCountIs('AWS::EC2::VPC', 1);
    output.resourceCountIs('AWS::ECS::Service', 4);
    output.resourceCountIs('AWS::ECS::TaskDefinition', 5);
    output.resourceCountIs('AWS::SQS::Queue', 2);
    output.resourceCountIs('AWS::RDS::DBInstance', 1);
    output.resourceCountIs('AWS::RDS::DBParameterGroup', 1);
    output.resourceCountIs('AWS::Logs::LogGroup', 5);
    output.resourceCountIs('AWS::Logs::MetricFilter', 5);
    output.resourceCountIs('AWS::CloudWatch::Dashboard', 1);
    output.resourceCountIs('AWS::SecretsManager::Secret', 0);

    output.allResourcesProperties('AWS::ECS::Service', {
      NetworkConfiguration: {
        AwsvpcConfiguration: {
          AssignPublicIp: 'DISABLED',
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
    output.allResourcesProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          User: '1000:1000',
          LinuxParameters: {
            Capabilities: {
              Drop: ['ALL'],
            },
            InitProcessEnabled: true,
          },
        }),
      ]),
    });
    output.hasResourceProperties('AWS::ECS::Cluster', {
      ClusterSettings: [{ Name: 'containerInsights', Value: 'enabled' }],
      ServiceConnectDefaults: Match.anyValue(),
    });
    output.hasResourceProperties('AWS::ECS::Service', {
      ServiceConnectConfiguration: Match.objectLike({
        Enabled: true,
        Services: [
          Match.objectLike({
            DiscoveryName: 'auth-service',
            PortName: 'auth-service',
          }),
        ],
      }),
    });
    output.hasResourceProperties('AWS::ECS::Service', {
      ServiceConnectConfiguration: Match.objectLike({
        Enabled: true,
        Services: [
          Match.objectLike({
            DiscoveryName: 'ledger-service',
            PortName: 'ledger-service',
          }),
        ],
      }),
    });
  });

  it('surfaces structured application errors on an operations dashboard', () => {
    const output = template();
    output.allResourcesProperties('AWS::Logs::MetricFilter', {
      FilterPattern: '{ $.level >= 50 }',
      MetricTransformations: [
        Match.objectLike({
          MetricNamespace: 'EagleBank/test',
          MetricValue: '1',
        }),
      ],
    });
    output.hasResourceProperties('AWS::CloudWatch::Dashboard', {
      DashboardName: 'eagle-bank-test-operations',
      DashboardBody: Match.anyValue(),
    });
    const dashboards = output.findResources('AWS::CloudWatch::Dashboard');
    const dashboardBody = JSON.stringify(
      Object.values(dashboards)[0]?.Properties?.DashboardBody,
    );
    expect(dashboardBody).toContain('Recent application errors');
    expect(dashboardBody).toContain('filter level >= 50');
  });

  it('provides deployable database and private-service configuration', () => {
    const output = template();
    const api = container(output, 'api');
    const auth = container(output, 'auth-service');
    const migration = container(output, 'migration');
    const apiEnvironment = environment(api);

    expect(apiEnvironment.AUTH_SERVICE_BASE_URL).toBe(
      'http://auth-service:3001',
    );
    expect(apiEnvironment.LEDGER_SERVICE_BASE_URL).toBe(
      'http://ledger-service:3002',
    );
    expect(apiEnvironment.DATABASE_NAME).toBe('eagle_bank');
    expect(apiEnvironment.DATABASE_USERNAME).toBe('eagle');
    expect(apiEnvironment).not.toHaveProperty('DYNAMODB_ENDPOINT');
    expect(apiEnvironment).not.toHaveProperty('SQS_ENDPOINT');
    expect(JSON.stringify(api.Command)).toContain('export DATABASE_URL=');
    expect(JSON.stringify(auth.Command)).toContain('export DATABASE_URL=');
    expect(JSON.stringify(migration.Command)).toContain(
      '\\"node_modules/.bin/prisma\\" \\"migrate\\" \\"deploy\\"',
    );
    expect(JSON.stringify(api.Command)).toContain('sslmode=require');

    const migrationSecrets = migration.Secrets as Array<{ Name: string }>;
    expect(migrationSecrets.map(({ Name }) => Name)).toEqual([
      'DATABASE_PASSWORD',
    ]);
    expect(JSON.stringify(migration.Secrets)).toContain(
      '/eagle-bank-test/secrets/database-password',
    );

    const apiSecrets = api.Secrets as Array<{ Name: string }>;
    expect(apiSecrets.map(({ Name }) => Name).sort()).toEqual([
      'AUTH_SERVICE_JWT_SECRET',
      'DATABASE_PASSWORD',
      'JWT_SECRET',
      'LEDGER_SERVICE_JWT_SECRET',
    ]);
    const authSecrets = auth.Secrets as Array<{ Name: string }>;
    expect(authSecrets.map(({ Name }) => Name).sort()).toEqual([
      'AUTH_SERVICE_JWT_SECRET',
      'DATABASE_PASSWORD',
      'JWT_SECRET',
    ]);
    const ledger = container(output, 'ledger-service');
    const ledgerSecrets = ledger.Secrets as Array<{ Name: string }>;
    expect(ledgerSecrets.map(({ Name }) => Name).sort()).toEqual([
      'DATABASE_PASSWORD',
      'LEDGER_SERVICE_JWT_SECRET',
    ]);
    const publisher = container(output, 'ledger-event-publisher');
    const publisherSecrets = publisher.Secrets as Array<{ Name: string }>;
    expect(publisherSecrets.map(({ Name }) => Name)).toEqual([
      'DATABASE_PASSWORD',
    ]);

    const serializedTemplate = JSON.stringify(output.toJSON());
    expect(serializedTemplate).toContain('/eagle-bank-test/secrets/user-jwt');
    expect(serializedTemplate).toContain(
      '/eagle-bank-test/secrets/auth-service-jwt',
    );
    expect(serializedTemplate).toContain(
      '/eagle-bank-test/secrets/ledger-service-jwt',
    );
    expect(serializedTemplate).toContain('ssm:GetParameters');
  });

  it('protects persistence and messaging resources', () => {
    const output = template();
    output.hasResourceProperties('AWS::RDS::DBInstance', {
      DBName: 'eagle_bank',
      Engine: 'postgres',
      PubliclyAccessible: false,
      StorageEncrypted: true,
    });
    output.hasResourceProperties('AWS::RDS::DBParameterGroup', {
      Parameters: {
        'rds.force_ssl': '1',
      },
    });
    output.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
      SSESpecification: { SSEEnabled: true },
      TimeToLiveSpecification: {
        AttributeName: 'expiresAtEpoch',
        Enabled: true,
      },
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
    });
    output.allResourcesProperties('AWS::SQS::Queue', {
      SqsManagedSseEnabled: true,
    });
    output.hasResourceProperties('AWS::SQS::QueuePolicy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Condition: {
              Bool: { 'aws:SecureTransport': 'false' },
            },
            Effect: 'Deny',
          }),
        ]),
      }),
    });
  });

  it('routes only API and Auth publicly and returns 404 by default', () => {
    const output = template();
    output.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      DefaultActions: [
        {
          FixedResponseConfig: { StatusCode: '404' },
          Type: 'fixed-response',
        },
      ],
    });
    output.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
      Priority: 10,
      Conditions: [
        {
          Field: 'path-pattern',
          PathPatternConfig: { Values: ['/v1/auth/*'] },
        },
      ],
    });
    output.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
      Priority: 20,
      Conditions: [
        {
          Field: 'path-pattern',
          PathPatternConfig: {
            Values: ['/health', '/ready', '/v1/*'],
          },
        },
      ],
    });
    output.resourceCountIs('AWS::ElasticLoadBalancingV2::TargetGroup', 2);
  });

  it('configures all required WAF protections and stage rate limits', () => {
    const output = template();
    output.hasResourceProperties('AWS::WAFv2::WebACL', {
      Rules: Match.arrayWith([
        Match.objectLike({
          Statement: {
            ManagedRuleGroupStatement: {
              Name: 'AWSManagedRulesCommonRuleSet',
              VendorName: 'AWS',
            },
          },
        }),
        Match.objectLike({
          Statement: {
            ManagedRuleGroupStatement: {
              Name: 'AWSManagedRulesKnownBadInputsRuleSet',
              VendorName: 'AWS',
            },
          },
        }),
        Match.objectLike({
          Statement: {
            ManagedRuleGroupStatement: {
              Name: 'AWSManagedRulesSQLiRuleSet',
              VendorName: 'AWS',
            },
          },
        }),
        Match.objectLike({
          Statement: {
            ManagedRuleGroupStatement: {
              Name: 'AWSManagedRulesAmazonIpReputationList',
              VendorName: 'AWS',
            },
          },
        }),
        Match.objectLike({
          Name: 'login-rate-limit',
          Statement: {
            RateBasedStatement: Match.objectLike({
              AggregateKeyType: 'IP',
              Limit: 200,
            }),
          },
        }),
        Match.objectLike({
          Name: 'registration-rate-limit',
          Statement: {
            RateBasedStatement: Match.objectLike({
              AggregateKeyType: 'IP',
              Limit: 100,
            }),
          },
        }),
        Match.objectLike({
          Name: 'rate-limit',
          Statement: {
            RateBasedStatement: {
              AggregateKeyType: 'IP',
              Limit: 5000,
            },
          },
        }),
      ]),
    });
    output.hasResourceProperties('AWS::WAFv2::WebACLAssociation', {
      ResourceArn: Match.anyValue(),
      WebACLArn: Match.anyValue(),
    });
  });

  it('uses least-privilege service roles and no local AWS overrides', () => {
    const output = template();
    const json = JSON.stringify(output.toJSON());
    expect(json).not.toContain('DYNAMODB_ENDPOINT');
    expect(json).not.toContain('SQS_ENDPOINT');
    expect(json).not.toContain('AWS_ACCESS_KEY_ID');
    expect(json).not.toContain('AWS_SECRET_ACCESS_KEY');

    const policies = output.findResources('AWS::IAM::Policy');
    const apiPolicies = Object.entries(policies)
      .filter(([id]) => id.startsWith('ApiTaskTaskRole'))
      .map(([, policy]) => JSON.stringify(policy));
    expect(apiPolicies.join('')).not.toContain('dynamodb:');
    expect(apiPolicies.join('')).not.toContain('sqs:');

    const authPolicies = Object.entries(policies)
      .filter(([id]) => id.startsWith('AuthTaskTaskRole'))
      .map(([, policy]) => JSON.stringify(policy));
    expect(authPolicies.join('')).toContain('dynamodb:GetItem');
    expect(authPolicies.join('')).not.toContain('sqs:');

    const publisherPolicies = Object.entries(policies)
      .filter(([id]) => id.startsWith('LedgerEventPublisherTaskTaskRole'))
      .map(([, policy]) => JSON.stringify(policy));
    expect(publisherPolicies.join('')).toContain('sqs:SendMessage');
  });

  it('requires TLS and stronger availability for production', () => {
    expect(() => template('prod')).toThrow(
      'certificateArn is required for active prod services',
    );

    const output = template('prod', TEST_CERTIFICATE_ARN);
    output.hasResourceProperties('AWS::RDS::DBInstance', {
      DeletionProtection: true,
      MultiAZ: true,
    });
    output.allResourcesProperties('AWS::ECS::Service', {
      DesiredCount: 2,
    });
    output.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 443,
      Protocol: 'HTTPS',
      SslPolicy: 'ELBSecurityPolicy-TLS13-1-2-2021-06',
    });
    output.hasResourceProperties('AWS::WAFv2::WebACL', {
      Rules: Match.arrayWith([
        Match.objectLike({
          Statement: {
            RateBasedStatement: {
              AggregateKeyType: 'IP',
              Limit: 1000,
            },
          },
        }),
      ]),
    });
  });

  it('requires TLS for preproduction deployments', () => {
    expect(() => template('preprod')).toThrow(
      'certificateArn is required for active preprod services',
    );
    template('preprod', TEST_CERTIFICATE_ARN).hasResourceProperties(
      'AWS::ElasticLoadBalancingV2::Listener',
      {
        Port: 443,
        Protocol: 'HTTPS',
      },
    );
  });

  it('keeps services stopped until migrations are explicitly completed', () => {
    const output = template('test', undefined, false);
    output.allResourcesProperties('AWS::ECS::Service', {
      DesiredCount: 0,
    });
    output.hasOutput('ServicesActivated', { Value: 'false' });
    output.hasOutput('MigrationTaskDefinitionArn', {
      Value: Match.anyValue(),
    });
    output.hasOutput('MigrationSubnetIds', { Value: Match.anyValue() });
    output.hasOutput('MigrationSecurityGroupId', {
      Value: Match.anyValue(),
    });
  });
});
