import { describe, expect, it, vi } from 'vitest';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  DynamoDbAuthSessionStore,
  InMemoryAuthSessionStore,
  createDynamoDbClient,
} from './auth-session.store.js';

describe('auth session stores', () => {
  it('creates and retrieves in-memory sessions', async () => {
    const store = new InMemoryAuthSessionStore();
    const session = await store.create('usr-1', 60);
    await expect(store.get('usr-1', session.sessionId)).resolves.toEqual(
      session,
    );
    await expect(store.get('usr-1', 'missing')).resolves.toBeNull();
  });

  it('writes and reads DynamoDB sessions', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        Item: {
          pk: 'USER#usr-1',
          sk: 'SESSION#session-1',
          userId: 'usr-1',
          sessionId: 'session-1',
          tokenId: 'token-1',
          issuedAt: '2026-01-01T00:00:00.000Z',
          expiresAt: '2026-01-01T01:00:00.000Z',
          expiresAtEpoch: 1767229200,
          revokedAt: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      });
    vi.spyOn(DynamoDBDocumentClient, 'from').mockReturnValue({ send } as never);
    const store = new DynamoDbAuthSessionStore({} as never, 'sessions');
    const created = await store.create('usr-1', 60);
    expect(created.userId).toBe('usr-1');
    await expect(store.get('usr-1', 'session-1')).resolves.toMatchObject({
      userId: 'usr-1',
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('returns null for a missing DynamoDB session', async () => {
    vi.spyOn(DynamoDBDocumentClient, 'from').mockReturnValue({
      send: vi.fn().mockResolvedValue({}),
    } as never);
    const store = new DynamoDbAuthSessionStore({} as never, 'sessions');
    await expect(store.get('usr-1', 'missing')).resolves.toBeNull();
  });

  it('creates AWS and local DynamoDB clients', () => {
    expect(
      createDynamoDbClient({ environment: 'prod', region: 'eu-west-2' }),
    ).toBeDefined();
    expect(
      createDynamoDbClient({
        environment: 'local',
        region: 'eu-west-2',
        endpoint: 'http://localhost:8000',
      }),
    ).toBeDefined();
    expect(() =>
      createDynamoDbClient({
        environment: 'preprod',
        region: 'eu-west-2',
        endpoint: 'http://localhost:8000',
      }),
    ).toThrow('not allowed');
  });
});
