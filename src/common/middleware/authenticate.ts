import type { FastifyReply, FastifyRequest } from 'fastify';
import { constants as httpConstants } from 'node:http2';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/error-codes.js';
import { MILLISECONDS_PER_SECOND } from '../constants.js';

export async function authenticate(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch (error) {
    request.log.warn(
      { err: error, method: request.method, path: request.url },
      'JWT verification failed',
    );
    throw new AppError(
      httpConstants.HTTP_STATUS_UNAUTHORIZED,
      ErrorCode.UNAUTHORIZED,
      'Access token is missing or invalid',
    );
  }
  const session = await request.server.authSessions.get(
    request.user.sub,
    request.user.sid ?? '',
    request.user.jti,
  );
  if (
    !session ||
    session.tokenId !== request.user.jti ||
    session.revokedAt ||
    session.expiresAtEpoch <= Math.floor(Date.now() / MILLISECONDS_PER_SECOND)
  ) {
    request.log.warn(
      {
        method: request.method,
        path: request.url,
        sessionId: request.user.sid,
        userId: request.user.sub,
      },
      'Authentication session validation failed',
    );
    throw new AppError(
      httpConstants.HTTP_STATUS_UNAUTHORIZED,
      ErrorCode.UNAUTHORIZED,
      'Access token is missing or invalid',
    );
  }
}
