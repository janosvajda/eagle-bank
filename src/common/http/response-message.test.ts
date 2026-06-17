import { describe, expect, it } from 'vitest';
import { responseMessage } from './response-message.js';

describe('responseMessage', () => {
  it('extracts a public message from JSON error payloads', () => {
    expect(responseMessage({ message: 'denied' }, 'fallback')).toBe('denied');
  });

  it('uses the fallback when the payload does not expose a message', () => {
    expect(responseMessage({ error: 'denied' }, 'fallback')).toBe('fallback');
    expect(responseMessage(undefined, 'fallback')).toBe('fallback');
  });
});
