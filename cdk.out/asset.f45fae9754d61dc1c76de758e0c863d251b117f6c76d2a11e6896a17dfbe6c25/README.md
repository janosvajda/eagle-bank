# Eagle Bank REST API

A TypeScript REST API implementing the Eagle Bank take-home assessment. The
implementation targets every scenario in the supplied brief and treats
`openapi.yaml` as the authoritative public contract.

## Technology

- **Fastify** provides a small, testable HTTP layer with schema-independent
  request injection for integration tests.
- **Prisma and PostgreSQL** provide explicit relational constraints, Decimal
  money values, migrations, and transactional balance updates.
- **Zod** validates all path parameters and request bodies at runtime.
- **argon2** hashes passwords; **JWT** bearer tokens authenticate protected
  endpoints.
- **Vitest** runs HTTP integration tests against PostgreSQL.

## Architecture

Feature modules are split into routes, validation schemas, services,
repositories, and response mappers. Routes handle HTTP concerns, services own
business and authorization rules, repositories isolate Prisma access, and
mappers prevent persistence-only fields such as `passwordHash` from leaking.

The API uses the OpenAPI account number as the account identifier. Approved
differences between the assessment prose and the original OpenAPI file are
recorded in [Contract conflicts.md](./Contract%20conflicts.md).

## Run With Docker

```bash
cp .env.example .env
docker compose up --build
```

The API listens on `http://localhost:3000`; PostgreSQL is exposed on port 5432.
The API container applies committed migrations before starting.

Stop the services with:

```bash
docker compose down
```

Add `-v` only when you intentionally want to delete local database data.

## Run Locally

Node.js 24+ and PostgreSQL are required.

```bash
cp .env.example .env
npm install
npm run db:generate
npm run db:migrate
npm run dev
```

Useful database commands:

```bash
npm run db:deploy
npm run db:reset
npm run db:studio
npm run seed
```

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | Deployment environment: `prod`, `preprod`, or `test` |
| `PORT` | HTTP listening port |
| `DATABASE_URL` | PostgreSQL connection URL |
| `JWT_SECRET` | Signing secret, at least 32 characters |
| `JWT_EXPIRES_IN` | JWT lifetime such as `1h` |

Environment-specific templates are provided as `.env.prod.example`,
`.env.preprod.example`, and `.env.test.example`. The generic `.env.example`
uses `preprod` for local development. Configuration validation rejects any
other `NODE_ENV` value.

## Tests

Tests use the database configured by `DATABASE_URL` and clear its Eagle Bank
tables between cases. Never point tests at a database containing valuable data.

```bash
docker compose up -d db
DATABASE_URL='postgresql://eagle:eagle@localhost:5432/eagle_bank?schema=public' npm run db:deploy
DATABASE_URL='postgresql://eagle:eagle@localhost:5432/eagle_bank?schema=public' npm test
npm run build
```

Run isolated unit tests with `npm run test:unit` and PostgreSQL-backed HTTP
integration tests with `npm run test:integration`. Additional scripts are
`npm run test:watch` and `npm run test:coverage`.

Unit tests are colocated with their source files, for example
`src/modules/accounts/accounts.mapper.test.ts`. The unit configuration enforces
100% statement, branch, function, and line coverage across every executable
TypeScript file under `src`. The declaration-only `src/types/fastify.d.ts` file
is excluded because it has no runtime behavior.

## Authentication

Create a user with a password, then exchange email and password for a token:

```bash
curl -X POST http://localhost:3000/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"demo@eaglebank.test","password":"DemoPassword123!"}'
```

Send the resulting token as `Authorization: Bearer <token>`. User creation and
login are public; every other endpoint is protected.

## Implemented Endpoints

- `POST /v1/users`
- `GET|PATCH|DELETE /v1/users/{userId}`
- `POST /v1/auth/login`
- `POST|GET /v1/accounts`
- `GET|PATCH|DELETE /v1/accounts/{accountNumber}`
- `POST|GET /v1/accounts/{accountNumber}/transactions`
- `GET /v1/accounts/{accountNumber}/transactions/{transactionId}`

Transactions have no update or delete operations and are immutable.

## Money And Consistency

The external API follows the OpenAPI numeric representation. Internally,
balances and amounts use PostgreSQL `DECIMAL(12,2)` through Prisma Decimal,
avoiding binary floating-point arithmetic.

Transaction creation and balance mutation occur in one serializable Prisma
transaction. Withdrawals use a conditional update requiring
`balance >= amount`; failure returns `422` without creating a transaction or
changing the balance. This prevents concurrent withdrawals from overdrawing an
account.

## Authorization And Errors

The API first loads the requested user or account. Missing resources return
`404`; existing resources owned by someone else return `403`, matching the
assessment scenarios. Transaction detail lookups include both account and
transaction identifiers, so a transaction requested through the wrong account
returns `404`.

Errors follow the OpenAPI contract:

- General errors: `{ "message": "..." }`
- Validation errors: `{ "message": "...", "details": [...] }`

## Assumptions And Trade-offs

- `/v1/auth/login` with email/password is the chosen authentication design.
- Accounts are addressed publicly by the OpenAPI `accountNumber`, despite the
  assessment prose calling the path value `accountId`.
- Accounts with transactions cannot be deleted because transactions are
  immutable and relationally retained. The API returns `409` for this case.
- Account numbers are randomly allocated in the OpenAPI `01xxxxxx` range with
  unique-database enforcement and bounded retries. A production bank would use
  a dedicated allocation service.
- JWT revocation, refresh tokens, rate limiting, pagination, idempotency keys,
  and audit/event infrastructure are outside this assessment scope.

## Further Improvements

With more time, add idempotency for transaction creation, pagination and stable
cursors, JWT refresh/revocation, rate limiting, structured audit events,
OpenAPI-driven contract tests, and observability around database retries.

## Submission And Walkthrough

The repository is structured for publication to a public GitHub repository.
Before submission, verify no local `.env` or credentials are included. During
the follow-up, be prepared to discuss OpenAPI conformance, authorization order,
Decimal money handling, conditional balance updates, module boundaries, test
isolation, and the trade-offs listed above.

All assessment endpoints are implemented.
