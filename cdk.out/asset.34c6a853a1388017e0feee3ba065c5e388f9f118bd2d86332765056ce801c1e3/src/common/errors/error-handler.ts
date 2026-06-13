import { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { AppError } from "./AppError.js";

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    // Validation and expected domain failures are safe to expose in the public
    // contract. Unknown failures are logged and reduced to a generic response.
    if (error instanceof ZodError) {
      return reply.status(400).send({
        message: "Invalid details supplied",
        details: error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
          type: issue.code,
        })),
      });
    }

    if (error instanceof AppError) {
      if (error.statusCode === 400) {
        return reply.status(400).send({
          message: error.message,
          details: error.details ?? [],
        });
      }
      return reply.status(error.statusCode).send({ message: error.message });
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return reply.status(409).send({ message: "Resource already exists" });
    }

    request.log.error({ err: error }, "Unhandled request error");
    return reply.status(500).send({ message: "An unexpected error occurred" });
  });
}
