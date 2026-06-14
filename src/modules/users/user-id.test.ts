import { describe, expect, it } from 'vitest';
import { formatUserApiId, parseUserApiId } from './user-id.js';

describe('user API IDs', () => {
  it('formats and parses a database user ID', () => {
    expect(formatUserApiId(123n)).toBe('usr-123');
    expect(parseUserApiId('usr-123')).toBe(123n);
  });

  it('rejects IDs not generated from a numeric database key', () => {
    expect(parseUserApiId('usr-abc123')).toBeUndefined();
    expect(parseUserApiId('tan-123')).toBeUndefined();
  });
});
