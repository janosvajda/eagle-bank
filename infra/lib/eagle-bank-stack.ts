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
  aws_wafv2 as wafv2,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import {
  deploymentConfig,
  DeploymentStage,
  type DeploymentStage as DeploymentStageType,
} from './deployment-config.js';

const DATABASE_NAME = 'eagle_bank';
const DATABASE_USERNAME = 'eagle';
const DATABASE_PORT = 5432;
const API_PORT = 3000;
const AUTH_PORT = 3001;
const LEDGER_PORT = 3002;
const SERVICE_CONNECT_NAMESPACE = 'eagle-bank.internal';
const API_SERVICE_NAME = 'api';
const AUTH_SERVICE_DNS_NAME = 'auth-service';
const LEDGER_SERVICE_DNS_NAME = 'ledger-service';
const DEFAULT_JWT_EXPIRY = '1h';
const AUTH_SESSION_TTL_SECONDS = '3600';
const QUEUE_MAX_RECEIVE_COUNT = 5;
const TASK_STOP_TIMEOUT_SECONDS = 30;
const HEALTH_CHECK_GRACE_PERIOD_SECONDS = 60;
const QUEUE_VISIBILITY_TIMEOUT_SECONDS = 60;
const QUEUE_RETENTION_DAYS = 4;
const DLQ_RETENTION_DAYS = 14;
const SERVICE_CONNECT_REQUEST_TIMEOUT_SECONDS = 5;
const SERVICE_CONNECT_IDLE_TIMEOUT_SECONDS = 30;
const TASK_STOP_TIMEOUT = Duration.seconds(TASK_STOP_TIMEOUT_SECONDS);
const HEALTH_CHECK_GRACE_PERIOD = Duration.seconds(
  HEALTH_CHECK_GRACE_PERIOD_SECONDS,
);
const QUEUE_VISIBILITY_TIMEOUT = Duration.seconds(
  QUEUE_VISIBILITY_TIMEOUT_SECONDS,
);
const QUEUE_RETENTION_PERIOD = Duration.days(QUEUE_RETENTION_DAYS);
const DLQ_RETENTION_PERIOD = Duration.days(DLQ_RETENTION_DAYS);
const SERVICE_CONNECT_REQUEST_TIMEOUT = Duration.seconds(
  SERVICE_CONNECT_REQUEST_TIMEOUT_SECONDS,
);
const SERVICE_CONNECT_IDLE_TIMEOUT = Duration.seconds(
  SERVICE_CONNECT_IDLE_TIMEOUT_SECONDS,
);
const SUBNET_CIDR_MASK = 24;
const STOPPED_SERVICE_DESIRED_COUNT = 0;
const ECS_MINIMUM_HEALTHY_PERCENT = 100;
const ECS_MAXIMUM_HEALTHY_PERCENT = 200;
const HTTP_PORT = 80;
const HTTPS_PORT = 443;
const DEFAULT_NOT_FOUND_STATUS = 404;
const AUTH_ROUTE_PRIORITY = 10;
const API_ROUTE_PRIORITY = 20;
const WAF_COMMON_RULE_PRIORITY = 1;
const WAF_KNOWN_BAD_INPUTS_RULE_PRIORITY = 2;
const WAF_SQLI_RULE_PRIORITY = 3;
const WAF_IP_REPUTATION_RULE_PRIORITY = 4;
const WAF_RATE_LIMIT_RULE_PRIORITY = 5;

interface RuntimeDefinition {
  id: string;
  serviceName: string;
  command: string[];
  port?: number;
}

interface TaskOptions {
  environment?: Record<string, string>;
  includeApplicationSecrets?: boolean;
  includeDatabase?: boolean;
}

export interface EagleBankStackProps extends StackProps {
  stage: DeploymentStageType;
  certificateArn?: string;
  activateServices?: boolean;
}

