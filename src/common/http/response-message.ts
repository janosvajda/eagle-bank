import type { JsonValue } from './json.types.js';

export function responseMessage(
  payload: JsonValue | undefined,
  fallback: string,
): string {
  return typeof payload === 'object' &&
    payload !== null &&
    'message' in payload &&
    typeof payload.message === 'string'
    ? payload.message
    : fallback;
}
