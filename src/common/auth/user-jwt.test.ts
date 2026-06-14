import fastifyJwt from '@fastify/jwt';
import fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  USER_JWT_ALGORITHM,
  USER_JWT_AUDIENCE,
  USER_JWT_ISSUER,
  userJwtOptions,
} from './user-jwt.js';

describe('user JWT configuration', () => {
  it('pins the algorithm, token type, issuer, and audience', () => {
    expect(userJwtOptions('secret')).toMatchObject({
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
    });
  });

  it('rejects a token signed with another HMAC algorithm', async () => {
    const app = fastify();
    await app.register(fastifyJwt, userJwtOptions('a'.repeat(32)));
    const token = app.jwt.sign({ sub: 'usr-owner' }, { algorithm: 'HS512' });

    expect(() => app.jwt.verify(token)).toThrow();
    await app.close();
  });
});
