import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { MILLISECONDS_PER_SECOND } from "../constants.js";

const INTERNAL_SERVICE_TOKEN_TTL_SECONDS = 60;
const INTERNAL_SERVICE_CLOCK_TOLERANCE_SECONDS = 5;

interface InternalServiceClaims {
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
}

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signature(value: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(value).digest();
}

// Internal tokens are deliberately short-lived and audience-bound. They prove
// service identity but are not user access tokens and carry no user authority.
export function createInternalServiceToken(options: {
  issuer: string;
  audience: string;
  secret: string;
  now?: number;
}): string {
  const issuedAt =
    options.now ?? Math.floor(Date.now() / MILLISECONDS_PER_SECOND);
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    iss: options.issuer,
    aud: options.audience,
    iat: issuedAt,
    exp: issuedAt + INTERNAL_SERVICE_TOKEN_TTL_SECONDS,
    jti: randomUUID(),
  });
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${signature(unsigned, options.secret).toString("base64url")}`;
}

export function verifyInternalServiceToken(options: {
  token: string | undefined;
  audience: string;
  allowedIssuers: string[];
  secret: string;
  now?: number;
}): InternalServiceClaims | null {
  if (!options.token?.startsWith("Bearer ")) return null;
  const parts = options.token.slice(7).split(".");
  if (parts.length !== 3) return null;
  const [header, payload, encodedSignature] = parts;
  if (!header || !payload || !encodedSignature) return null;
  const unsigned = `${header}.${payload}`;
  const supplied = Buffer.from(encodedSignature, "base64url");
  const expected = signature(unsigned, options.secret);

  // Compare signatures in constant time to avoid leaking matching-prefix
  // information through response timing.
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    return null;
  }
  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as InternalServiceClaims;
    const now = options.now ?? Math.floor(Date.now() / MILLISECONDS_PER_SECOND);
    if (
      claims.aud !== options.audience ||
      !options.allowedIssuers.includes(claims.iss) ||
      !claims.jti ||
      claims.exp <= now ||
      claims.iat > now + INTERNAL_SERVICE_CLOCK_TOLERANCE_SECONDS ||
      claims.exp - claims.iat > INTERNAL_SERVICE_TOKEN_TTL_SECONDS
    ) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}
