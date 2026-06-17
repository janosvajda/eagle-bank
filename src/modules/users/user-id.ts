export const USER_API_ID_CONTRACT_PATTERN = /^usr-[A-Za-z0-9]+$/;
const USER_API_ID_PATTERN = /^usr-(\d+)$/;

// PostgreSQL owns the numeric identity. The API exposes that identity with the
// user prefix required by the OpenAPI contract.
export function formatUserApiId(databaseId: bigint): string {
  return `usr-${databaseId.toString()}`;
}

// Returns undefined when a contract-valid string was not generated from this
// database, for example usr-abc123. The user service maps that case to 404.
export function parseUserApiId(apiId: string): bigint | undefined {
  const match = USER_API_ID_PATTERN.exec(apiId);
  return match?.[1] === undefined ? undefined : BigInt(match[1]);
}
