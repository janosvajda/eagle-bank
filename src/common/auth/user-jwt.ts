import type { FastifyJWTOptions } from '@fastify/jwt';
import {
  JWT_TYPE,
  JwtAlgorithm,
  USER_JWT_AUDIENCE,
  USER_JWT_ISSUER,
} from './auth.constants.js';

export function userJwtOptions(secret: string): FastifyJWTOptions {
  return {
    secret,
    decode: { checkTyp: JWT_TYPE },
    sign: {
      algorithm: JwtAlgorithm.HMAC_SHA_256,
      iss: USER_JWT_ISSUER,
      aud: USER_JWT_AUDIENCE,
    },
    verify: {
      algorithms: [JwtAlgorithm.HMAC_SHA_256],
      allowedIss: USER_JWT_ISSUER,
      allowedAud: USER_JWT_AUDIENCE,
    },
  };
}
