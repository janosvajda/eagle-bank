import { describe, expect, it } from 'vitest';
import { createSqsClient } from './sqs-client.js';

describe('createSqsClient', () => {
  it('creates AWS and LocalStack clients with environment safeguards', () => {
    expect(
      createSqsClient({ environment: 'prod', region: 'eu-west-2' }),
    ).toBeDefined();
    expect(
      createSqsClient({
        environment: 'local',
        region: 'eu-west-2',
        endpoint: 'http://localhost:4566',
      }),
    ).toBeDefined();
    expect(() =>
      createSqsClient({
        environment: 'prod',
        region: 'eu-west-2',
        endpoint: 'http://localhost:4566',
      }),
    ).toThrow('not allowed');
  });
});
