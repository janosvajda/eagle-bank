import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCode } from "../../common/errors/error-codes.js";
import type { UsersRepository } from "../users/users.repository.js";
import type { LoginInput } from "./auth.schemas.js";

export class AuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly app: FastifyInstance,
    private readonly expiresIn: string
  ) {}

  async login(input: LoginInput) {
    const user = await this.users.findByEmail(input.email);
    const valid = user ? await argon2.verify(user.passwordHash, input.password) : false;
    if (!user || !valid) {
      throw new AppError(401, ErrorCode.UNAUTHORIZED, "Invalid email or password");
    }

    return {
      token: this.app.jwt.sign(
        { sub: user.id },
        { expiresIn: this.expiresIn as never }
      )
    };
  }
}
