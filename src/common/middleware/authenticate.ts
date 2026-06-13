import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../errors/AppError.js";
import { ErrorCode } from "../errors/error-codes.js";

export async function authenticate(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    throw new AppError(401, ErrorCode.UNAUTHORIZED, "Access token is missing or invalid");
  }
}
