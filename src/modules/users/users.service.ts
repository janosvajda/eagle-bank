import { constants as httpConstants } from 'node:http2';
import type { FastifyBaseLogger } from 'fastify';
import pino from 'pino';
import { AppError } from '../../common/errors/AppError.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { mapUser } from './users.mapper.js';
import type { UsersRepository } from './users.repository.js';
import type { CreateUserInput, UpdateUserInput } from './users.schemas.js';
import type { PasswordHasher } from './users.ports.js';
import { hashPassword } from '../../common/password/password.js';
import { parseUserApiId } from './user-id.js';

export class UsersService {
  constructor(
    private readonly users: UsersRepository,
    private readonly passwordHasher: PasswordHasher = {
      hash: hashPassword,
    },
    private readonly logger: FastifyBaseLogger = pino({ enabled: false }),
  ) {}

  async create(input: CreateUserInput) {
    const email = input.email.toLowerCase();
    if (await this.users.findByEmail(email)) {
      // Email is a durable unique identity for login, so duplicates are a
      // client-correctable conflict rather than a validation or server error.
      this.logger.warn(
        { conflictField: 'email' },
        'User creation rejected because the email already exists',
      );
      throw new AppError(
        httpConstants.HTTP_STATUS_CONFLICT,
        ErrorCode.CONFLICT,
        'A user with this email already exists',
      );
    }

    const passwordHash = await this.passwordHasher.hash(input.password);
    const user = await this.users.create({
      name: input.name,
      email,
      phoneNumber: input.phoneNumber,
      passwordHash,
      addressLine1: input.address.line1,
      addressLine2: input.address.line2 ?? null,
      addressLine3: input.address.line3 ?? null,
      town: input.address.town,
      county: input.address.county,
      postcode: input.address.postcode,
    });
    return mapUser(user);
  }

  async getAuthorized(targetId: string, authenticatedId: string) {
    const targetDatabaseId = parseUserApiId(targetId);
    const user =
      targetDatabaseId === undefined
        ? null
        : await this.users.findById(targetDatabaseId);
    if (!user) {
      this.logger.warn({ targetId }, 'User lookup failed');
      throw new AppError(
        httpConstants.HTTP_STATUS_NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'User was not found',
      );
    }
    const authenticatedDatabaseId = parseUserApiId(authenticatedId);
    if (
      authenticatedDatabaseId === undefined ||
      user.id !== authenticatedDatabaseId
    ) {
      this.logger.warn(
        { authenticatedId, targetId },
        'User access was forbidden',
      );
      throw new AppError(
        httpConstants.HTTP_STATUS_FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'You are not allowed to access this user',
      );
    }
    return user;
  }

  async get(targetId: string, authenticatedId: string) {
    return mapUser(await this.getAuthorized(targetId, authenticatedId));
  }

  async update(
    targetId: string,
    authenticatedId: string,
    input: UpdateUserInput,
  ) {
    const address = input.address;
    const existing = await this.getAuthorized(targetId, authenticatedId);
    const user = await this.users.update(existing.id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.email !== undefined
        ? { email: input.email.toLowerCase() }
        : {}),
      ...(input.phoneNumber !== undefined
        ? { phoneNumber: input.phoneNumber }
        : {}),
      ...(address
        ? {
            addressLine1: address.line1,
            addressLine2: address.line2 ?? null,
            addressLine3: address.line3 ?? null,
            town: address.town,
            county: address.county,
            postcode: address.postcode,
          }
        : {}),
    });
    return mapUser(user);
  }

  async delete(targetId: string, authenticatedId: string): Promise<void> {
    const user = await this.getAuthorized(targetId, authenticatedId);
    if ((await this.users.countAccounts(user.id)) > 0) {
      this.logger.warn(
        { targetId },
        'User deletion rejected because active accounts remain',
      );
      throw new AppError(
        httpConstants.HTTP_STATUS_CONFLICT,
        ErrorCode.CONFLICT,
        'A user cannot be deleted while associated with a bank account',
      );
    }
    await this.users.delete(user.id);
  }
}
