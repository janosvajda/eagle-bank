import type { FastifyJWTOptions } from '@fastify/jwt';
import {
  JWT_HMAC_SHA_256_ALGORITHM,
  JWT_TYPE,
  USER_JWT_AUDIENCE,
  USER_JWT_ISSUER,
} from './auth.constants.js';

export function userJwtOptions(secret: string): FastifyJWTOptions {
  return {
    secret,
    decode: { checkTyp: JWT_TYPE },
    sign: {
      algorithm: JWT_HMAC_SHA_256_ALGORITHM,
      iss: USER_JWT_ISSUER,
      aud: USER_JWT_AUDIENCE,
    },
    verify: {
      algorithms: [JWT_HMAC_SHA_256_ALGORITHM],
      allowedIss: USER_JWT_ISSUER,
      allowedAud: USER_JWT_AUDIENCE,
    },
  };
}
