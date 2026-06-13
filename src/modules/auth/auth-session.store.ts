import { randomUUID } from "node:crypto";
import {
  DynamoDBClient,
  type DynamoDBClientConfig,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { MILLISECONDS_PER_SECOND } from "../../common/constants.js";

export interface AuthSession {
  userId: string;
  sessionId: string;
  tokenId: string;
  issuedAt: string;
  expiresAt: string;
  expiresAtEpoch: number;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSessionStore {
  create(userId: string, ttlSeconds: number): Promise<AuthSession>;
  get(
    userId: string,
    sessionId: string,
    tokenId?: string,
  ): Promise<AuthSession | null>;
}

export class InMemoryAuthSessionStore implements AuthSessionStore {
  private readonly sessions = new Map<string, AuthSession>();

  async create(userId: string, ttlSeconds: number): Promise<AuthSession> {
    return this.seed(userId, ttlSeconds);
  }

  seed(userId: string, ttlSeconds: number): AuthSession {
    const now = new Date();
    const session: AuthSession = {
      userId,
      sessionId: randomUUID(),
      tokenId: randomUUID(),
      issuedAt: now.toISOString(),
      expiresAt: new Date(
        now.getTime() + ttlSeconds * MILLISECONDS_PER_SECOND,
      ).toISOString(),
      expiresAtEpoch:
        Math.floor(now.getTime() / MILLISECONDS_PER_SECOND) + ttlSeconds,
      revokedAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    this.sessions.set(`${userId}:${session.sessionId}`, session);
    return session;
  }

  async get(userId: string, sessionId: string): Promise<AuthSession | null> {
    return this.sessions.get(`${userId}:${sessionId}`) ?? null;
  }
}

export class DynamoDbAuthSessionStore implements AuthSessionStore {
  private readonly client: DynamoDBDocumentClient;

  constructor(
    client: DynamoDBClient,
    private readonly tableName: string,
  ) {
    this.client = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  async create(userId: string, ttlSeconds: number): Promise<AuthSession> {
    const now = new Date();
    const session: AuthSession = {
      userId,
      sessionId: randomUUID(),
      tokenId: randomUUID(),
      issuedAt: now.toISOString(),
      expiresAt: new Date(
        now.getTime() + ttlSeconds * MILLISECONDS_PER_SECOND,
      ).toISOString(),
      expiresAtEpoch:
        Math.floor(now.getTime() / MILLISECONDS_PER_SECOND) + ttlSeconds,
      revokedAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    // The composite key supports direct session introspection and listing all
    // sessions for a user without a table scan or secondary index.
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `USER#${userId}`,
          sk: `SESSION#${session.sessionId}`,
          ...session,
        },
        ConditionExpression:
          "attribute_not_exists(pk) AND attribute_not_exists(sk)",
      }),
    );
    return session;
  }

  async get(userId: string, sessionId: string): Promise<AuthSession | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: `USER#${userId}`,
          sk: `SESSION#${sessionId}`,
        },
        ConsistentRead: true,
      }),
    );
    return (result.Item as AuthSession | undefined) ?? null;
  }
}

export function createDynamoDbClient(options: {
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}): DynamoDBClient {
  const config: DynamoDBClientConfig = { region: options.region };

  // Explicit endpoints and placeholder credentials are local-only. On AWS,
  // omitting both uses the normal ECS task-role credential provider chain.
  if (options.endpoint) {
    config.endpoint = options.endpoint;
    config.credentials = {
      accessKeyId: options.accessKeyId ?? "test",
      secretAccessKey: options.secretAccessKey ?? "test",
    };
  }
  return new DynamoDBClient(config);
}
