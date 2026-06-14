const TRANSACTION_API_ID_PATTERN = /^tan-(\d+)$/;

// PostgreSQL owns the numeric identity. The API exposes that identity with the
// transaction prefix required by the OpenAPI contract.
export function formatTransactionApiId(databaseId: bigint): string {
  return `tan-${databaseId.toString()}`;
}

// Returns undefined when the supplied API ID cannot identify a persisted
// transaction. The transaction service maps that case to 404.
export function parseTransactionApiId(apiId: string): bigint | undefined {
  const match = TRANSACTION_API_ID_PATTERN.exec(apiId);
  return match?.[1] === undefined ? undefined : BigInt(match[1]);
}
