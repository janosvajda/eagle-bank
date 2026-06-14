import type { FastifyInstance } from 'fastify';
import { constants as httpConstants } from 'node:http2';
import { AppError } from '../../common/errors/AppError.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { AuthTokenType } from '../../common/auth/auth.constants.js';
import type { UsersRepository } from '../users/users.repository.js';
import type { LoginInput } from './auth.schemas.js';
import type { AuthSessionStore } from './auth-session.contracts.js';
import type { LoginResult } from './auth.contracts.js';
import { verifyPassword } from '../../common/password/password.js';
import { formatUserApiId } from '../users/user-id.js';

export class AuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly app: FastifyInstance,
    private readonly expiresIn: string,
    private readonly sessions: AuthSessionStore,
    private readonly sessionTtlSeconds: number,
  ) {}

  async login(input: LoginInput): Promise<LoginResult> {
    const user = await this.users.findByEmail(input.email.toLowerCase());
    const valid = await verifyPassword(user?.passwordHash, input.password);
    if (!user || !valid) {
      this.app.log.warn(
        { authenticationResult: 'invalid_credentials' },
        'Authentication attempt rejected',
      );
      throw new AppError(
        httpConstants.HTTP_STATUS_UNAUTHORIZED,
        ErrorCode.UNAUTHORIZED,
        'Invalid email or password',
      );
    }

    const userId = formatUserApiId(user.id);
    const session = await this.sessions.create(userId, this.sessionTtlSeconds);
    this.app.log.info(
      { sessionId: session.sessionId, userId },
      'Authentication session created',
    );
    return {
      accessToken: this.app.jwt.sign(
        {
          sub: userId,
          sid: session.sessionId,
          jti: session.tokenId,
        },
        { expiresIn: this.expiresIn },
      ),
      tokenType: AuthTokenType.BEARER,
      expiresIn: this.sessionTtlSeconds,
    };
  }
}
