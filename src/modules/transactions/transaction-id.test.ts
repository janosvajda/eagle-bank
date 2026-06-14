import { describe, expect, it } from 'vitest';
import {
  formatTransactionApiId,
  parseTransactionApiId,
} from './transaction-id.js';

describe('transaction API IDs', () => {
  it('formats and parses a database transaction ID', () => {
    expect(formatTransactionApiId(456n)).toBe('tan-456');
    expect(parseTransactionApiId('tan-456')).toBe(456n);
  });

  it('rejects IDs not generated from a numeric database key', () => {
    expect(parseTransactionApiId('tan-abc123')).toBeUndefined();
    expect(parseTransactionApiId('usr-456')).toBeUndefined();
  });
});
