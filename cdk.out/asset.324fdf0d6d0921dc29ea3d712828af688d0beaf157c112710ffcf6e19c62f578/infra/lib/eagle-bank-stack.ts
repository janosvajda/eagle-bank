import {
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
  aws_dynamodb as dynamodb,
  aws_ec2 as ec2,
  aws_ecs as ecs,
  aws_elasticloadbalancingv2 as elbv2,
  aws_logs as logs,
  aws_rds as rds,
  aws_secretsmanager as secretsmanager,
  aws_sqs as sqs,
  aws_wafv2 as wafv2
} from "aws-cdk-lib";
import type { Construct } from "constructs";

export class EagleBankStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24
        },
        {
          name: "services",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24
        },
        {
          name: "database",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24
        }
      ]
    });
    const cluster = new ecs.Cluster(this, "Cluster", { vpc });
    const databaseSecret = new rds.DatabaseSecret(this, "DatabaseSecret", {
      username: "eagle"
    });
    const jwtSecret = new secretsmanager.Secret(this, "JwtSecret");
    const internalJwtSecret = new secretsmanager.Secret(this, "InternalJwtSecret");

    const databaseSg = new ec2.SecurityGroup(this, "DatabaseSecurityGroup", {
      vpc,
      allowAllOutbound: false
    });
    const serviceSg = new ec2.SecurityGroup(this, "ServiceSecurityGroup", {
      vpc
    });
    databaseSg.addIngressRule(serviceSg, ec2.Port.tcp(5432));
    const database = new rds.DatabaseInstance(this, "Database", {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [databaseSg],
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16
      }),
      credentials: rds.Credentials.fromSecret(databaseSecret),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        ec2.InstanceSize.MICRO
      ),
      allocatedStorage: 20,
      multiAz: false,
      publiclyAccessible: false,
      removalPolicy: RemovalPolicy.SNAPSHOT
    });

    const sessions = new dynamodb.Table(this, "AuthSessions", {
      tableName: "eagle-bank-auth-sessions",
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: "expiresAtEpoch",
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true
      }
    });
    const eventsDlq = new sqs.Queue(this, "LedgerEventsDlq", {
      queueName: "eagle-bank-ledger-events-dlq"
    });
    const events = new sqs.Queue(this, "LedgerEvents", {
      queueName: "eagle-bank-ledger-events",
      deadLetterQueue: { queue: eventsDlq, maxReceiveCount: 5 }
    });
    const commandsDlq = new sqs.Queue(this, "LedgerCommandsDlq", {
      queueName: "eagle-bank-ledger-command-dlq.fifo",
      fifo: true,
      contentBasedDeduplication: true
    });
    const commands = new sqs.Queue(this, "LedgerCommands", {
      queueName: "eagle-bank-ledger-commands.fifo",
      fifo: true,
      contentBasedDeduplication: true,
      deadLetterQueue: { queue: commandsDlq, maxReceiveCount: 5 }
    });

    const commonEnvironment = {
      NODE_ENV: "prod",
      AWS_REGION: this.region,
      DATABASE_HOST: database.dbInstanceEndpointAddress,
      DATABASE_PORT: database.dbInstanceEndpointPort,
      DYNAMODB_AUTH_SESSIONS_TABLE: sessions.tableName,
      SQS_LEDGER_EVENTS_QUEUE_URL: events.queueUrl,
      SQS_LEDGER_COMMANDS_QUEUE_URL: commands.queueUrl,
      LEDGER_ASYNC_COMMANDS_ENABLED: "false"
    };
    const image = ecs.ContainerImage.fromAsset(".");
    const makeTask = (name: string, command: string[], port?: number) => {
      const task = new ecs.FargateTaskDefinition(this, `${name}Task`, {
        cpu: 256,
        memoryLimitMiB: 512
      });
      const logGroup = new logs.LogGroup(this, `${name}Logs`, {
        retention: logs.RetentionDays.ONE_MONTH
      });
      const container = task.addContainer(name, {
        image,
        command,
        logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: name }),
        environment: commonEnvironment,
        secrets: {
          JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret),
          INTERNAL_SERVICE_JWT_SECRET:
            ecs.Secret.fromSecretsManager(internalJwtSecret),
          DATABASE_SECRET: ecs.Secret.fromSecretsManager(databaseSecret)
        }
      });
      if (port) container.addPortMappings({ containerPort: port });
      return { task, container };
    };

    const apiTask = makeTask("api", ["node", "dist/src/server.js"], 3000);
    const authTask = makeTask(
      "auth-service",
      ["node", "dist/src/services/auth-server.js"],
      3001
    );
    const ledgerTask = makeTask(
      "ledger-service",
      ["node", "dist/src/services/ledger-server.js"],
      3002
    );
    const workerTask = makeTask("ledger-worker", [
      "node",
      "dist/src/services/ledger-worker.js"
    ]);
    const publisherTask = makeTask("ledger-event-publisher", [
      "node",
      "dist/src/services/ledger-event-publisher.js"
    ]);
    makeTask("migration", ["pnpm", "prisma", "migrate", "deploy"]);

    sessions.grantReadWriteData(authTask.task.taskRole);
    events.grantSendMessages(publisherTask.task.taskRole);
    commands.grantConsumeMessages(workerTask.task.taskRole);
    for (const role of [
      apiTask.task.taskRole,
      authTask.task.taskRole,
      ledgerTask.task.taskRole,
      publisherTask.task.taskRole
    ]) {
      databaseSecret.grantRead(role);
    }

    const service = (
      name: string,
      taskDefinition: ecs.FargateTaskDefinition
    ) =>
      new ecs.FargateService(this, `${name}Service`, {
        cluster,
        taskDefinition,
        desiredCount: 1,
        assignPublicIp: false,
        securityGroups: [serviceSg],
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }
      });
    const api = service("Api", apiTask.task);
    const auth = service("Auth", authTask.task);
    service("Ledger", ledgerTask.task);
    service("LedgerWorker", workerTask.task);
    service("LedgerEventPublisher", publisherTask.task);

    const albSg = new ec2.SecurityGroup(this, "AlbSecurityGroup", { vpc });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80));
    serviceSg.addIngressRule(albSg, ec2.Port.tcpRange(3000, 3002));
    const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      vpc,
      internetFacing: true,
      securityGroup: albSg
    });
    const listener = alb.addListener("Http", {
      port: 80,
      defaultAction: elbv2.ListenerAction.fixedResponse(404)
    });
    listener.addTargets("ApiRoutes", {
      priority: 20,
      conditions: [
        elbv2.ListenerCondition.pathPatterns(["/health", "/ready", "/v1/*"])
      ],
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [api],
      healthCheck: { path: "/health" }
    });
    listener.addTargets("AuthRoutes", {
      priority: 10,
      conditions: [elbv2.ListenerCondition.pathPatterns(["/v1/auth/*"])],
      port: 3001,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [auth],
      healthCheck: { path: "/health" }
    });

    const webAcl = new wafv2.CfnWebACL(this, "WebAcl", {
      scope: "REGIONAL",
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: "eagle-bank-waf",
        sampledRequestsEnabled: true
      },
      rules: [
        {
          name: "aws-managed-common",
          priority: 1,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesCommonRuleSet"
            }
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "common-rules",
            sampledRequestsEnabled: true
          }
        },
        {
          name: "rate-limit",
          priority: 2,
          action: { block: {} },
          statement: { rateBasedStatement: { aggregateKeyType: "IP", limit: 1000 } },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "rate-limit",
            sampledRequestsEnabled: true
          }
        }
      ]
    });
    new wafv2.CfnWebACLAssociation(this, "WebAclAssociation", {
      resourceArn: alb.loadBalancerArn,
      webAclArn: webAcl.attrArn
    });
  }
}
