import {
  CfnOutput,
  Duration,
  Stack,
  type StackProps,
  aws_certificatemanager as acm,
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
import {
  deploymentConfig,
  type DeploymentStage
} from "./deployment-config.js";

const DATABASE_NAME = "eagle_bank";
const DATABASE_USERNAME = "eagle";
const DATABASE_PORT = 5432;
const API_PORT = 3000;
const AUTH_PORT = 3001;
const LEDGER_PORT = 3002;
const SERVICE_CONNECT_NAMESPACE = "eagle-bank.internal";
const AUTH_SERVICE_DNS_NAME = "auth-service";
const LEDGER_SERVICE_DNS_NAME = "ledger-service";
const DEFAULT_JWT_EXPIRY = "1h";
const AUTH_SESSION_TTL_SECONDS = "3600";
const QUEUE_MAX_RECEIVE_COUNT = 5;
const TASK_STOP_TIMEOUT = Duration.seconds(30);
const HEALTH_CHECK_GRACE_PERIOD = Duration.seconds(60);
const QUEUE_VISIBILITY_TIMEOUT = Duration.seconds(60);
const QUEUE_RETENTION_PERIOD = Duration.days(4);
const DLQ_RETENTION_PERIOD = Duration.days(14);
const SERVICE_CONNECT_REQUEST_TIMEOUT = Duration.seconds(5);
const SERVICE_CONNECT_IDLE_TIMEOUT = Duration.seconds(30);

interface RuntimeDefinition {
  id: string;
  serviceName: string;
  command: string[];
  port?: number;
}

export interface EagleBankStackProps extends StackProps {
  stage: DeploymentStage;
  certificateArn?: string;
}

export class EagleBankStack extends Stack {
  constructor(scope: Construct, id: string, props: EagleBankStackProps) {
    super(scope, id, props);

    const config = deploymentConfig(props.stage);
    if (config.stage === "prod" && !props.certificateArn) {
      throw new Error("certificateArn is required for the prod stage");
    }

    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: config.availabilityZoneCount,
      natGateways: config.natGateways,
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

    const cluster = new ecs.Cluster(this, "Cluster", {
      vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
      defaultCloudMapNamespace: {
        name: SERVICE_CONNECT_NAMESPACE,
        useForServiceConnect: true
      }
    });

    const databaseSecret = new rds.DatabaseSecret(this, "DatabaseSecret", {
      secretName: `${config.resourcePrefix}/database`,
      username: DATABASE_USERNAME
    });
    const jwtSecret = new secretsmanager.Secret(this, "JwtSecret", {
      secretName: `${config.resourcePrefix}/jwt`
    });
    const internalJwtSecret = new secretsmanager.Secret(
      this,
      "InternalJwtSecret",
      { secretName: `${config.resourcePrefix}/internal-jwt` }
    );

    const databaseSecurityGroup = new ec2.SecurityGroup(
      this,
      "DatabaseSecurityGroup",
      {
        vpc,
        allowAllOutbound: false,
        description: "Accept PostgreSQL only from database client tasks"
      }
    );
    const apiSecurityGroup = this.serviceSecurityGroup(vpc, "Api");
    const authSecurityGroup = this.serviceSecurityGroup(vpc, "Auth");
    const ledgerSecurityGroup = this.serviceSecurityGroup(vpc, "Ledger");
    const workerSecurityGroup = this.serviceSecurityGroup(vpc, "LedgerWorker");
    const publisherSecurityGroup = this.serviceSecurityGroup(
      vpc,
      "LedgerEventPublisher"
    );
    const migrationSecurityGroup = this.serviceSecurityGroup(vpc, "Migration");

    for (const client of [
      apiSecurityGroup,
      authSecurityGroup,
      ledgerSecurityGroup,
      publisherSecurityGroup,
      migrationSecurityGroup
    ]) {
      databaseSecurityGroup.addIngressRule(
        client,
        ec2.Port.tcp(DATABASE_PORT),
        "PostgreSQL from an authorized database client"
      );
    }
    authSecurityGroup.addIngressRule(
      apiSecurityGroup,
      ec2.Port.tcp(AUTH_PORT),
      "Private API to Auth traffic"
    );
    ledgerSecurityGroup.addIngressRule(
      apiSecurityGroup,
      ec2.Port.tcp(LEDGER_PORT),
      "Private API to Ledger traffic"
    );

    const database = new rds.DatabaseInstance(this, "Database", {
      databaseName: DATABASE_NAME,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [databaseSecurityGroup],
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16
      }),
      credentials: rds.Credentials.fromSecret(databaseSecret),
      instanceType: config.databaseInstanceType,
      allocatedStorage: config.databaseAllocatedStorageGiB,
      maxAllocatedStorage: config.databaseMaxAllocatedStorageGiB,
      storageEncrypted: true,
      multiAz: config.databaseMultiAz,
      publiclyAccessible: false,
      deletionProtection: config.databaseDeletionProtection,
      backupRetention: config.databaseBackupRetention,
      autoMinorVersionUpgrade: true,
      cloudwatchLogsExports: ["postgresql"],
      cloudwatchLogsRetention: config.logRetention,
      removalPolicy: config.removalPolicy
    });

    const sessions = new dynamodb.Table(this, "AuthSessions", {
      tableName: `${config.resourcePrefix}-auth-sessions`,
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: "expiresAtEpoch",
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true
      },
      removalPolicy: config.removalPolicy
    });

    const eventsDlq = this.queue("LedgerEventsDlq", {
      queueName: `${config.resourcePrefix}-ledger-events-dlq`,
      retentionPeriod: DLQ_RETENTION_PERIOD
    });
    const events = this.queue("LedgerEvents", {
      queueName: `${config.resourcePrefix}-ledger-events`,
      visibilityTimeout: QUEUE_VISIBILITY_TIMEOUT,
      retentionPeriod: QUEUE_RETENTION_PERIOD,
      deadLetterQueue: {
        queue: eventsDlq,
        maxReceiveCount: QUEUE_MAX_RECEIVE_COUNT
      }
    });
    const commandsDlq = this.queue("LedgerCommandsDlq", {
      queueName: `${config.resourcePrefix}-ledger-commands-dlq.fifo`,
      fifo: true,
      contentBasedDeduplication: true,
      retentionPeriod: DLQ_RETENTION_PERIOD
    });
    const commands = this.queue("LedgerCommands", {
      queueName: `${config.resourcePrefix}-ledger-commands.fifo`,
      fifo: true,
      contentBasedDeduplication: true,
      visibilityTimeout: QUEUE_VISIBILITY_TIMEOUT,
      retentionPeriod: QUEUE_RETENTION_PERIOD,
      deadLetterQueue: {
        queue: commandsDlq,
        maxReceiveCount: QUEUE_MAX_RECEIVE_COUNT
      }
    });

    const commonEnvironment = {
      NODE_ENV: config.stage,
      AWS_REGION: this.region,
      DATABASE_HOST: database.dbInstanceEndpointAddress,
      DATABASE_PORT: database.dbInstanceEndpointPort,
      DATABASE_NAME,
      DYNAMODB_AUTH_SESSIONS_TABLE: sessions.tableName,
      SQS_LEDGER_EVENTS_QUEUE_URL: events.queueUrl,
      SQS_LEDGER_EVENTS_DLQ_URL: eventsDlq.queueUrl,
      SQS_LEDGER_COMMANDS_QUEUE_URL: commands.queueUrl,
      SQS_LEDGER_COMMANDS_DLQ_URL: commandsDlq.queueUrl,
      LEDGER_ASYNC_COMMANDS_ENABLED: "false"
    };
    const databaseSecrets = {
      DATABASE_USERNAME: ecs.Secret.fromSecretsManager(
        databaseSecret,
        "username"
      ),
      DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(
        databaseSecret,
        "password"
      )
    };
    const applicationSecrets = {
      JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret),
      INTERNAL_SERVICE_JWT_SECRET:
        ecs.Secret.fromSecretsManager(internalJwtSecret)
    };
    const image = ecs.ContainerImage.fromAsset(".");

    const makeTask = (
      definition: RuntimeDefinition,
      environment: Record<string, string> = {},
      includeDatabase = true
    ) => {
      const task = new ecs.FargateTaskDefinition(
        this,
        `${definition.id}Task`,
        {
          cpu: config.serviceCpu,
          memoryLimitMiB: config.serviceMemoryMiB
        }
      );
      const logGroup = new logs.LogGroup(this, `${definition.id}Logs`, {
        logGroupName: `/eagle-bank/${config.stage}/${definition.serviceName}`,
        retention: config.logRetention,
        removalPolicy: config.removalPolicy
      });
      const container = task.addContainer(definition.serviceName, {
        image,
        command: includeDatabase
          ? this.databaseCommand(definition.command)
          : definition.command,
        stopTimeout: TASK_STOP_TIMEOUT,
        logging: ecs.LogDrivers.awsLogs({
          logGroup,
          streamPrefix: definition.serviceName
        }),
        environment: {
          ...commonEnvironment,
          SERVICE_NAME: definition.serviceName,
          ...environment
        },
        secrets: {
          ...applicationSecrets,
          ...(includeDatabase ? databaseSecrets : {})
        }
      });
      if (definition.port) {
        container.addPortMappings({
          name: definition.serviceName,
          containerPort: definition.port,
          appProtocol: ecs.AppProtocol.http
        });
      }
      return { task, container, logGroup };
    };

    const apiTask = makeTask(
      {
        id: "Api",
        serviceName: "api",
        command: ["node", "dist/src/server.js"],
        port: API_PORT
      },
      {
        PORT: String(API_PORT),
        JWT_EXPIRES_IN: DEFAULT_JWT_EXPIRY,
        AUTH_SERVICE_BASE_URL: `http://${AUTH_SERVICE_DNS_NAME}:${AUTH_PORT}`,
        LEDGER_SERVICE_BASE_URL: `http://${LEDGER_SERVICE_DNS_NAME}:${LEDGER_PORT}`
      }
    );
    const authTask = makeTask(
      {
        id: "Auth",
        serviceName: AUTH_SERVICE_DNS_NAME,
        command: ["node", "dist/src/services/auth-server.js"],
        port: AUTH_PORT
      },
      {
        PORT: String(AUTH_PORT),
        AUTH_SERVICE_PORT: String(AUTH_PORT),
        JWT_EXPIRES_IN: DEFAULT_JWT_EXPIRY,
        AUTH_SESSION_TTL_SECONDS
      }
    );
    const ledgerTask = makeTask(
      {
        id: "Ledger",
        serviceName: LEDGER_SERVICE_DNS_NAME,
        command: ["node", "dist/src/services/ledger-server.js"],
        port: LEDGER_PORT
      },
      {
        PORT: String(LEDGER_PORT),
        LEDGER_SERVICE_PORT: String(LEDGER_PORT)
      }
    );
    const workerTask = makeTask(
      {
        id: "LedgerWorker",
        serviceName: "ledger-worker",
        command: ["node", "dist/src/services/ledger-worker.js"]
      },
      {},
      false
    );
    const publisherTask = makeTask({
      id: "LedgerEventPublisher",
      serviceName: "ledger-event-publisher",
      command: ["node", "dist/src/services/ledger-event-publisher.js"]
    });
    const migrationTask = makeTask({
      id: "Migration",
      serviceName: "migration",
      command: ["pnpm", "prisma", "migrate", "deploy"]
    });

    sessions.grantReadWriteData(authTask.task.taskRole);
    events.grantSendMessages(publisherTask.task.taskRole);
    commands.grantConsumeMessages(workerTask.task.taskRole);
    for (const role of [
      apiTask.task.taskRole,
      authTask.task.taskRole,
      ledgerTask.task.taskRole,
      publisherTask.task.taskRole,
      migrationTask.task.taskRole
    ]) {
      databaseSecret.grantRead(role);
    }

    const service = (
      id: string,
      taskDefinition: ecs.FargateTaskDefinition,
      securityGroup: ec2.SecurityGroup,
      serviceConnectConfiguration?: ecs.ServiceConnectProps
    ) =>
      new ecs.FargateService(this, `${id}Service`, {
        serviceName: `${config.resourcePrefix}-${id.toLowerCase()}`,
        cluster,
        taskDefinition,
        desiredCount: config.desiredCount,
        assignPublicIp: false,
        enableExecuteCommand: config.stage !== "prod",
        healthCheckGracePeriod: HEALTH_CHECK_GRACE_PERIOD,
        securityGroups: [securityGroup],
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        serviceConnectConfiguration
      });

    const api = service("Api", apiTask.task, apiSecurityGroup, {});
    const auth = service("Auth", authTask.task, authSecurityGroup, {
      services: [
        {
          portMappingName: AUTH_SERVICE_DNS_NAME,
          discoveryName: AUTH_SERVICE_DNS_NAME,
          dnsName: AUTH_SERVICE_DNS_NAME,
          port: AUTH_PORT,
          idleTimeout: SERVICE_CONNECT_IDLE_TIMEOUT,
          perRequestTimeout: SERVICE_CONNECT_REQUEST_TIMEOUT
        }
      ]
    });
    service("Ledger", ledgerTask.task, ledgerSecurityGroup, {
      services: [
        {
          portMappingName: LEDGER_SERVICE_DNS_NAME,
          discoveryName: LEDGER_SERVICE_DNS_NAME,
          dnsName: LEDGER_SERVICE_DNS_NAME,
          port: LEDGER_PORT,
          idleTimeout: SERVICE_CONNECT_IDLE_TIMEOUT,
          perRequestTimeout: SERVICE_CONNECT_REQUEST_TIMEOUT
        }
      ]
    });
    service("LedgerWorker", workerTask.task, workerSecurityGroup, {});
    service(
      "LedgerEventPublisher",
      publisherTask.task,
      publisherSecurityGroup,
      {}
    );

    const albSecurityGroup = new ec2.SecurityGroup(
      this,
      "AlbSecurityGroup",
      {
        vpc,
        allowAllOutbound: false,
        description: "Public ingress to the Eagle Bank ALB"
      }
    );
    const publicListenerPort = props.certificateArn ? 443 : 80;
    albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(publicListenerPort),
      "Public client traffic"
    );
    apiSecurityGroup.addIngressRule(
      albSecurityGroup,
      ec2.Port.tcp(API_PORT),
      "ALB to API"
    );
    authSecurityGroup.addIngressRule(
      albSecurityGroup,
      ec2.Port.tcp(AUTH_PORT),
      "ALB to public Auth routes"
    );
    albSecurityGroup.addEgressRule(
      apiSecurityGroup,
      ec2.Port.tcp(API_PORT),
      "ALB to API"
    );
    albSecurityGroup.addEgressRule(
      authSecurityGroup,
      ec2.Port.tcp(AUTH_PORT),
      "ALB to Auth"
    );

    const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      deletionProtection: config.databaseDeletionProtection
    });
    const certificate = props.certificateArn
      ? acm.Certificate.fromCertificateArn(
          this,
          "AlbCertificate",
          props.certificateArn
        )
      : undefined;
    const listener = alb.addListener("PublicListener", {
      port: publicListenerPort,
      protocol: certificate
        ? elbv2.ApplicationProtocol.HTTPS
        : elbv2.ApplicationProtocol.HTTP,
      certificates: certificate ? [certificate] : undefined,
      sslPolicy: certificate ? elbv2.SslPolicy.RECOMMENDED_TLS : undefined,
      defaultAction: elbv2.ListenerAction.fixedResponse(404)
    });
    if (certificate) {
      alb.addRedirect({
        sourcePort: 80,
        sourceProtocol: elbv2.ApplicationProtocol.HTTP,
        targetPort: 443,
        targetProtocol: elbv2.ApplicationProtocol.HTTPS
      });
      albSecurityGroup.addIngressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(80),
        "Redirect HTTP to HTTPS"
      );
    }
    listener.addTargets("ApiRoutes", {
      priority: 20,
      conditions: [
        elbv2.ListenerCondition.pathPatterns(["/health", "/ready", "/v1/*"])
      ],
      port: API_PORT,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [api],
      healthCheck: { path: "/ready" }
    });
    listener.addTargets("AuthRoutes", {
      priority: 10,
      conditions: [
        elbv2.ListenerCondition.pathPatterns(["/v1/auth/*"])
      ],
      port: AUTH_PORT,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [auth],
      healthCheck: { path: "/ready" }
    });

    const webAcl = new wafv2.CfnWebACL(this, "WebAcl", {
      name: `${config.resourcePrefix}-web-acl`,
      scope: "REGIONAL",
      defaultAction: { allow: {} },
      visibilityConfig: this.wafVisibility(`${config.resourcePrefix}-waf`),
      rules: [
        this.managedWafRule(
          "aws-managed-common",
          1,
          "AWSManagedRulesCommonRuleSet"
        ),
        this.managedWafRule(
          "aws-managed-known-bad-inputs",
          2,
          "AWSManagedRulesKnownBadInputsRuleSet"
        ),
        this.managedWafRule(
          "aws-managed-sqli",
          3,
          "AWSManagedRulesSQLiRuleSet"
        ),
        this.managedWafRule(
          "aws-managed-ip-reputation",
          4,
          "AWSManagedRulesAmazonIpReputationList"
        ),
        {
          name: "rate-limit",
          priority: 5,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              aggregateKeyType: "IP",
              limit: config.wafRateLimit
            }
          },
          visibilityConfig: this.wafVisibility("rate-limit")
        }
      ]
    });
    new wafv2.CfnWebACLAssociation(this, "WebAclAssociation", {
      resourceArn: alb.loadBalancerArn,
      webAclArn: webAcl.attrArn
    });

    new CfnOutput(this, "PublicUrl", {
      value: `${certificate ? "https" : "http"}://${alb.loadBalancerDnsName}`
    });
    new CfnOutput(this, "MigrationClusterName", {
      value: cluster.clusterName
    });
    new CfnOutput(this, "MigrationTaskDefinitionArn", {
      value: migrationTask.task.taskDefinitionArn
    });
    new CfnOutput(this, "MigrationSecurityGroupId", {
      value: migrationSecurityGroup.securityGroupId
    });
    new CfnOutput(this, "MigrationSubnetIds", {
      value: vpc
        .selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS })
        .subnetIds.join(",")
    });
  }

  private serviceSecurityGroup(
    vpc: ec2.IVpc,
    id: string
  ): ec2.SecurityGroup {
    return new ec2.SecurityGroup(this, `${id}SecurityGroup`, {
      vpc,
      allowAllOutbound: true,
      description: `${id} task network access`
    });
  }

  private queue(id: string, props: sqs.QueueProps): sqs.Queue {
    return new sqs.Queue(this, id, {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      ...props
    });
  }

  private databaseCommand(command: string[]): string[] {
    const executable = command.map((part) => JSON.stringify(part)).join(" ");
    const databaseUrl =
      'postgresql://${DATABASE_USERNAME}:${DATABASE_PASSWORD}' +
      '@${DATABASE_HOST}:${DATABASE_PORT}/${DATABASE_NAME}?schema=public';
    return [
      "sh",
      "-c",
      `export DATABASE_URL="${databaseUrl}"; exec ${executable}`
    ];
  }

  private wafVisibility(metricName: string) {
    return {
      cloudWatchMetricsEnabled: true,
      metricName,
      sampledRequestsEnabled: true
    };
  }

  private managedWafRule(
    name: string,
    priority: number,
    managedRuleName: string
  ): wafv2.CfnWebACL.RuleProperty {
    return {
      name,
      priority,
      overrideAction: { none: {} },
      statement: {
        managedRuleGroupStatement: {
          vendorName: "AWS",
          name: managedRuleName
        }
      },
      visibilityConfig: this.wafVisibility(name)
    };
  }
}