export class EagleBankStack extends Stack {
  constructor(scope: Construct, id: string, props: EagleBankStackProps) {
    super(scope, id, props);

    const config = deploymentConfig(props.stage);
    if (config.stage === DeploymentStage.PROD && !props.certificateArn) {
      throw new Error('certificateArn is required for the prod stage');
    }

    // Public subnets contain only the ALB/NAT gateways. Application tasks use
    // private subnets, while RDS has no route to the public internet.
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: config.availabilityZoneCount,
      natGateways: config.natGateways,
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: SUBNET_CIDR_MASK,
        },
        {
          name: 'services',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: SUBNET_CIDR_MASK,
        },
        {
          name: 'database',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: SUBNET_CIDR_MASK,
        },
      ],
    });

    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
      defaultCloudMapNamespace: {
        name: SERVICE_CONNECT_NAMESPACE,
        useForServiceConnect: true,
      },
    });

    // ECS receives secret values at task startup. No secret value is embedded
    // in the synthesized CloudFormation template.
    const databaseSecret = new rds.DatabaseSecret(this, 'DatabaseSecret', {
      secretName: `${config.resourcePrefix}/database`,
      username: DATABASE_USERNAME,
    });
    const jwtSecret = new secretsmanager.Secret(this, 'JwtSecret', {
      secretName: `${config.resourcePrefix}/jwt`,
    });
    const internalJwtSecret = new secretsmanager.Secret(
      this,
      'InternalJwtSecret',
      { secretName: `${config.resourcePrefix}/internal-jwt` },
    );
    databaseSecret.applyRemovalPolicy(config.removalPolicy);
    jwtSecret.applyRemovalPolicy(config.removalPolicy);
    internalJwtSecret.applyRemovalPolicy(config.removalPolicy);

    const databaseSecurityGroup = new ec2.SecurityGroup(
      this,
      'DatabaseSecurityGroup',
      {
        vpc,
        allowAllOutbound: false,
        description: 'Accept PostgreSQL only from database client tasks',
      },
    );
    const apiSecurityGroup = this.serviceSecurityGroup(vpc, 'Api');
    const authSecurityGroup = this.serviceSecurityGroup(vpc, 'Auth');
    const ledgerSecurityGroup = this.serviceSecurityGroup(vpc, 'Ledger');
    const workerSecurityGroup = this.serviceSecurityGroup(vpc, 'LedgerWorker');
    const publisherSecurityGroup = this.serviceSecurityGroup(
      vpc,
      'LedgerEventPublisher',
    );
    const migrationSecurityGroup = this.serviceSecurityGroup(vpc, 'Migration');

    // PostgreSQL accepts traffic only from workloads that actually use it.
    // The worker is intentionally absent because the disabled worker has no DB path.
    for (const client of [
      apiSecurityGroup,
      authSecurityGroup,
      ledgerSecurityGroup,
      publisherSecurityGroup,
      migrationSecurityGroup,
    ]) {
      databaseSecurityGroup.addIngressRule(
        client,
        ec2.Port.tcp(DATABASE_PORT),
        'PostgreSQL from an authorized database client',
      );
    }
    authSecurityGroup.addIngressRule(
      apiSecurityGroup,
      ec2.Port.tcp(AUTH_PORT),
      'Private API to Auth traffic',
    );
    ledgerSecurityGroup.addIngressRule(
      apiSecurityGroup,
      ec2.Port.tcp(LEDGER_PORT),
      'Private API to Ledger traffic',
    );

    // RDS is the durable source for users, accounts, ledger records, and outbox
    // events. Stage configuration controls availability and deletion safeguards.
    const database = new rds.DatabaseInstance(this, 'Database', {
      databaseName: DATABASE_NAME,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [databaseSecurityGroup],
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
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
      cloudwatchLogsExports: ['postgresql'],
      cloudwatchLogsRetention: config.logRetention,
      removalPolicy: config.removalPolicy,
    });

    // Auth sessions use the same pk/sk and TTL contract as DynamoDB Local:
    // USER#<userId> / SESSION#<sessionId>, expired by expiresAtEpoch.
    const sessions = new dynamodb.Table(this, 'AuthSessions', {
      tableName: `${config.resourcePrefix}-auth-sessions`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'expiresAtEpoch',
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      removalPolicy: config.removalPolicy,
    });

    // Event DLQs represent downstream consumer failures. Publisher retries are
    // tracked separately in PostgreSQL before a message reaches this queue.
    const eventsDlq = this.queue('LedgerEventsDlq', {
      queueName: `${config.resourcePrefix}-ledger-events-dlq`,
      retentionPeriod: DLQ_RETENTION_PERIOD,
      removalPolicy: config.removalPolicy,
    });
    const events = this.queue('LedgerEvents', {
      queueName: `${config.resourcePrefix}-ledger-events`,
      visibilityTimeout: QUEUE_VISIBILITY_TIMEOUT,
      retentionPeriod: QUEUE_RETENTION_PERIOD,
      removalPolicy: config.removalPolicy,
      deadLetterQueue: {
        queue: eventsDlq,
        maxReceiveCount: QUEUE_MAX_RECEIVE_COUNT,
      },
    });

    // FIFO command queues model the future asynchronous ledger path. That path
    // remains disabled until a response/correlation workflow is implemented.
    const commandsDlq = this.queue('LedgerCommandsDlq', {
      queueName: `${config.resourcePrefix}-ledger-commands-dlq.fifo`,
      fifo: true,
      contentBasedDeduplication: true,
      retentionPeriod: DLQ_RETENTION_PERIOD,
      removalPolicy: config.removalPolicy,
    });
    const commands = this.queue('LedgerCommands', {
      queueName: `${config.resourcePrefix}-ledger-commands.fifo`,
      fifo: true,
      contentBasedDeduplication: true,
      visibilityTimeout: QUEUE_VISIBILITY_TIMEOUT,
      retentionPeriod: QUEUE_RETENTION_PERIOD,
      removalPolicy: config.removalPolicy,
      deadLetterQueue: {
        queue: commandsDlq,
        maxReceiveCount: QUEUE_MAX_RECEIVE_COUNT,
      },
    });

    // Non-secret resource coordinates are regular environment variables.
    // Database credentials and signing keys are injected separately as secrets.
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
      LEDGER_ASYNC_COMMANDS_ENABLED: 'false',
    };
    const databaseSecrets = {
      DATABASE_USERNAME: ecs.Secret.fromSecretsManager(
        databaseSecret,
        'username',
      ),
      DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(
        databaseSecret,
        'password',
      ),
    };
    const applicationSecrets = {
      JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret),
      INTERNAL_SERVICE_JWT_SECRET:
        ecs.Secret.fromSecretsManager(internalJwtSecret),
    };
    const image = ecs.ContainerImage.fromAsset('.');

    // All runtimes use the same image. This factory keeps task sizing, logs,
    // secret injection, and database bootstrapping consistent between services.
    const makeTask = (
      definition: RuntimeDefinition,
      options: TaskOptions = {},
    ) => {
      const includeApplicationSecrets =
        options.includeApplicationSecrets ?? true;
      const includeDatabase = options.includeDatabase ?? true;
      const task = new ecs.FargateTaskDefinition(this, `${definition.id}Task`, {
        cpu: config.serviceCpu,
        memoryLimitMiB: config.serviceMemoryMiB,
      });
      const logGroup = new logs.LogGroup(this, `${definition.id}Logs`, {
        logGroupName: `/eagle-bank/${config.stage}/${definition.serviceName}`,
        retention: config.logRetention,
        removalPolicy: config.removalPolicy,
      });
      const container = task.addContainer(definition.serviceName, {
        image,
        command: includeDatabase
          ? this.databaseCommand(definition.command)
          : definition.command,
        stopTimeout: TASK_STOP_TIMEOUT,
        logging: ecs.LogDrivers.awsLogs({
          logGroup,
          streamPrefix: definition.serviceName,
        }),
        environment: {
          ...commonEnvironment,
          SERVICE_NAME: definition.serviceName,
          ...options.environment,
        },
        secrets: {
          ...(includeApplicationSecrets ? applicationSecrets : {}),
          ...(includeDatabase ? databaseSecrets : {}),
        },
      });
      if (definition.port) {
        container.addPortMappings({
          name: definition.serviceName,
          containerPort: definition.port,
          appProtocol: ecs.AppProtocol.http,
        });
      }
      return { task, container, logGroup };
    };

    const apiTask = makeTask(
      {
        id: 'Api',
        serviceName: API_SERVICE_NAME,
        command: ['node', 'dist/src/server.js'],
        port: API_PORT,
      },
      {
        environment: {
          PORT: String(API_PORT),
          JWT_EXPIRES_IN: DEFAULT_JWT_EXPIRY,
          AUTH_SERVICE_BASE_URL: `http://${AUTH_SERVICE_DNS_NAME}:${AUTH_PORT}`,
          LEDGER_SERVICE_BASE_URL: `http://${LEDGER_SERVICE_DNS_NAME}:${LEDGER_PORT}`,
        },
      },
    );
    const authTask = makeTask(
      {
        id: 'Auth',
        serviceName: AUTH_SERVICE_DNS_NAME,
        command: ['node', 'dist/src/services/auth-server.js'],
        port: AUTH_PORT,
      },
      {
        environment: {
          PORT: String(AUTH_PORT),
          AUTH_SERVICE_PORT: String(AUTH_PORT),
          JWT_EXPIRES_IN: DEFAULT_JWT_EXPIRY,
          AUTH_SESSION_TTL_SECONDS,
        },
      },
    );
    const ledgerTask = makeTask(
      {
        id: 'Ledger',
        serviceName: LEDGER_SERVICE_DNS_NAME,
        command: ['node', 'dist/src/services/ledger-server.js'],
        port: LEDGER_PORT,
      },
      {
        environment: {
          PORT: String(LEDGER_PORT),
          LEDGER_SERVICE_PORT: String(LEDGER_PORT),
        },
      },
    );
    const workerTask = makeTask(
      {
        id: 'LedgerWorker',
        serviceName: 'ledger-worker',
        command: ['node', 'dist/src/services/ledger-worker.js'],
      },
      {
        includeApplicationSecrets: false,
        includeDatabase: false,
      },
    );
    const publisherTask = makeTask({
      id: 'LedgerEventPublisher',
      serviceName: 'ledger-event-publisher',
      command: ['node', 'dist/src/services/ledger-event-publisher.js'],
    });
    const migrationTask = makeTask(
      {
        id: 'Migration',
        serviceName: 'migration',
        command: ['pnpm', 'prisma', 'migrate', 'deploy'],
      },
      { includeApplicationSecrets: false },
    );

    // Task roles receive only the service-specific data-plane permissions.
    // Secret access required for ECS injection is handled by execution roles.
    sessions.grantReadWriteData(authTask.task.taskRole);
    events.grantSendMessages(publisherTask.task.taskRole);
    commands.grantConsumeMessages(workerTask.task.taskRole);
    const service = (
      id: string,
      taskDefinition: ecs.FargateTaskDefinition,
      securityGroup: ec2.SecurityGroup,
      serviceConnectConfiguration?: ecs.ServiceConnectProps,
    ) =>
      new ecs.FargateService(this, `${id}Service`, {
        serviceName: `${config.resourcePrefix}-${id.toLowerCase()}`,
        cluster,
        taskDefinition,
        desiredCount: props.activateServices
          ? config.desiredCount
          : STOPPED_SERVICE_DESIRED_COUNT,
        circuitBreaker: { rollback: true },
        minHealthyPercent: ECS_MINIMUM_HEALTHY_PERCENT,
        maxHealthyPercent: ECS_MAXIMUM_HEALTHY_PERCENT,
        assignPublicIp: false,
        enableExecuteCommand: config.stage !== DeploymentStage.PROD,
        healthCheckGracePeriod: HEALTH_CHECK_GRACE_PERIOD,
        securityGroups: [securityGroup],
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        serviceConnectConfiguration,
      });

    // Service Connect gives the API stable private names for Auth and Ledger.
    // These services are not exposed through public DNS or public IP addresses.
    const api = service('Api', apiTask.task, apiSecurityGroup, {});
    const auth = service('Auth', authTask.task, authSecurityGroup, {
      services: [
        {
          portMappingName: AUTH_SERVICE_DNS_NAME,
          discoveryName: AUTH_SERVICE_DNS_NAME,
          dnsName: AUTH_SERVICE_DNS_NAME,
          port: AUTH_PORT,
          idleTimeout: SERVICE_CONNECT_IDLE_TIMEOUT,
          perRequestTimeout: SERVICE_CONNECT_REQUEST_TIMEOUT,
        },
      ],
    });
    service('Ledger', ledgerTask.task, ledgerSecurityGroup, {
      services: [
        {
          portMappingName: LEDGER_SERVICE_DNS_NAME,
          discoveryName: LEDGER_SERVICE_DNS_NAME,
          dnsName: LEDGER_SERVICE_DNS_NAME,
          port: LEDGER_PORT,
          idleTimeout: SERVICE_CONNECT_IDLE_TIMEOUT,
          perRequestTimeout: SERVICE_CONNECT_REQUEST_TIMEOUT,
        },
      ],
    });
    service('LedgerWorker', workerTask.task, workerSecurityGroup, {});
    service(
      'LedgerEventPublisher',
      publisherTask.task,
      publisherSecurityGroup,
      {},
    );

    // Only API and the public login route on Auth are reachable from the ALB.
    // Ledger, worker, and publisher remain private ECS services.
    const albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc,
      allowAllOutbound: false,
      description: 'Public ingress to the Eagle Bank ALB',
    });
    const publicListenerPort = props.certificateArn ? HTTPS_PORT : HTTP_PORT;
    albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(publicListenerPort),
      'Public client traffic',
    );
    apiSecurityGroup.addIngressRule(
      albSecurityGroup,
      ec2.Port.tcp(API_PORT),
      'ALB to API',
    );
    authSecurityGroup.addIngressRule(
      albSecurityGroup,
      ec2.Port.tcp(AUTH_PORT),
      'ALB to public Auth routes',
    );
    albSecurityGroup.addEgressRule(
      apiSecurityGroup,
      ec2.Port.tcp(API_PORT),
      'ALB to API',
    );
    albSecurityGroup.addEgressRule(
      authSecurityGroup,
      ec2.Port.tcp(AUTH_PORT),
      'ALB to Auth',
    );

    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      deletionProtection: config.databaseDeletionProtection,
    });

    // Test/preprod may synthesize plain HTTP for offline review. Production is
    // rejected without an ACM certificate and redirects HTTP to HTTPS.
    const certificate = props.certificateArn
      ? acm.Certificate.fromCertificateArn(
          this,
          'AlbCertificate',
          props.certificateArn,
        )
      : undefined;
    const listener = alb.addListener('PublicListener', {
      port: publicListenerPort,
      protocol: certificate
        ? elbv2.ApplicationProtocol.HTTPS
        : elbv2.ApplicationProtocol.HTTP,
      certificates: certificate ? [certificate] : undefined,
      sslPolicy: certificate ? elbv2.SslPolicy.RECOMMENDED_TLS : undefined,
      defaultAction: elbv2.ListenerAction.fixedResponse(
        DEFAULT_NOT_FOUND_STATUS,
      ),
    });
    if (certificate) {
      alb.addRedirect({
        sourcePort: HTTP_PORT,
        sourceProtocol: elbv2.ApplicationProtocol.HTTP,
        targetPort: HTTPS_PORT,
        targetProtocol: elbv2.ApplicationProtocol.HTTPS,
      });
      albSecurityGroup.addIngressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(HTTP_PORT),
        'Redirect HTTP to HTTPS',
      );
    }
    listener.addTargets('ApiRoutes', {
      priority: API_ROUTE_PRIORITY,
      conditions: [
        elbv2.ListenerCondition.pathPatterns(['/health', '/ready', '/v1/*']),
      ],
      port: API_PORT,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [api],
      healthCheck: { path: '/ready' },
    });
    listener.addTargets('AuthRoutes', {
      priority: AUTH_ROUTE_PRIORITY,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/v1/auth/*'])],
      port: AUTH_PORT,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [auth],
      healthCheck: { path: '/ready' },
    });

    // WAF runs before ALB routing. Managed rule groups cover common exploits,
    // known bad payloads, SQL injection, and AWS-maintained IP reputation.
    const webAcl = new wafv2.CfnWebACL(this, 'WebAcl', {
      name: `${config.resourcePrefix}-web-acl`,
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      visibilityConfig: this.wafVisibility(`${config.resourcePrefix}-waf`),
      rules: [
        this.managedWafRule(
          'aws-managed-common',
          WAF_COMMON_RULE_PRIORITY,
          'AWSManagedRulesCommonRuleSet',
        ),
        this.managedWafRule(
          'aws-managed-known-bad-inputs',
          WAF_KNOWN_BAD_INPUTS_RULE_PRIORITY,
          'AWSManagedRulesKnownBadInputsRuleSet',
        ),
        this.managedWafRule(
          'aws-managed-sqli',
          WAF_SQLI_RULE_PRIORITY,
          'AWSManagedRulesSQLiRuleSet',
        ),
        this.managedWafRule(
          'aws-managed-ip-reputation',
          WAF_IP_REPUTATION_RULE_PRIORITY,
          'AWSManagedRulesAmazonIpReputationList',
        ),
        {
          name: 'rate-limit',
          priority: WAF_RATE_LIMIT_RULE_PRIORITY,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              aggregateKeyType: 'IP',
              limit: config.wafRateLimit,
            },
          },
          visibilityConfig: this.wafVisibility('rate-limit'),
        },
      ],
    });
    new wafv2.CfnWebACLAssociation(this, 'WebAclAssociation', {
      resourceArn: alb.loadBalancerArn,
      webAclArn: webAcl.attrArn,
    });

    // The first deployment leaves services at desiredCount=0. Operators run
    // the emitted migration task, then redeploy with ACTIVATE_SERVICES=true.
    new CfnOutput(this, 'PublicUrl', {
      value: `${certificate ? 'https' : 'http'}://${alb.loadBalancerDnsName}`,
    });
    new CfnOutput(this, 'MigrationClusterName', {
      value: cluster.clusterName,
    });
    new CfnOutput(this, 'MigrationTaskDefinitionArn', {
      value: migrationTask.task.taskDefinitionArn,
    });
    new CfnOutput(this, 'MigrationSecurityGroupId', {
      value: migrationSecurityGroup.securityGroupId,
    });
    new CfnOutput(this, 'MigrationSubnetIds', {
      value: vpc
        .selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS })
        .subnetIds.join(','),
    });
    new CfnOutput(this, 'ServicesActivated', {
      value: String(props.activateServices ?? false),
    });
  }

  private serviceSecurityGroup(vpc: ec2.IVpc, id: string): ec2.SecurityGroup {
    return new ec2.SecurityGroup(this, `${id}SecurityGroup`, {
      vpc,
      allowAllOutbound: true,
      description: `${id} task network access`,
    });
  }

  private queue(id: string, props: sqs.QueueProps): sqs.Queue {
    return new sqs.Queue(this, id, {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      ...props,
    });
  }

  private databaseCommand(command: string[]): string[] {
    const executable = command.map((part) => JSON.stringify(part)).join(' ');
    const databaseUrl =
      'postgresql://${DATABASE_USERNAME}:${DATABASE_PASSWORD}' +
      '@${DATABASE_HOST}:${DATABASE_PORT}/${DATABASE_NAME}?schema=public';

    // Prisma requires one DATABASE_URL. The username/password arrive as ECS
    // secrets, so the shell assembles the URL only inside the running container.
    return [
      'sh',
      '-c',
      `export DATABASE_URL="${databaseUrl}"; exec ${executable}`,
    ];
  }

  private wafVisibility(metricName: string) {
    return {
      cloudWatchMetricsEnabled: true,
      metricName,
      sampledRequestsEnabled: true,
    };
  }

  private managedWafRule(
    name: string,
    priority: number,
    managedRuleName: string,
  ): wafv2.CfnWebACL.RuleProperty {
    return {
      name,
      priority,
      overrideAction: { none: {} },
      statement: {
        managedRuleGroupStatement: {
          vendorName: 'AWS',
          name: managedRuleName,
        },
      },
      visibilityConfig: this.wafVisibility(name),
    };
  }
}
