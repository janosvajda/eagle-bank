import { randomUUID } from 'node:crypto';
import { constants as httpConstants } from 'node:http2';
import argon2 from 'argon2';
import type { FastifyBaseLogger } from 'fastify';
import pino from 'pino';
import { AppError } from '../../common/errors/AppError.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { mapUser } from './users.mapper.js';
import type { UsersRepository } from './users.repository.js';
import type { CreateUserInput, UpdateUserInput } from './users.schemas.js';
import type { PasswordHasher } from './users.ports.js';

export class UsersService {
  constructor(
    private readonly users: UsersRepository,
    private readonly passwordHasher: PasswordHasher = {
      hash: (password) => argon2.hash(password),
    },
    private readonly logger: FastifyBaseLogger = pino({ enabled: false }),
  ) {}

  async create(input: CreateUserInput) {
    const email = input.email.toLowerCase();
    if (await this.users.findByEmail(email)) {
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
      id: `usr-${randomUUID().replaceAll('-', '')}`,
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
    const user = await this.users.findById(targetId);
    if (!user) {
      this.logger.warn({ targetId }, 'User lookup failed');
      throw new AppError(
        httpConstants.HTTP_STATUS_NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'User was not found',
      );
    }
    if (user.id !== authenticatedId) {
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
    await this.getAuthorized(targetId, authenticatedId);
    const address = input.address;
    const user = await this.users.update(targetId, {
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
    await this.getAuthorized(targetId, authenticatedId);
    if ((await this.users.countAccounts(targetId)) > 0) {
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
    await this.users.delete(targetId);
  }
}
