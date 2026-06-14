import type { FastifyJWTOptions } from '@fastify/jwt';

export const USER_JWT_ALGORITHM = 'HS256';
export const USER_JWT_ISSUER = 'eagle-bank-auth';
export const USER_JWT_AUDIENCE = 'eagle-bank-api';

export function userJwtOptions(secret: string): FastifyJWTOptions {
  return {
    secret,
    decode: { checkTyp: 'JWT' },
    sign: {
      algorithm: USER_JWT_ALGORITHM,
      iss: USER_JWT_ISSUER,
      aud: USER_JWT_AUDIENCE,
    },
    verify: {
      algorithms: [USER_JWT_ALGORITHM],
      allowedIss: USER_JWT_ISSUER,
      allowedAud: USER_JWT_AUDIENCE,
    },
  };
}
