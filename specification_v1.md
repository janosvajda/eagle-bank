# Eagle Bank API Implementation Specification

## 0. Purpose

You are implementing the Eagle Bank take-home coding assessment.

This document defines the implementation requirements.

The implementation must satisfy:

1. The Eagle Bank assessment PDF scenarios.
2. The supplied OpenAPI specification.
3. The explicit OpenAPI corrections listed in this document.
4. The architecture, testing, security, infrastructure, and operational requirements in this document.

The supplied OpenAPI file is the authoritative public API contract, except where this specification explicitly requires corrections.

The final project must be runnable locally through Docker Compose.

The project must also include AWS CDK code that models a future deployable AWS architecture.

The project includes a local runtime and an AWS deployment model, while keeping the reviewer setup straightforward.

---

# 1. Fixed technology stack

Use exactly this stack:

- TypeScript
- Node.js 24+
- npm 11+
- Turborepo
- Fastify
- Prisma
- PostgreSQL
- Docker Compose
- Vitest
- Zod
- argon2
- JWT bearer authentication
- DynamoDB Local
- AWS DynamoDB
- LocalStack
- AWS SDK for JavaScript v3
- Pino structured logging
- Transactional outbox pattern
- SQS
- AWS CDK v2 in TypeScript
- AWS WAF
- Application Load Balancer
- ECS Fargate
- RDS PostgreSQL
- DynamoDB
- AWS Systems Manager Parameter Store
- CloudWatch Logs

Do not replace these technologies with alternatives.

Root `package.json` must include:

```json
{
  "packageManager": "npm@11.9.0",
  "engines": {
    "node": ">=24",
    "npm": ">=11"
  }
}
```

---

# 2. High-level architecture

The system is a modular Turborepo with separately deployed runtime services.

Runtime services:

```text
api
auth-service
ledger-service
ledger-event-publisher
shared-application-db
integration-test-db
auth-session-db
localstack
```

Do not use the service name:

```text
outbox-worker
```

Use:

```text
ledger-event-publisher
```

Reason:

`outbox-worker` describes an implementation detail.
`ledger-event-publisher` describes the business responsibility: reliably publishing committed Ledger events.

The word `outbox` may still be used for the database pattern and table names.

---

# 3. Core service boundaries

## 3.1 API service

The API service is the public OpenAPI façade.

It owns:

- public user routes
- public account routes
- public transaction routes as façade endpoints
- OpenAPI request validation
- OpenAPI response mapping
- public error-envelope mapping
- authentication enforcement
- ownership checks
- user profile persistence in PostgreSQL
- account metadata persistence in PostgreSQL
- delegation to Auth service for password hashing and session introspection
- delegation to Ledger service for money movement and transaction reads
- account-Ledger reconciliation logic

The API service must not:

- hash passwords
- verify raw passwords
- issue JWTs
- write auth sessions to DynamoDB
- mutate Ledger balances
- create Ledger transactions
- create Ledger entries
- own transaction idempotency
- publish Ledger events
- directly write Ledger-owned tables

The API service may:

- validate public request shape
- verify resource ownership
- call Auth service internally
- call Ledger service internally
- compose account metadata with Ledger balances
- map Auth/Ledger errors into OpenAPI-compatible public errors

## 3.2 Auth service

The Auth service owns authentication.

It owns:

- `POST /v1/auth/login`
- password hashing
- password verification
- JWT issuing
- DynamoDB-backed session/token metadata
- session introspection
- auth-specific health/readiness
- auth logging and redaction
- public request ID, correlation ID, error-envelope, logging, and security contract for `/v1/auth/login`

Users remain in PostgreSQL.

Auth sessions/tokens live in DynamoDB.

The Auth service may read from PostgreSQL:

- `users.id`
- `users.email`
- `users.passwordHash`

The Auth service must not:

- own user profile data
- mutate user profile fields
- own accounts
- own Ledger accounts
- own transactions
- mutate balances

## 3.3 Ledger service

The Ledger service owns all money movement.

It owns:

- Ledger account creation
- Ledger account closure
- Ledger account balance reads
- Ledger batch balance reads
- deposits
- withdrawals
- immutable Ledger transactions
- Ledger entries
- account balance mutation
- transaction idempotency
- insufficient-funds checks
- maximum-balance checks
- row-level locking/concurrency control
- Ledger outbox event creation
- internal Ledger command API
- internal Ledger query API

The Ledger service is private.

It must not be publicly exposed through the ALB.

The API service calls the Ledger service over authenticated private service-to-service HTTP.

## 3.4 Asynchronous Ledger command processing

Asynchronous Ledger command processing is out of scope for this assessment.

The active and tested path is synchronous API-to-Ledger HTTP delegation, with
committed Ledger events published later through the outbox publisher.

Do not include a disabled Ledger command worker or command queue unless the full
request/response, idempotency, retry, and operational model is implemented.

## 3.5 Ledger event publisher

The Ledger event publisher owns reliable publication of committed Ledger events.

It owns:

- polling `ledger_outbox_events`
- concurrency-safe event claiming
- processing leases
- lease recovery
- publishing events to SQS
- retry with exponential backoff and jitter
- marking events `PUBLISHED`, `FAILED`, or `DEAD`
- structured logs for event publishing

The Ledger event publisher must not:

- process banking commands
- mutate balances
- create Ledger transactions
- consume public API requests

---

# 4. Public API contract

The public API must expose the paths from the supplied OpenAPI file, with explicit corrections listed in this document.

Correct public routes:

```text
POST   /v1/users

GET    /v1/users/{userId}
PATCH  /v1/users/{userId}
DELETE /v1/users/{userId}

POST   /v1/auth/login

POST   /v1/accounts
GET    /v1/accounts

GET    /v1/accounts/{accountNumber}
PATCH  /v1/accounts/{accountNumber}
DELETE /v1/accounts/{accountNumber}

POST   /v1/accounts/{accountNumber}/transactions
GET    /v1/accounts/{accountNumber}/transactions

GET    /v1/accounts/{accountNumber}/transactions/{transactionId}

GET    /health
GET    /ready
```

The public account route parameter is always:

```text
accountNumber
```

Do not use `{accountId}` in public routes.

Internal database models may use:

```text
accountId
```

but `accountId` must not appear as a public account route parameter.

---

# 5. OpenAPI contract rules

Before implementing anything:

1. Locate and read the provided OpenAPI YAML file.
2. Preserve the file and its existing location unless relocation is explicitly justified.
3. Use the OpenAPI file as the source of truth for:

   - paths
   - methods
   - parameters
   - request bodies
   - response bodies
   - required fields
   - optional fields
   - enums
   - status codes
   - error response shapes

4. Do not rename public fields unless listed as a correction below.
5. Do not invent public fields that conflict with OpenAPI.
6. Do not return public fields not allowed by OpenAPI.
7. If the PDF and OpenAPI conflict, report the conflict before coding.
8. If no OpenAPI file exists, stop and report that the API contract is missing.

---

# 6. Required OpenAPI corrections and additions

The OpenAPI file must be updated to document every public behaviour introduced by this specification.

## 6.1 Authentication endpoint

Add:

```text
POST /v1/auth/login
```

The route is publicly served by Auth service through ALB path routing.

Add schemas:

```yaml
LoginRequest:
  type: object
  required:
    - email
    - password
  properties:
    email:
      type: string
      format: email
    password:
      type: string
      minLength: 8

LoginResponse:
  type: object
  required:
    - accessToken
    - tokenType
    - expiresIn
  properties:
    accessToken:
      type: string
      description: JWT bearer access token.
    tokenType:
      type: string
      enum:
        - Bearer
    expiresIn:
      type: integer
      description: Token lifetime in seconds.
```

Login success response:

```text
200 OK
```

with `LoginResponse`.

Login error responses:

```text
400 Bad Request
401 Unauthorized
500 Internal Server Error
503 Service Unavailable
```

Use existing OpenAPI error envelopes where possible.

If a compatible `UnauthorizedErrorResponse` schema does not exist, add one.

If a compatible `ServiceUnavailableErrorResponse` schema does not exist, add one.

## 6.2 Bearer authentication

Add JWT bearer security scheme if missing.

Public endpoints:

```text
POST /v1/users
POST /v1/auth/login
GET /health
GET /ready
```

All other public assessment endpoints require:

```text
Authorization: Bearer <token>
```

## 6.3 Password on user creation

Correct `CreateUserRequest`:

- add required `password`
- password is accepted only during user creation
- password is never returned
- passwordHash is never returned

`UserResponse` must never contain:

```text
password
passwordHash
```

## 6.4 Identifier corrections

Correct transaction ID pattern from:

```text
^tan-[A-Za-z0-9]$
```

to:

```text
^tan-[A-Za-z0-9]+$
```

Reason:

The original pattern allows exactly one character after `tan-`, while the example uses values like `tan-123abc`.

Convert custom regex definitions incorrectly expressed as `format` into `pattern`.

This applies to:

- `userId`
- `accountNumber`
- `phoneNumber`
- `transactionId`

Preserve standard OpenAPI formats:

- `email`
- `date-time`

## 6.5 Create-user 400 response schema

If `POST /v1/users` lacks a 400 response body schema, add:

```yaml
content:
  application/json:
    schema:
      $ref: '#/components/schemas/BadRequestErrorResponse'
```

## 6.6 Transaction amount

Correct domain rule:

- transaction amount must be greater than `0`
- zero-value deposit returns `400 Bad Request`
- zero-value withdrawal returns `400 Bad Request`

Update OpenAPI validation accordingly.

## 6.7 Maximum balance

OpenAPI restricts balance to maximum:

```text
10000.00
```

Enforce this in Ledger.

A deposit that would make balance exceed `10000.00` returns:

```text
422 Unprocessable Entity
```

It must not:

- create Ledger transaction
- create Ledger entry
- mutate balance
- create `TransactionPosted` event

## 6.8 Idempotency-Key header

Document optional request header:

```text
Idempotency-Key
```

for:

```text
POST /v1/accounts/{accountNumber}/transactions
```

Schema:

```yaml
IdempotencyKey:
  name: Idempotency-Key
  in: header
  required: false
  schema:
    type: string
    minLength: 8
    maxLength: 128
  description: Optional idempotency key for safe retry of transaction creation.
```

If the same key is reused with a different transaction command, the API must return:

```text
409 Conflict
```

The OpenAPI path for transaction creation must document this `409` response.

## 6.9 Transaction 409 response

Add `409 Conflict` response to:

```text
POST /v1/accounts/{accountNumber}/transactions
```

Use existing conflict error schema if available.

If missing, add:

```yaml
ConflictErrorResponse:
  type: object
  required:
    - message
  properties:
    message:
      type: string
```

Preferred error code if error model supports codes:

```text
IDEMPOTENCY_KEY_CONFLICT
```

## 6.10 Public 503 responses

Because the architecture has distributed internal services, the OpenAPI must document `503 Service Unavailable` for public endpoints that depend on Auth or Ledger service availability.

Add `503` responses to:

```text
POST   /v1/users

GET    /v1/users/{userId}
PATCH  /v1/users/{userId}
DELETE /v1/users/{userId}

POST   /v1/accounts
GET    /v1/accounts
GET    /v1/accounts/{accountNumber}
PATCH  /v1/accounts/{accountNumber}
DELETE /v1/accounts/{accountNumber}

POST   /v1/accounts/{accountNumber}/transactions
GET    /v1/accounts/{accountNumber}/transactions
GET    /v1/accounts/{accountNumber}/transactions/{transactionId}

POST   /v1/auth/login
```

Use existing server error schema if compatible.

If no compatible schema exists, add:

```yaml
ServiceUnavailableErrorResponse:
  type: object
  required:
    - message
  properties:
    message:
      type: string
```

Preferred error codes if error model supports codes:

```text
AUTH_SERVICE_UNAVAILABLE
LEDGER_SERVICE_UNAVAILABLE
LEDGER_BALANCE_UNAVAILABLE
LEDGER_ACCOUNT_PROJECTION_MISSING
```

Important:

`GET /ready` also returns `503`, but it must use `ReadinessResponse`, not `ServiceUnavailableErrorResponse`.

## 6.11 Health and readiness endpoints

Add public operational endpoints to OpenAPI:

```text
GET /health
GET /ready
```

`GET /health` success response:

```text
200 OK
```

Response schema:

```yaml
HealthResponse:
  type: object
  required:
    - status
  properties:
    status:
      type: string
      enum:
        - ok
```

`GET /ready` success response:

```text
200 OK
```

Response schema:

```yaml
ReadinessResponse:
  type: object
  required:
    - status
  properties:
    status:
      type: string
      enum:
        - ready
        - not_ready
```

`GET /ready` failure response:

```text
503 Service Unavailable
```

Response schema:

```yaml
ReadinessResponse:
  type: object
  required:
    - status
  properties:
    status:
      type: string
      enum:
        - ready
        - not_ready
```

For `/ready`, use:

```json
{
  "status": "not_ready"
}
```

Do not use the general error envelope for `/ready`.

---

# 7. Environment vocabulary

Use exactly these deployment environment names:

```text
local
test
preprod
prod
```

Do not use:

```text
dev
staging
production
```

Local Docker runtime is not a deployment environment name.

---

# 8. Local runtime services

Docker Compose must define:

```text
api
auth-service
ledger-service
ledger-event-publisher
shared-application-db
integration-test-db
auth-session-db
localstack
```

Do not define:

```text
outbox-worker
```

`shared-application-db` is used by local running services.

`integration-test-db` is used only by automated tests.

Tests must never truncate, reset, or mutate the local development database.

Test commands use:

```text
TEST_DATABASE_URL
```

Development commands use:

```text
DATABASE_URL
```

## 8.1 No AWS account required locally

Local development, automated tests, example requests, and the reviewer smoke
test must require no AWS account, AWS login, deployed AWS resources, or network
access to AWS APIs.

Local AWS-compatible dependencies are:

```text
DynamoDB API -> DynamoDB Local
SQS API      -> LocalStack
```

LocalStack is required for all locally used SQS queues. DynamoDB Local remains
the required local implementation for the auth-session table.

Docker Compose must provide non-secret placeholder credentials:

```text
AWS_REGION=eu-west-2
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
AWS_EC2_METADATA_DISABLED=true
```

Local AWS SDK clients must use explicit container-network endpoints:

```text
DYNAMODB_ENDPOINT=http://auth-session-db:8000
SQS_ENDPOINT=http://localstack:4566
```

Tests running from the host may use the documented published localhost ports.

Local code must not:

- call AWS STS
- use AWS SSO
- require an AWS profile
- query EC2/ECS instance metadata
- resolve production AWS endpoints while local endpoint variables are set
- require `cdk bootstrap` or `cdk deploy` for local execution

Include an integration safety test that starts the local configuration and
verifies all DynamoDB and SQS SDK requests use the configured emulator
endpoints.

## 8.2 AWS-compatible runtime configuration

Application code must use AWS SDK v3 client factories shared by local and AWS
runtimes.

Client configuration rules:

```text
local:
  explicit endpoint
  explicit test credentials
  configured AWS region

AWS:
  endpoint omitted
  credentials omitted
  configured AWS region
  default ECS task-role credential provider chain
```

Do not hard-code LocalStack or DynamoDB Local endpoints in domain,
repository, publisher, or worker code. Endpoint overrides belong only in
validated configuration and client construction.

The same service images and application code must run locally and on ECS.
Environment configuration may differ, but business logic and persistence
contracts must not fork into separate local and AWS implementations.

---

# 9. Data ownership model

These are separately deployed services with a shared PostgreSQL database.

This keeps the local environment manageable.

Document this clearly in README.

A database-per-service design would provide stronger storage isolation and use events or sagas for cross-service consistency.

## 9.1 API-owned data

API owns:

- user profile fields
- account metadata
- account lifecycle state

API may write:

```text
users profile fields
bank_accounts metadata/state fields
```

API must not write:

```text
ledger_accounts
ledger_transactions
ledger_entries
ledger_outbox_events
ledger_idempotency_keys
auth session records
```

## 9.2 Auth-owned data

Auth owns:

```text
DynamoDB auth session/token metadata
```

Auth may read PostgreSQL:

```text
users.id
users.email
users.passwordHash
```

Auth must not mutate user profile fields.

## 9.3 Ledger-owned data

Ledger owns:

```text
ledger_accounts
ledger_transactions
ledger_entries
ledger_outbox_events
ledger_idempotency_keys
```

Ledger must not mutate user profile fields.

Ledger must not mutate API account metadata except through explicit service contracts if later added.

## 9.4 Ledger event publisher-owned data

Ledger event publisher may update only event-publishing state fields in:

```text
ledger_outbox_events
```

It must not:

- mutate balances
- create transactions
- create ledger entries

## 9.5 PostgreSQL indexes and constraints

The Prisma schema and generated PostgreSQL migrations must define indexes from
the application's real access patterns. Primary keys and unique constraints
count as indexes, but foreign-key columns must be indexed explicitly because
PostgreSQL does not create those indexes automatically.

Required constraints and indexes:

```text
users
  PRIMARY KEY (id)
  UNIQUE (email)

bank_accounts
  PRIMARY KEY (id)
  UNIQUE (accountNumber)
  INDEX (userId, status, createdAt)
  INDEX (status, updatedAt)

ledger_accounts
  PRIMARY KEY (id)
  UNIQUE (accountId)
  UNIQUE (accountNumber)

ledger_transactions
  PRIMARY KEY (id)
  UNIQUE (transactionId)
  INDEX (accountId, createdAt, id)

ledger_entries
  PRIMARY KEY (id)
  INDEX (ledgerTransactionId)
  INDEX (accountId, createdAt, id)

ledger_idempotency_keys
  PRIMARY KEY (id)
  UNIQUE (userId, accountNumber, idempotencyKey)
  INDEX (expiresAt)

ledger_outbox_events
  PRIMARY KEY (id)
  UNIQUE (eventId)
  INDEX (status, nextAttemptAt, createdAt)
  INDEX (status, processingLeaseExpiresAt)
```

Every additional foreign key introduced during implementation must have a
supporting index unless it is already the leading column of an existing index.

Email addresses must be normalized to lowercase before persistence and login
lookup. The unique `users(email)` constraint therefore enforces
case-insensitive application semantics without creating duplicate accounts for
different email casing.

The account reconciliation query must use:

```text
bank_accounts(status, updatedAt)
```

The user account-list and user-deletion checks must use:

```text
bank_accounts(userId, status, createdAt)
```

Ledger must resolve public `accountNumber` through the unique
`ledger_accounts(accountNumber)` index and then use internal `accountId` as the
canonical transaction-list key. Deterministic transaction listing must use:

```text
ledger_transactions(accountId, createdAt, id)
```

Public `transactionId` values must be decoded to the internal numeric
transaction primary key. Fetch by that primary key and then verify that the
transaction belongs to the resolved Ledger account.

The Ledger Event Publisher must use indexes that support:

- due `PENDING` or `FAILED` events by `nextAttemptAt`
- expired `PROCESSING` leases by `processingLeaseExpiresAt`
- deterministic ordering by `createdAt`

Partial PostgreSQL indexes may be created with SQL in a Prisma migration when
they materially improve these publisher queries. If partial indexes are used,
prefer:

```sql
CREATE INDEX ... ON ledger_outbox_events (next_attempt_at, created_at)
WHERE status IN ('PENDING', 'FAILED');

CREATE INDEX ... ON ledger_outbox_events (processing_lease_expires_at)
WHERE status = 'PROCESSING';
```

Do not add speculative or duplicate indexes. README must map every non-trivial
index to the query it supports and mention the additional write/storage cost.

---

# 10. DynamoDB auth sessions

DynamoDB table:

```text
eagle-bank-auth-sessions
```

Local runtime uses DynamoDB Local.

AWS runtime uses DynamoDB.

Recommended key model:

```text
pk = USER#<userId>
sk = SESSION#<sessionId>
```

Attributes:

- `userId`
- `sessionId`
- `tokenId`
- `issuedAt`
- `expiresAt`
- `expiresAtEpoch`
- `revokedAt`
- `lastUsedAt`
- `createdAt`
- `updatedAt`

Enable TTL on:

```text
expiresAtEpoch
```

## 10.1 DynamoDB access patterns and indexes

Required access patterns:

1. Read one session during introspection using `userId` and `sessionId`.
2. List or revoke all sessions for one user.
3. Write, update, revoke, and delete a known session.
4. Allow DynamoDB TTL to remove expired sessions asynchronously.

The table primary key must be:

```text
partition key: pk (String) = USER#<userId>
sort key:      sk (String) = SESSION#<sessionId>
```

This primary key supports all required access patterns:

- introspection uses strongly consistent `GetItem` with `pk` and `sk`
- user-session listing/revocation uses `Query` by `pk`
- known-session updates use `UpdateItem` with `pk` and `sk`

No GSI or LSI is required for the current contract.

Do not use DynamoDB `Scan` in request handling, readiness checks, session
cleanup, or tests.

`tokenId` is validated from the item fetched with `pk` and `sk`; do not add a
GSI for `tokenId` unless a new access pattern requires lookup without `userId`
and `sessionId`.

TTL configuration is not an index. Both DynamoDB Local initialization and AWS
CDK must configure:

```text
TTL attribute: expiresAtEpoch
```

The DynamoDB Local table and CDK table must have matching key names, key types,
TTL attribute, billing assumptions, and secondary-index definitions.

JWT payload must include:

- `sub = userId`
- `sid = sessionId`
- `jti = tokenId`
- `iat`
- `exp`

---

# 11. Session enforcement

Use strict session enforcement.

The API must validate both:

1. JWT signature and expiry.
2. DynamoDB-backed session validity through Auth service.

No local-JWT-only mode.

## 11.1 Protected request validation

For every protected public request:

1. API extracts bearer token.
2. API verifies JWT signature and expiry locally.
3. API calls Auth service internal endpoint:

```text
POST /internal/auth/sessions/introspect
```

Request:

```json
{
  "userId": "usr-...",
  "sessionId": "...",
  "tokenId": "...",
  "requestId": "...",
  "correlationId": "..."
}
```

4. Auth service checks DynamoDB session record.
5. Auth service verifies:

   - session exists
   - tokenId matches
   - session is not expired
   - session is not revoked

6. API accepts request only if introspection succeeds.

## 11.2 Failure behaviour

Invalid JWT:

```text
401 Unauthorized
```

Invalid/revoked/missing session:

```text
401 Unauthorized
```

Auth service unavailable:

```text
503 Service Unavailable
```

Do not fail open.

## 11.3 Auth introspection timeout

Use:

```text
AUTH_INTROSPECTION_TIMEOUT_MS=300
```

Retries:

```text
0
```

Timeout maps to:

```text
503 Service Unavailable
```

Default: no session cache.

---

# 12. Password ownership

Auth owns password handling.

API must not hash passwords.

## 12.1 User creation flow

For:

```text
POST /v1/users
```

Flow:

1. API validates OpenAPI request including `password`.
2. API calls Auth internal endpoint:

```text
POST /internal/auth/password-hash
```

Request:

```json
{
  "password": "plain-text-password",
  "requestId": "...",
  "correlationId": "..."
}
```

3. Auth hashes password using argon2.
4. Auth returns passwordHash to API over authenticated internal service call.
5. API writes user profile and passwordHash to PostgreSQL.
6. API returns OpenAPI `UserResponse` without password/passwordHash.

## 12.2 Password hash endpoint

This endpoint:

- is internal-only
- requires service-to-service authentication
- is not routed through public ALB listener rules
- logs no raw password
- logs no passwordHash
- redacts request body

## 12.3 Login flow

For:

```text
POST /v1/auth/login
```

Flow:

1. Auth service receives email/password.
2. Auth loads `users.id`, `users.email`, `users.passwordHash` from PostgreSQL.
3. Auth verifies password with argon2.
4. Auth creates `sessionId`.
5. Auth creates `tokenId`.
6. Auth writes session metadata to DynamoDB.
7. Auth signs JWT.
8. Auth returns `LoginResponse`.

---

# 13. Internal service security

Private networking is required but not sufficient.

All internal service-to-service HTTP calls must be authenticated.

Use signed internal service JWTs.

The API receives both audience-specific signing keys. Auth receives only the
Auth verification key, and Ledger receives only the Ledger verification key:

```text
SERVICE_NAME
AUTH_SERVICE_JWT_SECRET
LEDGER_SERVICE_JWT_SECRET
```

Internal JWT claims:

- `iss`: calling service name
- `aud`: target service name
- `iat`
- `exp`
- `jti`

Maximum lifetime:

```text
60 seconds
```

Required internal auth for:

- API -> Auth password hash
- API -> Auth session introspection
- API -> Ledger account creation
- API -> Ledger account closure
- API -> Ledger balance read
- API -> Ledger batch balance read
- API -> Ledger transaction posting
- API -> Ledger transaction queries
- Reconciler -> Ledger account creation
- Reconciler -> Ledger account closure

Internal auth failure:

- internal response: `401` or `403`
- public API maps it to `503 Service Unavailable`
- log security event
- do not expose internal auth details publicly

AWS:

- services run in private subnets
- security groups restrict service-to-service traffic
- internal JWT secret stored as a Parameter Store `SecureString`
- IAM remains least privilege

---

# 14. HTTP timeout and retry behaviour

All internal HTTP calls must have explicit timeout and retry rules.

Financial commands must not be blindly retried.

## 14.1 API -> Auth introspection

Timeout:

```text
300ms
```

Retries:

```text
0
```

Failure mapping:

- timeout -> `503`
- unavailable -> `503`
- invalid session -> `401`

## 14.2 API -> Auth password hash

Timeout:

```text
1000ms
```

Retries:

```text
1 retry for network failure only
```

No retry on Auth 4xx.

Failure mapping:

- timeout/unavailable -> `503`
- validation failure -> `400`

## 14.3 API -> Ledger create account

Timeout:

```text
1500ms
```

Retries:

```text
1 retry for network failure only
```

Safe because Ledger account creation is idempotent by `accountNumber`.

Failure mapping:

- timeout/unavailable -> mark metadata `LEDGER_CREATION_FAILED`, return `503`
- conflict -> `409`
- validation error -> `400` or `422`

## 14.4 API -> Ledger close account

Timeout:

```text
1500ms
```

Retries:

```text
1 retry for network failure only
```

Safe because Ledger account closure is idempotent by `accountNumber`.

Failure mapping:

- timeout/unavailable -> mark metadata `LEDGER_CLOSURE_FAILED`, return `503`
- conflict -> `409`

## 14.5 API -> Ledger post transaction

Timeout:

```text
2000ms
```

Retries:

```text
0 by default
```

If `Idempotency-Key` is provided:

```text
1 retry for network failure or timeout
```

The retry must send the same idempotency key.

If no `Idempotency-Key`:

- do not retry
- timeout maps to `503`
- README tells clients to retry with Idempotency-Key

## 14.6 API -> Ledger reads

Timeout:

```text
1000ms
```

Retries:

```text
1 retry for network failure only
```

Failure mapping:

- Ledger unavailable -> `503`
- Ledger not found -> `404`

---

# 15. Account balance read path

API owns account metadata.

Ledger owns balances.

Therefore account responses must compose metadata from API database and balances from Ledger.

## 15.1 Single account read

For:

```text
GET /v1/accounts/{accountNumber}
```

Flow:

1. API authenticates user.
2. API loads account metadata by `accountNumber`.
3. API checks ownership.
4. API calls Ledger:

```text
GET /internal/ledger/accounts/{accountNumber}/balance
```

5. API merges metadata and Ledger balance into OpenAPI `BankAccountResponse`.

If Ledger unavailable:

- return `503 Service Unavailable`
- do not return stale balance
- do not return partial account
- log `LEDGER_BALANCE_UNAVAILABLE`

## 15.2 Account list read

For:

```text
GET /v1/accounts
```

Flow:

1. API authenticates user.
2. API loads all non-deleted account metadata for user.
3. API calls Ledger batch endpoint:

```text
POST /internal/ledger/accounts/balances
```

Request:

```json
{
  "accountNumbers": ["01234567", "01234568"]
}
```

4. Ledger returns balances for all requested accounts.
5. API merges metadata and balances into OpenAPI account list response.

If any Ledger account is missing:

- return `503 Service Unavailable`
- log `LEDGER_ACCOUNT_PROJECTION_MISSING`
- do not silently omit the account
- do not return partial list

If Ledger unavailable:

- return `503`
- do not return stale or partial balances

## 15.3 Account create response

For:

```text
POST /v1/accounts
```

The API response must include the initial Ledger balance returned by Ledger account creation.

API must not independently calculate the returned balance.

---

# 16. Account lifecycle states

API account metadata must include status:

```text
PENDING_LEDGER_CREATION
ACTIVE
LEDGER_CREATION_FAILED
PENDING_LEDGER_CLOSURE
LEDGER_CLOSURE_FAILED
CLOSED
```

Normal public reads include only:

```text
ACTIVE
```

Public routes treat these as nonexistent:

```text
PENDING_LEDGER_CREATION
LEDGER_CREATION_FAILED
PENDING_LEDGER_CLOSURE
LEDGER_CLOSURE_FAILED
CLOSED
```

unless the route is the same request that is creating or deleting the account.

---

# 17. Distributed account creation

Creating an account spans:

- API-owned account metadata
- Ledger-owned ledger account

Use deterministic pending-state workflow.

## 17.1 Account creation flow

For:

```text
POST /v1/accounts
```

Flow:

1. API validates request.
2. API creates account metadata with status `PENDING_LEDGER_CREATION`.
3. API commits metadata transaction.
4. API calls Ledger:

```text
POST /internal/ledger/accounts
```

Command:

```json
{
  "commandId": "...",
  "accountId": "...",
  "accountNumber": "01234567",
  "userId": "usr-...",
  "currency": "GBP",
  "initialBalance": "0.00",
  "requestId": "...",
  "correlationId": "..."
}
```

5. Ledger creates Ledger account idempotently.
6. Ledger returns created balance.
7. API updates metadata status to `ACTIVE`.
8. API returns OpenAPI account response.

## 17.2 If Ledger creation fails

If metadata is created but Ledger creation fails:

1. API marks metadata `LEDGER_CREATION_FAILED`.
2. API returns `503`.
3. Account does not appear in `GET /v1/accounts`.
4. Account cannot be used for transactions.
5. Reconciliation retries Ledger creation.

## 17.3 Account-Ledger reconciler

Implement:

```text
account-ledger-reconciler
```

It may run as:

- scheduled function inside API service locally
- future ECS scheduled task in CDK

It must:

- find accounts in `PENDING_LEDGER_CREATION` or `LEDGER_CREATION_FAILED`
- call Ledger create account idempotently
- mark account `ACTIVE` after success
- log failures
- use original correlation ID where available or create a reconciliation correlation ID

## 17.4 Ledger account creation idempotency

Ledger account creation is idempotent by:

```text
accountNumber
```

Same accountNumber with same data:

- return existing Ledger account

Same accountNumber with conflicting data:

- return `409 Conflict`

---

# 18. Distributed account deletion

Deleting/closing an account spans:

- API-owned metadata
- Ledger-owned Ledger account

Use deterministic closure workflow.

## 18.1 Account with no Ledger transactions

Flow:

1. API authenticates and checks ownership.
2. API calls Ledger:

```text
POST /internal/ledger/accounts/{accountNumber}/close
```

3. Ledger closes or removes Ledger account idempotently.
4. API physically deletes account metadata or marks it `CLOSED`.
5. API returns OpenAPI-compliant delete response.

## 18.2 Account with Ledger transactions

Flow:

1. API authenticates and checks ownership.
2. API marks metadata `PENDING_LEDGER_CLOSURE`.
3. API calls Ledger close account.
4. Ledger marks Ledger account `CLOSED`.
5. API marks metadata `CLOSED` and sets `deletedAt`.
6. Public API treats account as nonexistent.

## 18.3 If Ledger closure fails

If metadata was marked `PENDING_LEDGER_CLOSURE` but Ledger closure fails:

- mark metadata `LEDGER_CLOSURE_FAILED`
- return `503`
- account must not accept new transactions
- reconciliation retries Ledger closure
- account remains excluded from normal account list

## 18.4 If Ledger closure succeeds but metadata update fails

Reconciliation must detect mismatch.

It must:

- detect Ledger closed while metadata not closed
- update metadata to `CLOSED`
- log `ACCOUNT_LEDGER_STATE_MISMATCH`

Until reconciled:

- public transaction creation returns `404` or `409`
- no new transactions are accepted

## 18.5 Repeated delete

Repeated delete after `CLOSED` returns:

```text
404 Not Found
```

## 18.6 User deletion dependency

`DELETE /v1/users/{userId}` returns `409 Conflict` only if the user has at least one account in a non-final state:

```text
PENDING_LEDGER_CREATION
ACTIVE
LEDGER_CREATION_FAILED
PENDING_LEDGER_CLOSURE
LEDGER_CLOSURE_FAILED
```

Accounts in final state:

```text
CLOSED
```

do not block user deletion.

Reason:

A user who has successfully deleted or closed all accounts should be deletable. Historical account and Ledger rows may remain internally preserved, but they are no longer active accounts for the purpose of the assessment’s user-deletion rule.

---

# 19. Ledger account model

Ledger service owns:

```text
ledger_accounts
ledger_transactions
ledger_entries
ledger_outbox_events
ledger_idempotency_keys
```

Recommended schema:

```text
ledger_accounts
  id
  accountId
  accountNumber
  currency
  availableBalance
  status
  version
  createdAt
  updatedAt

ledger_transactions
  id
  transactionId
  accountId
  accountNumber
  userId
  type
  amount
  currency
  reference
  status
  idempotencyKey
  createdAt

ledger_entries
  id
  ledgerTransactionId
  accountId
  direction
  amount
  currency
  balanceAfter
  createdAt
```

For the take-home, single-entry Ledger records are acceptable if documented.

README must state that full double-entry bookkeeping is not implemented.

---

# 20. Ledger command model

Command:

```text
PostTransactionCommand
```

Fields:

- `commandId`
- `idempotencyKey`
- `userId`
- `accountNumber`
- internal `accountId`
- `type`
- `amount`
- `currency`
- `reference`
- `requestId`
- `correlationId`
- `createdAt`

Command result types:

```text
TransactionPosted
TransactionRejected
```

`TransactionPosted` includes:

- `transactionId`
- `accountNumber`
- `type`
- `amount`
- `currency`
- `balanceAfter`
- `createdAt`

`TransactionRejected` includes:

- `reason`
- `errorCode`
- `accountNumber`
- `type`
- `amount`
- `currency`

Rejection reasons:

- `INSUFFICIENT_FUNDS`
- `BALANCE_LIMIT_EXCEEDED`
- `ACCOUNT_NOT_FOUND`
- `ACCOUNT_CLOSED`
- `INVALID_AMOUNT`
- `DUPLICATE_IDEMPOTENCY_KEY`

---

# 21. Synchronous public API façade over Ledger

The public OpenAPI transaction endpoint expects a normal transaction response.

Therefore, for this take-home, implement synchronous API-to-Ledger command execution.

Flow:

```text
POST /v1/accounts/{accountNumber}/transactions
  -> API authenticates user
  -> API validates request
  -> API verifies account ownership
  -> API calls Ledger service internally
  -> Ledger posts transaction atomically
  -> Ledger creates Ledger outbox event
  -> API maps Ledger response to OpenAPI response
```

Do not add a parallel asynchronous command path for this assessment. A disabled
worker or queue would be misleading unless command processing is implemented and
covered by tests.

---

# 22. Ledger transaction atomicity

Ledger service must use PostgreSQL transactions.

## 22.1 Deposit flow

1. Receive command.
2. Validate idempotency.
3. Load Ledger account by `accountNumber`.
4. Lock account row with `SELECT ... FOR UPDATE` or equivalent.
5. Validate amount > 0.
6. Validate currency.
7. Validate resulting balance <= `10000.00`.
8. Create Ledger transaction.
9. Create Ledger entry.
10. Update Ledger account balance.
11. Store idempotency result.
12. Insert `TransactionPosted` into Ledger outbox.
13. Commit.
14. Return transaction result.

## 22.2 Withdrawal flow

1. Receive command.
2. Validate idempotency.
3. Load Ledger account by `accountNumber`.
4. Lock account row with `SELECT ... FOR UPDATE` or equivalent.
5. Validate amount > 0.
6. Validate currency.
7. Validate sufficient funds.
8. Create Ledger transaction.
9. Create Ledger entry.
10. Update Ledger account balance.
11. Store idempotency result.
12. Insert `TransactionPosted` into Ledger outbox.
13. Commit.
14. Return transaction result.

## 22.3 Failure rules

Invalid amount:

```text
400
```

Insufficient funds:

```text
422
```

Balance limit exceeded:

```text
422
```

Idempotency conflict:

```text
409
```

Rejected command must not:

- create Ledger transaction
- create Ledger entry
- mutate balance
- create `TransactionPosted`

---

# 23. Ledger idempotency

Idempotency belongs to Ledger service.

Header:

```text
Idempotency-Key
```

Rules:

- optional at public API boundary unless OpenAPI requires it
- strongly recommended for transaction creation
- API passes idempotency key to Ledger
- Ledger stores idempotency key with request hash and result
- same key + same command returns original result
- same key + different command returns `409 Conflict`

Scope:

- `userId`
- `accountNumber`
- `idempotencyKey`

Store:

- `idempotencyKey`
- `userId`
- `accountNumber`
- `requestHash`
- `status`
- `responsePayload`
- `createdAt`
- `expiresAt`

---

# 24. Ledger outbox and Ledger Event Publisher

Ledger service writes committed events to:

```text
ledger_outbox_events
```

Ledger Event Publisher publishes them.

Statuses:

```text
PENDING
PROCESSING
PUBLISHED
FAILED
DEAD
```

Publisher flow:

1. Poll `ledger_outbox_events`.
2. Atomically claim due events.
3. Mark claimed events `PROCESSING`.
4. Set processing lease.
5. Publish event to SQS.
6. On success, mark `PUBLISHED`.
7. On failure, increment attempts.
8. If attempts remain, mark `FAILED` and set `nextAttemptAt`.
9. If attempts exhausted, mark `DEAD`.
10. Recover expired processing leases.

Claiming must use PostgreSQL semantics equivalent to:

```sql
SELECT ...
FOR UPDATE SKIP LOCKED
```

Delivery semantics:

- at-least-once
- duplicates possible after crash/retry
- downstream consumers must be idempotent

---

# 25. Ledger events

Required event:

```text
TransactionPosted
```

Payload:

- `eventId`
- `eventType`
- `occurredAt`
- `transactionId`
- `accountNumber`
- internal `accountId`
- `userId`
- `type`
- `amount`
- `currency`
- `balanceAfter`
- `reference`
- `requestId`
- `correlationId`

Do not implement `TransactionRejected` unless explicitly designed.

Insufficient funds must not create `TransactionPosted`.

---

# 26. Event queues

Create only queues with defined purpose.

## 26.1 Required Ledger events queue

```text
eagle-bank-ledger-events
eagle-bank-ledger-events-dlq
```

Purpose:

- Ledger Event Publisher publishes `TransactionPosted` events here.
- Future consumers may process audit, reporting, fraud, analytics, notifications.

## 26.2 Ledger command queue

Do not create a Ledger command queue for this assessment. The project uses the
synchronous Ledger service call for transaction posting and the Ledger event
queue only for committed event publication.

## 26.3 Generic events queue

Do not create:

```text
eagle-bank-events
eagle-bank-events-dlq
```

unless a concrete `domain-event-publisher` and non-Ledger event flow are implemented.

---

# 27. DLQ semantics

Ledger Event Publisher `FAILED`/`DEAD` statuses handle failures to publish messages to SQS.

SQS DLQ handles future failures where a downstream consumer receives a message but repeatedly fails to process it.

The DLQ is not the Ledger Event Publisher retry path.

---

# 28. Money handling

Use Prisma Decimal mapped to PostgreSQL numeric.

Never use JavaScript floating-point arithmetic for monetary mutation.

Rules:

- amount must be > 0
- currency must be `GBP`
- balance must be >= 0
- balance must be <= `10000.00`
- invalid amount returns `400`
- insufficient funds returns `422`
- balance limit exceeded returns `422`

---

# 29. Request and correlation IDs

Every public request must have:

- `requestId`
- `correlationId`

Headers:

- accept incoming `x-correlation-id`
- generate correlation ID if missing
- always generate request ID
- return `x-request-id`
- return `x-correlation-id`

Pass both IDs through:

- API logs
- Auth logs
- Ledger logs
- internal service calls
- Ledger events
- Ledger Event Publisher logs

Auth service is public for `/v1/auth/login`, so it must implement the same request/correlation/error/logging contract as API.

---

# 30. Logging and redaction

Use Pino structured logs.

Every service log should include where applicable:

- `service`
- `requestId`
- `correlationId`
- `userId`
- `accountNumber`
- `transactionId`
- `eventId`
- `statusCode`
- `latencyMs`
- `errorCode`

Redact:

- password
- passwordHash
- authorization
- accessToken
- refreshToken
- jwt
- token
- cookie
- set-cookie
- secret
- DATABASE_URL
- JWT_SECRET
- AUTH_SERVICE_JWT_SECRET
- LEDGER_SERVICE_JWT_SECRET

Never log:

- raw passwords
- passwordHash
- JWT
- full Authorization header
- database connection strings with credentials

---

# 31. Error handling

All public services must return OpenAPI-compatible JSON error envelopes.

Public services:

- API service
- Auth service for `/v1/auth/login`

Public responses must not expose:

- stack traces
- Prisma errors
- SQL errors
- DynamoDB internals
- internal service auth errors
- secrets
- tokens

Internal service errors are mapped by the public-facing service.

Exception:

```text
GET /ready
```

uses `ReadinessResponse` for both `200` and `503`.

It does not use the general error envelope.

---

# 32. Health and readiness

## 32.1 API

`GET /health`:

- process health only
- returns `200` with `HealthResponse`

`GET /ready`:

- PostgreSQL connectivity only
- returns `200` with:

```json
{
  "status": "ready"
}
```

- returns `503` with:

```json
{
  "status": "not_ready"
}
```

API readiness must not fail because DynamoDB or SQS is unavailable unless API directly depends on them for the endpoint being checked.

`GET /ready` must not use the general error envelope.

## 32.2 Auth service

`GET /health`:

- process health only

`GET /ready`:

- PostgreSQL connectivity
- DynamoDB connectivity

Auth service readiness uses the same `ReadinessResponse` shape:

```json
{
  "status": "ready"
}
```

or:

```json
{
  "status": "not_ready"
}
```

## 32.3 Ledger service

`GET /health`:

- process health only

`GET /ready`:

- PostgreSQL connectivity

Ledger service readiness uses the same `ReadinessResponse` shape.

## 32.4 Ledger Event Publisher

Readiness checks:

- PostgreSQL connectivity
- SQS connectivity

If an operational readiness endpoint is exposed for this service, it uses the same `ReadinessResponse` shape.

# 33. Public API scenarios

## 33.1 Users

`POST /v1/users`:

- creates user
- requires password
- API calls Auth service to hash password
- stores passwordHash in PostgreSQL
- never returns password/passwordHash
- missing required data returns `400`
- Auth unavailable returns `503`

`GET /v1/users/{userId}`:

- own user returns `200`
- another user returns `403`
- missing user returns `404`
- Auth introspection unavailable returns `503`

`PATCH /v1/users/{userId}`:

- own user updates
- another user returns `403`
- missing user returns `404`
- Auth introspection unavailable returns `503`

`DELETE /v1/users/{userId}`:

- own user with no non-final accounts deletes
- user with any non-final account returns `409`
- `CLOSED` accounts do not block deletion
- another user returns `403`
- missing user returns `404`
- Auth introspection unavailable returns `503`

## 33.2 Auth

`POST /v1/auth/login`:

- Auth service handles request
- valid credentials return `LoginResponse`
- invalid credentials return `401`
- malformed request returns `400`
- password is redacted
- passwordHash is never returned
- session metadata written to DynamoDB
- PostgreSQL/DynamoDB dependency failure returns `503`

## 33.3 Accounts

`POST /v1/accounts`:

- creates account metadata in pending state
- creates Ledger account idempotently
- marks account `ACTIVE`
- response includes Ledger balance
- missing required data returns `400`
- Ledger unavailable returns `503`

`GET /v1/accounts`:

- lists only authenticated user’s active accounts
- fetches balances from Ledger batch endpoint
- Ledger unavailable returns `503`
- missing Ledger projection returns `503`

`GET /v1/accounts/{accountNumber}`:

- own active account returns `200`
- another user’s account returns `403`
- missing account returns `404`
- non-active account returns `404`
- Ledger unavailable returns `503`

`PATCH /v1/accounts/{accountNumber}`:

- own active account updates
- another user returns `403`
- missing/non-active account returns `404`
- Auth introspection unavailable returns `503`

`DELETE /v1/accounts/{accountNumber}`:

- own account with no Ledger transactions may be physically deleted
- own account with Ledger transactions is closed/soft-deleted
- Ledger closure failure returns `503`
- another user returns `403`
- missing/non-active account returns `404`
- repeated delete after closed returns `404`

## 33.4 Transactions

`POST /v1/accounts/{accountNumber}/transactions`:

- API validates request
- API verifies ownership
- API delegates to Ledger
- API does not mutate balance
- API does not create Ledger transaction
- deposit succeeds through Ledger
- withdrawal succeeds through Ledger
- insufficient funds returns `422`
- balance limit exceeded returns `422`
- amount `0.00` returns `400`
- idempotency conflict returns `409`
- missing required fields returns `400`
- another user’s account returns `403` and Ledger is not called
- missing/non-active account returns `404`
- Ledger unavailable returns `503`

`GET /v1/accounts/{accountNumber}/transactions`:

- API verifies ownership
- API delegates query to Ledger
- own account returns transactions
- another user returns `403`
- missing/non-active account returns `404`
- Ledger unavailable returns `503`

`GET /v1/accounts/{accountNumber}/transactions/{transactionId}`:

- API verifies ownership
- API delegates query to Ledger
- own transaction returns `200`
- wrong accountNumber returns `404`
- missing transaction returns `404`
- another user’s account returns `403`
- missing/non-active account returns `404`
- Ledger unavailable returns `503`

---

# 34. Monorepo structure

Use this structure.

```text
apps/
  api/
    src/
      app.ts
      app.test.ts
      server.ts
      server.test.ts
      composition-root.ts
      composition-root.test.ts

      plugins/
        auth.plugin.ts
        auth.plugin.test.ts
        error-handler.plugin.ts
        error-handler.plugin.test.ts
        request-context.plugin.ts
        request-context.plugin.test.ts
        logger.plugin.ts
        logger.plugin.test.ts

      routes/
        users.routes.ts
        users.routes.test.ts
        accounts.routes.ts
        accounts.routes.test.ts
        transactions.routes.ts
        transactions.routes.test.ts
        health.routes.ts
        health.routes.test.ts

      clients/
        auth.client.ts
        auth.client.test.ts
        ledger.client.ts
        ledger.client.test.ts

      reconciliation/
        account-ledger-reconciler.ts
        account-ledger-reconciler.test.ts

    test/
      integration/
        users.integration.test.ts
        accounts.integration.test.ts
        transactions.integration.test.ts
        auth-boundary.integration.test.ts
        account-ledger-reconciliation.integration.test.ts
        health.integration.test.ts

      e2e/
        create-user-login-create-account-deposit.e2e.test.ts
        create-user-login-create-account-withdraw.e2e.test.ts
        insufficient-funds.e2e.test.ts
        ownership-security.e2e.test.ts
        session-revocation.e2e.test.ts

      helpers/
        create-test-app.ts
        database.ts
        factories.ts
        auth.ts
        log-capture.ts

    package.json
    tsconfig.json

  auth-service/
    src/
      app.ts
      app.test.ts
      server.ts
      server.test.ts
      composition-root.ts
      composition-root.test.ts

      routes/
        auth.routes.ts
        auth.routes.test.ts
        internal-auth.routes.ts
        internal-auth.routes.test.ts
        health.routes.ts
        health.routes.test.ts

      services/
        login.service.ts
        login.service.test.ts
        session.service.ts
        session.service.test.ts
        token.service.ts
        token.service.test.ts
        password-hasher.ts
        password-hasher.test.ts

      repositories/
        user-credentials.repository.ts
        user-credentials.repository.test.ts
        auth-session.repository.ts
        auth-session.repository.test.ts

    test/
      integration/
        login.integration.test.ts
        password-hash.integration.test.ts
        session-introspection.integration.test.ts
        dynamodb-session.integration.test.ts
        health.integration.test.ts

    package.json
    tsconfig.json

  ledger-service/
    src/
      app.ts
      app.test.ts
      server.ts
      server.test.ts
      composition-root.ts
      composition-root.test.ts

      routes/
        ledger-account.routes.ts
        ledger-account.routes.test.ts
        ledger-command.routes.ts
        ledger-command.routes.test.ts
        ledger-query.routes.ts
        ledger-query.routes.test.ts
        health.routes.ts
        health.routes.test.ts

      services/
        create-ledger-account.service.ts
        create-ledger-account.service.test.ts
        close-ledger-account.service.ts
        close-ledger-account.service.test.ts
        get-ledger-balance.service.ts
        get-ledger-balance.service.test.ts
        get-ledger-balances.service.ts
        get-ledger-balances.service.test.ts
        post-transaction.service.ts
        post-transaction.service.test.ts
        ledger-query.service.ts
        ledger-query.service.test.ts
        ledger-idempotency.service.ts
        ledger-idempotency.service.test.ts

      repositories/
        ledger-account.repository.ts
        ledger-account.repository.test.ts
        ledger-transaction.repository.ts
        ledger-transaction.repository.test.ts
        ledger-entry.repository.ts
        ledger-entry.repository.test.ts
        ledger-outbox.repository.ts
        ledger-outbox.repository.test.ts
        ledger-idempotency.repository.ts
        ledger-idempotency.repository.test.ts

    test/
      integration/
        create-ledger-account.integration.test.ts
        close-ledger-account.integration.test.ts
        ledger-balance-read.integration.test.ts
        ledger-batch-balance-read.integration.test.ts
        post-deposit.integration.test.ts
        post-withdrawal.integration.test.ts
        insufficient-funds.integration.test.ts
        balance-limit.integration.test.ts
        idempotency.integration.test.ts
        ledger-query.integration.test.ts
        ledger-concurrency.integration.test.ts
        ledger-outbox.integration.test.ts
        health.integration.test.ts

    package.json
    tsconfig.json

  ledger-event-publisher/
    src/
      publisher.ts
      publisher.test.ts
      poller.ts
      poller.test.ts
      event-claiming.ts
      event-claiming.test.ts
      lease-recovery.ts
      lease-recovery.test.ts
      retry-policy.ts
      retry-policy.test.ts
      sqs-ledger-event-publisher.ts
      sqs-ledger-event-publisher.test.ts
      composition-root.ts
      composition-root.test.ts

    test/
      integration/
        publish-ledger-events.integration.test.ts
        retry-ledger-events.integration.test.ts
        dead-ledger-events.integration.test.ts
        lease-recovery.integration.test.ts
        multi-publisher-claiming.integration.test.ts

    package.json
    tsconfig.json

packages/
  config/
    src/
      env.ts
      env.test.ts
      index.ts

  logger/
    src/
      logger.ts
      logger.test.ts
      redaction.ts
      redaction.test.ts
      request-logger.ts
      request-logger.test.ts
      index.ts

  database/
    prisma/
      schema.prisma
      migrations/
      seed.ts

    src/
      prisma.ts
      prisma.test.ts
      transaction.ts
      transaction.test.ts
      index.ts

  dynamodb/
    src/
      dynamodb-client.ts
      dynamodb-client.test.ts
      tables.ts
      tables.test.ts
      index.ts

  contracts/
    openapi/
      <preserve-provided-openapi-file-name>

    src/
      schemas/
        users.schemas.ts
        users.schemas.test.ts
        accounts.schemas.ts
        accounts.schemas.test.ts
        transactions.schemas.ts
        transactions.schemas.test.ts
        health.schemas.ts
        health.schemas.test.ts

      index.ts

    test/
      contract-shape.test.ts

  auth-contracts/
    src/
      auth.schemas.ts
      auth.schemas.test.ts
      auth.types.ts
      index.ts

  ledger-contracts/
    src/
      ledger-account.schemas.ts
      ledger-account.schemas.test.ts
      ledger-command.schemas.ts
      ledger-command.schemas.test.ts
      ledger-query.schemas.ts
      ledger-query.schemas.test.ts
      ledger-event.schemas.ts
      ledger-event.schemas.test.ts
      ledger.types.ts
      index.ts

  ledger-domain/
    src/
      ledger.rules.ts
      ledger.rules.test.ts
      ledger.mapper.ts
      ledger.mapper.test.ts
      ledger-events.ts
      ledger-events.test.ts
      ledger.types.ts
      index.ts

  errors/
    src/
      AppError.ts
      AppError.test.ts
      error-codes.ts
      http-errors.ts
      http-errors.test.ts
      index.ts

  money/
    src/
      money.ts
      money.test.ts
      index.ts

  internal-auth/
    src/
      internal-service-token.ts
      internal-service-token.test.ts
      internal-auth.plugin.ts
      internal-auth.plugin.test.ts
      index.ts

  test-support/
    src/
      database.ts
      factories.ts
      auth.ts
      dynamodb.ts
      sqs.ts
      ledger.ts
      index.ts

infra/
  bin/
    eagle-bank.ts

  lib/
    eagle-bank-stack.ts
    networking.ts
    database.ts
    dynamodb.ts
    messaging.ts
    waf.ts
    api-service.ts
    auth-service.ts
    ledger-service.ts
    ledger-event-publisher.ts
    migration-task.ts
    observability.ts
    security.ts

  test/
    eagle-bank-stack.test.ts

Root files:
- package.json
- package-lock.json
- turbo.json
- tsconfig.base.json
- docker-compose.yml
- Dockerfile
- .dockerignore
- .env.example
- README.md

Reviewer examples:
examples/
  requests.http

scripts/
  smoke-test.sh
```

---

# 35. Unit test sibling rule

Every executable source file must have a sibling `.test.ts` file except:

- `index.ts` barrel files
- `*.types.ts`
- generated files
- Prisma migration files
- `schema.prisma`
- `packages/database/prisma/seed.ts`
- test helper files under `test/` or `test-support/`
- CDK `bin/` entrypoint files
- CDK construct files under `infra/lib/*.ts`
- static config files
- files containing only type exports
- files containing only constants with no logic

CDK constructs are tested through:

```text
infra/test/eagle-bank-stack.test.ts
```

All service logic, repositories, clients, mappers, rules, plugins, routes, publishers, and reconciliation logic must have sibling tests.

---

# 36. Testing strategy

Testing must include:

1. Colocated unit tests.
2. Package integration tests.
3. Service integration tests.
4. API-to-service integration tests.
5. Ledger integration tests.
6. Ledger concurrency tests.
7. Ledger Event Publisher tests.
8. E2E tests across API, Auth, Ledger, PostgreSQL, DynamoDB, and LocalStack.
9. CDK assertion tests.
10. Logging and redaction tests.
11. OpenAPI contract tests.
12. Reconciliation tests.
13. PostgreSQL schema/index tests.
14. DynamoDB key/index definition tests.
15. Reviewer smoke-test execution.

Coverage target:

```text
100% statements
100% branches
100% functions
100% lines
```

Coverage is required but is not proof of correctness.

Integration, E2E, concurrency, and failure-mode tests are mandatory.

## 36.1 Database index verification

PostgreSQL integration tests must inspect PostgreSQL system catalogs or
`pg_indexes` and verify that every required unique constraint and index exists
after migrations run against an empty test database.

Tests must also verify:

- all foreign-key columns have a supporting index
- duplicate email is rejected
- duplicate accountNumber is rejected
- duplicate transactionId is rejected
- duplicate Ledger eventId is rejected
- duplicate `(userId, accountNumber, idempotencyKey)` is rejected
- migrations apply successfully from an empty database
- migrations are repeatable through the documented deployment command

For critical list, reconciliation, idempotency, and outbox queries, include
`EXPLAIN` or `EXPLAIN ANALYZE` tests against representative seeded data and
assert that the intended index is available to the planner. Avoid brittle
assertions on exact costs or timing.

DynamoDB integration/CDK tests must verify:

- partition key is `pk` with type String
- sort key is `sk` with type String
- TTL attribute is `expiresAtEpoch`
- no unintended GSI or LSI exists
- introspection performs `GetItem`, not `Scan`
- listing a user's sessions performs `Query`, not `Scan`
- DynamoDB Local and CDK definitions remain equivalent

---

# 37. Required Auth tests

Auth service:

- login succeeds with valid credentials
- login fails with invalid email
- login fails with invalid password
- login writes auth session metadata to DynamoDB
- login returns `LoginResponse` with `accessToken`, `tokenType`, and `expiresIn`
- login JWT includes `sub`, `sid`, `jti`, `iat`, `exp`
- login never returns passwordHash
- password hash endpoint returns argon2 hash
- password hash endpoint requires internal service auth
- session introspection succeeds for valid session
- session introspection fails for revoked session
- session introspection fails for expired session
- session introspection fails for missing session
- `/ready` returns 200 with `{ "status": "ready" }` when PostgreSQL and DynamoDB reachable
- `/ready` returns 503 with `{ "status": "not_ready" }` when DynamoDB unavailable
- logs redact password
- logs redact JWT
- logs include request/correlation IDs
- public auth errors use OpenAPI-compatible envelope except `/ready`, which uses `ReadinessResponse`

API auth integration:

- protected route accepts valid JWT plus valid session
- protected route rejects expired JWT
- protected route rejects invalid JWT
- protected route rejects valid JWT with missing session
- protected route rejects revoked session
- Auth unavailable returns 503
- missing JWT returns 401

DynamoDB:

- session record written with correct `pk` and `sk`
- TTL attribute set
- tokenId persisted
- sessionId persisted
- revokedAt nullable on active session

---

# 38. Required account lifecycle tests

API/account + Ledger creation:

- account creation creates metadata `PENDING_LEDGER_CREATION`
- successful Ledger creation marks account `ACTIVE`
- response balance comes from Ledger
- Ledger creation failure marks `LEDGER_CREATION_FAILED`
- failed account does not appear in list
- failed account cannot receive transaction
- reconciler retries failed Ledger creation
- reconciler marks account `ACTIVE` after success
- duplicate Ledger creation with same accountNumber is idempotent
- duplicate Ledger creation with conflicting data returns 409

Account deletion:

- account with no Ledger transactions closes/deletes successfully
- account with Ledger transactions becomes `PENDING_LEDGER_CLOSURE`, then `CLOSED`
- Ledger closure failure marks `LEDGER_CLOSURE_FAILED`
- failed closure blocks new transactions
- reconciler retries failed closure
- Ledger closed + metadata not closed mismatch is reconciled
- repeated delete after closed returns 404
- `CLOSED` account does not block user deletion
- non-final account states block user deletion with 409

Account balance reads:

- single account response fetches Ledger balance
- account list uses Ledger batch balance endpoint
- Ledger unavailable during single account read returns 503
- Ledger unavailable during account list returns 503
- missing Ledger projection returns 503
- API does not use stale balance
- API does not store balance as source of truth in metadata

---

# 39. Required Ledger unit tests

`ledger.rules.test.ts`:

- deposit with positive amount valid
- withdrawal with positive amount valid
- amount zero invalid
- negative amount invalid
- unsupported currency invalid
- deposit within balance limit valid
- deposit exceeding max balance rejected
- withdrawal with sufficient funds valid
- withdrawal with insufficient funds rejected
- closed Ledger account rejects deposit
- closed Ledger account rejects withdrawal
- balance cannot become negative
- balance cannot exceed `10000.00`
- Decimal calculations avoid JavaScript floating point arithmetic

`ledger.mapper.test.ts`:

- maps Ledger transaction to OpenAPI transaction response
- does not expose internal accountId unless contract requires it
- maps Decimal correctly
- maps transaction type correctly
- maps createdAt correctly

`ledger-events.test.ts`:

- builds `TransactionPosted`
- includes eventId
- includes transactionId
- includes accountNumber
- includes userId
- includes amount/currency
- includes balanceAfter
- includes requestId/correlationId
- excludes secrets/tokens

---

# 40. Required Ledger integration tests

Use real PostgreSQL test database.

Do not mock database behaviour.

## 40.1 create-ledger-account.integration.test.ts

- creates Ledger account for accountNumber
- initializes balance
- rejects duplicate accountNumber deterministically
- duplicate same data is idempotent
- duplicate conflicting data returns 409
- stores internal accountId relation
- creates account in GBP
- closed account cannot be recreated unless explicitly allowed

## 40.2 close-ledger-account.integration.test.ts

- closes Ledger account
- closed Ledger account rejects posting
- missing Ledger account returns not found
- repeated close deterministic
- closing account with transaction history preserves historical transactions

## 40.3 ledger-balance-read.integration.test.ts

- returns balance for accountNumber
- missing Ledger account returns not found
- closed Ledger account returns not found for public semantics
- does not expose internal-only fields

## 40.4 ledger-batch-balance-read.integration.test.ts

- returns balances for multiple accountNumbers
- preserves accountNumber mapping
- missing one account returns error
- empty request returns empty response or validation error as specified
- does not return partial balances on missing projection

## 40.5 post-deposit.integration.test.ts

- posts deposit successfully
- creates immutable Ledger transaction
- creates Ledger entry
- updates balance
- stores balanceAfter
- creates `TransactionPosted` outbox event
- returns Ledger contract result
- rejects amount `0.00`
- rejects negative amount
- rejects unsupported currency
- rejects deposit exceeding `10000.00`
- failed deposit creates no transaction
- failed deposit creates no entry
- failed deposit creates no event
- failed deposit does not mutate balance

## 40.6 post-withdrawal.integration.test.ts

- posts withdrawal successfully
- creates immutable Ledger transaction
- creates Ledger entry
- updates balance
- stores balanceAfter
- creates `TransactionPosted` outbox event
- rejects amount `0.00`
- rejects negative amount
- rejects unsupported currency
- rejects insufficient funds
- failed withdrawal creates no transaction
- failed withdrawal creates no entry
- failed withdrawal creates no event
- failed withdrawal does not mutate balance

## 40.7 idempotency.integration.test.ts

- first request with key posts transaction
- retry same key/body returns original result
- retry creates no duplicate transaction
- retry creates no duplicate entry
- retry creates no duplicate event
- same key different amount returns 409
- same key different type returns 409
- same key different accountNumber returns 409
- idempotency scoped by userId/accountNumber/key
- request hash stored
- response payload stored

## 40.8 ledger-query.integration.test.ts

- list transactions by accountNumber in deterministic order
- fetch transaction by transactionId
- wrong accountNumber returns not found
- missing transaction returns not found
- closed account returns not found for public semantics
- internal-only fields not exposed

## 40.9 ledger-outbox.integration.test.ts

- successful deposit creates one pending outbox event
- successful withdrawal creates one pending outbox event
- failed withdrawal creates no outbox event
- failed balance-limit deposit creates no outbox event
- payload validates against Ledger event schema
- payload includes requestId/correlationId
- event starts as `PENDING`

---

# 41. Required Ledger concurrency tests

`ledger-concurrency.integration.test.ts` is mandatory.

Use real PostgreSQL transactions.

Required tests:

- two concurrent withdrawals from same account cannot both spend same balance
- concurrent withdrawals cannot produce negative balance
- one withdrawal succeeds and one fails when combined amount exceeds balance
- concurrent deposits both succeed and final balance correct
- concurrent deposit and withdrawal produce valid final balance
- account row is locked during posting
- idempotent concurrent duplicate requests create only one transaction
- same idempotency key with different body returns deterministic conflict
- concurrent requests for different accounts do not block unnecessarily

Implementation expectation:

- use `SELECT ... FOR UPDATE` or equivalent row-level locking
- balance check and mutation inside one PostgreSQL transaction
- document isolation level and locking strategy

---

# 42. Required API-to-Ledger integration tests

Required:

- API deposit calls Ledger service
- API withdrawal calls Ledger service
- API maps Ledger success to OpenAPI response
- API maps insufficient funds to 422
- API maps balance limit exceeded to 422
- API maps invalid amount to 400
- API maps idempotency conflict to 409
- API maps Ledger unavailable to 503
- API maps Ledger account closed/not found to 404
- API verifies ownership before calling Ledger
- API returns 403 for another user’s account and does not call Ledger
- API does not write Ledger transaction rows
- API does not mutate Ledger balances
- API passes requestId to Ledger
- API passes correlationId to Ledger
- API passes Idempotency-Key to Ledger
- API does not retry financial command without Idempotency-Key
- API retries once with Idempotency-Key on timeout/network failure

At least one E2E test must use the real Ledger service.

---

# 43. Required Ledger Event Publisher tests

Do not call these outbox worker tests.

## 43.1 publish-ledger-events.integration.test.ts

- claims pending Ledger event
- publishes event to LocalStack SQS
- marks event `PUBLISHED`
- stores `publishedAt`
- does not alter Ledger transaction data
- published message matches `TransactionPosted` schema

## 43.2 retry-ledger-events.integration.test.ts

- failed publish increments attempts
- failed publish sets status `FAILED`
- failed publish sets `nextAttemptAt`
- retry uses exponential backoff with jitter
- retry eventually publishes successfully
- successful retry marks event `PUBLISHED`

## 43.3 dead-ledger-events.integration.test.ts

- event becomes `DEAD` after max attempts
- `lastError` stored
- dead event logged at error level
- dead event not retried automatically
- dead event does not affect committed Ledger transaction

## 43.4 lease-recovery.integration.test.ts

- expired `PROCESSING` event recoverable
- non-expired `PROCESSING` event not reclaimed
- recovered event can be published
- recovery increments or preserves attempts according to documented policy

## 43.5 multi-publisher-claiming.integration.test.ts

- two publisher instances cannot claim same event
- batch claiming uses `FOR UPDATE SKIP LOCKED`
- events distributed across publishers
- no duplicate SQS messages under normal operation
- at-least-once semantics documented for crash cases

---

# 44. Required E2E tests

E2E tests run with:

- API service
- Auth service
- Ledger service
- PostgreSQL test database
- DynamoDB Local
- LocalStack

## 44.1 create-user-login-create-account-deposit.e2e.test.ts

1. Create user.
2. API calls Auth to hash password.
3. Login through Auth.
4. Auth writes session to DynamoDB.
5. Create account through API.
6. API creates account metadata.
7. API creates Ledger account.
8. Account becomes active.
9. Deposit through public API.
10. API delegates to Ledger.
11. Ledger posts transaction.
12. API returns OpenAPI response.
13. Account read fetches balance from Ledger.
14. Transaction list returns deposit.
15. Ledger event exists.
16. Ledger Event Publisher publishes event.

## 44.2 create-user-login-create-account-withdraw.e2e.test.ts

1. Create user.
2. Login.
3. Create account.
4. Deposit.
5. Withdraw.
6. Balance updated correctly.
7. Transaction list contains both.
8. Ledger events exist for both.

## 44.3 insufficient-funds.e2e.test.ts

1. Create user.
2. Login.
3. Create account.
4. Attempt withdrawal with insufficient funds.
5. Public API returns 422.
6. Ledger has no transaction.
7. Ledger has no event.
8. Balance unchanged.

## 44.4 ownership-security.e2e.test.ts

1. Create user A and user B.
2. User A creates account.
3. User B attempts deposit to user A account.
4. Public API returns 403.
5. Ledger service is not called.
6. No transaction created.
7. No Ledger event created.

## 44.5 session-revocation.e2e.test.ts

1. Create user.
2. Login.
3. Session exists in DynamoDB.
4. Mark session revoked.
5. Protected API request with same JWT returns 401.

## 44.6 delete-accounts-then-delete-user.e2e.test.ts

1. Create user.
2. Login.
3. Create account.
4. Delete account.
5. Account reaches `CLOSED`.
6. Delete user.
7. User deletion succeeds because only `CLOSED` accounts remain.

---

# 45. Contract tests

Verify:

- OpenAPI uses `{accountNumber}`
- OpenAPI does not expose `{accountId}` in public route paths
- transaction response matches OpenAPI
- account response matches OpenAPI
- user response never includes passwordHash
- login request schema exists
- login response schema exists
- login response uses `accessToken`, `tokenType`, `expiresIn`
- `POST /v1/users` 400 uses `BadRequestErrorResponse`
- `POST /v1/users` documents `503`
- `POST /v1/accounts/{accountNumber}/transactions` documents `Idempotency-Key`
- transaction idempotency conflict documents `409`
- public distributed dependency failures document `503`
- `/health` is documented
- `/ready` is documented
- `/ready` 200 uses `ReadinessResponse`
- `/ready` 503 uses `ReadinessResponse`
- `/ready` 503 does not use general error envelope
- transactionId pattern corrected to `^tan-[A-Za-z0-9]+$`
- custom regexes use `pattern`, not non-standard `format`
- protected endpoints have bearer security
- public endpoints remain unauthenticated as specified

---

# 46. Docker Compose requirements

Services:

```text
api
auth-service
ledger-service
ledger-event-publisher
shared-application-db
integration-test-db
auth-session-db
localstack
```

DynamoDB Local must create:

```text
eagle-bank-auth-sessions
```

LocalStack must create:

```text
eagle-bank-ledger-events
eagle-bank-ledger-events-dlq
```

Do not create generic `eagle-bank-events` queues unless a concrete non-Ledger event publisher exists.

## 46.1 Reviewer local-start contract

A reviewer starting from a clean checkout must be able to run the complete
application locally without manually creating database tables, DynamoDB tables,
or SQS queues.

The documented primary startup command must be:

```bash
docker compose up --build
```

Docker Compose must:

1. Start PostgreSQL, DynamoDB Local, and LocalStack.
2. Wait for infrastructure health checks.
3. Apply PostgreSQL migrations through a dedicated, gated migration/init
   service or equivalent deterministic startup step. The migration command
   must be idempotent and apply only unapplied migrations on repeated startup.
4. Create the DynamoDB auth-session table idempotently.
5. Create required LocalStack SQS queues idempotently.
6. Start application services only after required initialization succeeds.
7. Expose the public API on one documented localhost base URL.
8. Reach healthy and ready states without manual intervention.

All initialization commands must be safe to run repeatedly.

The README must provide prerequisites, the exact startup command, public base
URL, health/readiness commands, log commands, clean shutdown, clean-volume
restart, and troubleshooting steps.

The Docker path must require no host installation of PostgreSQL, DynamoDB,
LocalStack, npm, or application dependencies. Docker and Docker Compose are
the only mandatory runtime prerequisites for this path.

---

# 47. AWS CDK architecture

CDK must model:

- VPC
- public subnets for ALB
- private subnets for ECS services
- private/isolated subnets for RDS
- AWS WAF Web ACL
- WAF association with ALB
- Application Load Balancer
- ECS cluster
- API Fargate service
- Auth Fargate service
- Ledger Fargate service
- Ledger Event Publisher Fargate service
- migration task
- RDS PostgreSQL
- DynamoDB auth sessions table
- SQS Ledger events queue
- SQS Ledger events DLQ
- Parameter Store `SecureString` parameters
- CloudWatch log groups
- least-privilege IAM roles
- security groups

Public ingress:

```text
Client -> AWS WAF -> ALB
```

ALB listener rules:

```text
/health     -> api
/ready      -> api
/v1/auth/*  -> auth-service
/v1/*       -> api
default     -> fixed 404 response
```

Private services:

```text
ledger-service
ledger-event-publisher
```

No ECS task is directly publicly reachable.

## 47.1 Local versus AWS resource mapping

The implementation must document this explicit mapping:

```text
Local PostgreSQL       -> Amazon RDS for PostgreSQL
DynamoDB Local         -> Amazon DynamoDB
LocalStack SQS         -> Amazon SQS
Docker Compose services -> ECS Fargate services/tasks
Docker secrets/env     -> SSM Parameter Store and ECS secret injection
localhost routing      -> AWS WAF and Application Load Balancer
local logs             -> CloudWatch Logs
```

Resource names, queue FIFO/DLQ relationships, DynamoDB keys/TTL, database
migrations, event schemas, and environment-variable contracts must remain
compatible between local and AWS runtimes.

Local emulator-specific hostnames, ports, credentials, and endpoints must not
appear in synthesized AWS task definitions.

AWS ECS task definitions must:

- omit `DYNAMODB_ENDPOINT`
- omit `SQS_ENDPOINT`
- omit static `AWS_ACCESS_KEY_ID`
- omit static `AWS_SECRET_ACCESS_KEY`
- use task roles with least-privilege DynamoDB and SQS permissions
- obtain application secrets from Parameter Store `SecureString` parameters
- use private networking for RDS and private services

CDK assertion tests must verify these properties.

## 47.2 CDK without an AWS account

The following commands must work without AWS credentials or an AWS account:

```text
npm run infra:test
npm run infra:synth
```

Use deterministic CDK context/default account and region values for offline
synthesis when environment values are absent. CDK code must not perform
deployment-time AWS lookups during tests or synthesis.

Only these operations require an AWS account:

```text
npm run infra:diff
npm run infra:deploy
npm run infra:destroy
cdk bootstrap
```

README must clearly label AWS deployment as optional and must not include it in
the local reviewer quick-start.

---

# 48. WAF requirements

WAF must protect the ALB.

Rules:

- AWS managed common rule set
- known bad inputs rule set
- SQL injection rule set
- Amazon IP reputation list
- rate-based rule

Rate limits:

- `test`: permissive
- `preprod`: moderate
- `prod`: stricter

CDK tests must verify:

- Web ACL exists
- Web ACL has managed rules
- Web ACL has rate-based rule
- Web ACL associated with ALB

---

# 49. CDK migration strategy

CDK must model a database migration task.

Deployment order:

1. Deploy infrastructure.
2. Run migration task.
3. Deploy/update API.
4. Deploy/update Auth service.
5. Deploy/update Ledger service.
6. Deploy/update Ledger Event Publisher.

Migration task:

- uses same app image with migration command or dedicated migration image
- reaches RDS
- reads DB secret
- logs to CloudWatch

---

# 50. CDK tests

Verify:

- VPC exists
- ALB exists
- ALB has `/health` route to API
- ALB has `/ready` route to API
- ALB has `/v1/auth/*` route to Auth service
- ALB has `/v1/*` route to API
- ALB has default fixed 404 response
- WAF Web ACL exists
- WAF associated with ALB
- WAF managed rules exist
- WAF rate-based rule exists
- RDS PostgreSQL exists
- RDS not publicly accessible
- DynamoDB auth sessions table exists
- DynamoDB TTL configured
- SQS Ledger events queue exists
- SQS Ledger events DLQ exists
- ECS API service exists
- ECS Auth service exists
- ECS Ledger service exists
- ECS Ledger Event Publisher exists
- migration task exists
- API behind ALB
- Auth behind ALB for `/v1/auth/*`
- Ledger service private
- Ledger Event Publisher private
- Auth can read/write DynamoDB
- Ledger Event Publisher can publish to SQS
- API has no unnecessary DynamoDB permissions
- CloudWatch log groups exist

---

# 51. Environment variables

Common:

```text
NODE_ENV
PORT
LOG_LEVEL
DATABASE_URL
JWT_SECRET
JWT_EXPIRES_IN
AUTH_SERVICE_JWT_SECRET
LEDGER_SERVICE_JWT_SECRET
SERVICE_NAME
```

API:

```text
AUTH_SERVICE_BASE_URL
LEDGER_SERVICE_BASE_URL
AUTH_INTROSPECTION_TIMEOUT_MS
```

Auth:

```text
DYNAMODB_AUTH_SESSIONS_TABLE
AUTH_SESSION_TTL_SECONDS
```

Ledger:

```text
LEDGER_MAX_BALANCE
LEDGER_CURRENCY
```

Ledger Event Publisher:

```text
LEDGER_EVENT_PUBLISHER_POLL_INTERVAL_MS
LEDGER_EVENT_PUBLISHER_BATCH_SIZE
LEDGER_EVENT_PUBLISHER_MAX_ATTEMPTS
LEDGER_EVENT_PUBLISHER_BACKOFF_BASE_MS
LEDGER_EVENT_PUBLISHER_BACKOFF_MAX_MS
LEDGER_EVENT_PUBLISHER_PROCESSING_LEASE_MS
```

SQS:

```text
AWS_REGION
SQS_LEDGER_EVENTS_QUEUE_URL
SQS_LEDGER_EVENTS_DLQ_URL
```

Local emulator overrides:

```text
DYNAMODB_ENDPOINT
SQS_ENDPOINT
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
AWS_EC2_METADATA_DISABLED=true
```

Rules:

- local Docker Compose must set all local emulator overrides
- AWS ECS task definitions must not set endpoint overrides or static AWS keys
- empty endpoint strings must be normalized to `undefined`
- AWS runtime uses ECS task-role credentials
- `AWS_REGION` is required in both local and AWS runtimes

Testing:

```text
TEST_DATABASE_URL
```

---

# 52. Package scripts

Root scripts:

```text
dev
build
start
test
test:watch
test:coverage
lint
typecheck
format
db:generate
db:migrate
db:deploy
db:reset
db:studio
docker:up
docker:down
api:dev
auth:dev
ledger:dev
ledger-event-publisher:dev
infra:synth
infra:diff
infra:deploy
infra:destroy
infra:test
```

Turbo pipeline:

```text
build
test
lint
typecheck
```

---

# 53. README requirements

README must include:

1. Project overview
2. Assessment scope
3. OpenAPI contract-first approach
4. OpenAPI corrections made
5. Tech stack
6. Node/npm versions
7. Why Turborepo
8. Why separated services
9. Shared PostgreSQL ownership model
10. Why API is a façade
11. Why Auth service is separate
12. Why users stay in PostgreSQL
13. Why Auth sessions use DynamoDB
14. Exact login schema
15. Why Ledger service is separate
16. Why Ledger owns money movement
17. Why Ledger Event Publisher exists
18. Why not call it outbox worker
19. Account balance read path
20. Distributed account creation workflow
21. Distributed account deletion workflow
22. Reconciliation strategy
23. User deletion after account closure
24. Internal service authentication
25. Timeout and retry strategy
26. Financial command idempotency
27. Why async Ledger commands are disabled by default
28. WAF and ALB protection
29. ALB listener routing
30. Docker architecture diagram
31. AWS architecture diagram
32. Runtime services
33. Environment variables
34. Local setup
35. Running tests
36. Running coverage
37. CDK synth/diff/deploy
38. Ledger concurrency strategy
39. Ledger event publishing strategy
40. DynamoDB Local setup
41. LocalStack setup
42. Error handling
43. Logging/redaction
44. Health/readiness
45. Testing strategy
46. Coverage target
47. Assumptions
48. Trade-offs
49. Completed endpoints
50. Incomplete items, if any
51. Future production improvements
52. Follow-up walkthrough notes
53. PostgreSQL index and constraint rationale
54. DynamoDB access patterns and why no secondary index is required
55. Reviewer quick-start from a clean checkout
56. Example requests for every public endpoint
57. Automated smoke-test instructions
58. Expected example responses and status codes
59. Local AWS emulation with no AWS account
60. Local-to-AWS resource mapping
61. Optional AWS deployment prerequisites

README must explicitly say:

The public API service implements the OpenAPI contract but does not own the banking Ledger. Deposits, withdrawals, immutable transaction records, idempotency, and balance mutation are owned by a separate Ledger service.

The Ledger Event Publisher reads committed events from the Ledger outbox table and publishes them to the Ledger events queue.

These are separately deployed services using a shared PostgreSQL database to keep local setup manageable. A database-per-service deployment would coordinate cross-service workflows through events and sagas.

`CLOSED` accounts are preserved internally for historical integrity but do not block user deletion, because the user has successfully deleted their active accounts.

`GET /ready` uses `ReadinessResponse` for both ready and not-ready states instead of the general error envelope.

Local execution uses DynamoDB Local for auth sessions and LocalStack for SQS.
It does not require AWS credentials, an AWS account, CDK bootstrap, or deployed
AWS resources.

The same application code and container images are deployable to AWS. Local
endpoint overrides and placeholder credentials are omitted in AWS, where ECS
task roles and native AWS service endpoints are used.

## 53.1 Example requests

Provide copy-pasteable `curl` examples in README and a committed:

```text
examples/requests.http
```

Examples must use the documented localhost base URL and cover:

1. Health
2. Readiness
3. Create user
4. Login and obtain `accessToken`
5. Fetch own user
6. Update own user
7. Create account
8. List accounts
9. Fetch account
10. Update account
11. Deposit
12. Withdraw
13. Retry a deposit with the same `Idempotency-Key`
14. Demonstrate conflicting reuse of an `Idempotency-Key`
15. List transactions
16. Fetch one transaction
17. Attempt an insufficient-funds withdrawal and show expected `422`
18. Delete account
19. Delete user

The examples must:

- show required headers and JSON request bodies
- use `Authorization: Bearer <token>` on protected endpoints
- use valid OpenAPI field names
- show how to capture and reuse `userId`, `accessToken`, `accountNumber`, and
  `transactionId`
- include expected status codes
- avoid hard-coded identifiers that do not exist in a clean environment
- never include real secrets

## 53.2 Automated smoke test

Provide:

```text
scripts/smoke-test.sh
```

The script must run against the Docker Compose public base URL and perform:

```text
health
ready
create user
login
create account
deposit
withdraw
fetch account
list transactions
fetch transaction
delete account
delete user
```

It must:

- use `set -euo pipefail`
- wait for readiness with a bounded timeout
- generate unique user data and idempotency keys for repeated runs
- capture and reuse all returned identifiers and the JWT
- parse JSON using Node.js in a documented containerized command
- fail with a non-zero exit code on unexpected status or response
- print concise progress and a final success message
- require no host dependency other than Docker and Docker Compose

The smoke test supplements tests; it does not replace unit, integration, or E2E
tests.

---

# 54. Implementation order

1. Inspect OpenAPI.
2. Report conflicts.
3. Apply OpenAPI corrections.
4. Add login request/response schemas.
5. Add public 503 responses, including `POST /v1/users`.
6. Add Idempotency-Key header.
7. Add transaction 409 response.
8. Add `/health` and `/ready`.
9. Ensure `/ready` 503 uses `ReadinessResponse`, not general error envelope.
10. Confirm `accountNumber` public route parameter.
11. Scaffold Turborepo.
12. Add Node/npm constraints.
13. Add Docker Compose.
14. Add PostgreSQL services.
15. Add DynamoDB Local.
16. Add LocalStack queues.
17. Add Prisma schema with required PostgreSQL constraints and indexes.
18. Add config package.
19. Add logger package.
20. Add errors package.
21. Add money package.
22. Add internal-auth package.
23. Add database package.
24. Add dynamodb package and exact key/index definitions.
25. Add contracts packages.
26. Add Auth service.
27. Add API service.
28. Add Ledger domain.
29. Add Ledger service.
30. Add Ledger Event Publisher.
31. Keep Ledger event publication asynchronous through the outbox publisher.
32. Add request/correlation IDs.
33. Add internal service authentication.
34. Add timeout/retry policies.
35. Add account lifecycle states.
36. Add account-ledger reconciler.
37. Add WAF/ALB CDK model.
38. Add ALB `/health`, `/ready`, `/v1/auth/*`, `/v1/*`, and default 404 routing.
39. Add RDS/DynamoDB/SQS CDK model with offline synth support.
40. Add migration task CDK model.
41. Implement user creation with Auth password hashing.
42. Implement login with DynamoDB sessions.
43. Implement session introspection.
44. Implement account creation with Ledger account creation.
45. Implement account balance read composition.
46. Implement account list batch balance composition.
47. Implement account deletion with Ledger closure.
48. Implement user deletion excluding `CLOSED` accounts from blocking check.
49. Implement Ledger deposit.
50. Implement Ledger withdrawal.
51. Implement Ledger transaction queries.
52. Implement API transaction façade.
53. Implement Ledger Event Publisher.
54. Add unit tests.
55. Add Auth integration tests.
56. Add account lifecycle integration tests.
57. Add Ledger integration tests.
58. Add Ledger concurrency tests.
59. Add API-to-Ledger tests.
60. Add E2E tests.
61. Add PostgreSQL index/catalog tests.
62. Add DynamoDB key/index parity tests.
63. Add local emulator endpoint-safety tests.
64. Add CDK tests, including no static AWS credentials/endpoints in ECS tasks.
65. Add README and copy-pasteable request examples.
66. Add and run the automated Docker smoke test.
67. Run offline CDK tests and synthesis without AWS credentials.
68. Run typecheck.
69. Run build.
70. Run tests with coverage.
71. Fix failures.
72. Validate startup from a clean Docker volume state.
73. Final review against this specification.

---

# 55. Completion criteria

Before final response, confirm:

- OpenAPI inspected
- OpenAPI corrections made
- login schemas added
- public 503 responses added
- `POST /v1/users` documents 503
- Idempotency-Key documented
- transaction 409 documented
- `/health` documented
- `/ready` documented
- `/ready` 503 uses `ReadinessResponse`
- `/ready` 503 does not use general error envelope
- public routes use `accountNumber`
- packageManager pinned to `npm@11.9.0`
- Auth service separate
- users remain in PostgreSQL
- Auth hashes passwords
- API does not hash passwords
- API calls Auth for password hashing
- Auth sessions stored in DynamoDB
- PostgreSQL constraints and indexes match required access patterns
- every foreign-key column has a supporting PostgreSQL index
- critical PostgreSQL query plans can use the intended indexes
- DynamoDB uses `pk` and `sk` with the documented String key types
- DynamoDB TTL uses `expiresAtEpoch`
- no unnecessary DynamoDB GSI or LSI exists
- DynamoDB request paths do not use `Scan`
- DynamoDB Local and AWS CDK table definitions match
- local execution requires no AWS account or AWS profile
- local AWS SDK calls use DynamoDB Local and LocalStack endpoints
- local execution performs no AWS STS or metadata calls
- application code uses shared environment-driven AWS SDK client factories
- API validates JWT and introspects session
- Auth unavailable on protected request returns 503
- internal service calls use signed service JWTs
- API owns metadata only
- Ledger owns balances
- account reads fetch balance from Ledger
- account lists use Ledger batch balances
- Ledger unavailable for balance read returns 503
- account creation uses pending-state workflow
- Ledger account creation idempotent
- failed Ledger creation marked and reconciled
- account deletion uses closure workflow
- failed Ledger closure marked and reconciled
- `CLOSED` accounts do not block user deletion
- Ledger service separate
- API does not mutate balances
- API does not write Ledger transactions
- API delegates money movement to Ledger
- Ledger owns idempotency
- Ledger uses row-level locking or documented equivalent
- no blind retry of financial commands
- retry allowed only with Idempotency-Key
- async Ledger command path disabled by default
- no competing sync/async execution path
- Ledger Event Publisher exists
- no service named `outbox-worker`
- generic `eagle-bank-events` queue not created unless used
- WAF protects ALB
- ALB routes `/health` to API
- ALB routes `/ready` to API
- ALB routes `/v1/auth/*` to Auth
- ALB routes `/v1/*` to API
- ALB default returns fixed 404
- Ledger service private
- Docker Compose includes required services
- clean-checkout Docker startup applies migrations and initializes DynamoDB/SQS
- local services become healthy and ready without manual intervention
- CDK includes required resources
- `infra:test` and `infra:synth` work without AWS credentials
- AWS ECS tasks omit emulator endpoints and static AWS access keys
- AWS ECS tasks use least-privilege task roles
- CDK construct test strategy is not contradicted by sibling-test rule
- seed script is excluded from sibling-test rule
- Ledger integration tests exist
- Ledger concurrency tests exist
- Ledger Event Publisher tests exist
- E2E tests exist
- README contains example requests for every public endpoint
- `examples/requests.http` is complete and runnable
- `scripts/smoke-test.sh` passes against Docker Compose
- tests pass
- coverage reported
- README explains architecture and trade-offs

---

# 56. Final response format

When complete, provide:

- implemented features
- endpoint list
- OpenAPI corrections made
- runtime services summary
- Auth service summary
- Ledger service summary
- Ledger Event Publisher summary
- account lifecycle summary
- balance read path summary
- user deletion semantics summary
- internal service security summary
- timeout/retry summary
- Docker summary
- PostgreSQL index/constraint summary
- DynamoDB key/index summary
- CDK summary
- WAF/ALB summary
- reviewer local-start summary
- example-request and smoke-test summary
- testing summary
- Ledger integration testing summary
- Ledger concurrency testing summary
- E2E testing summary
- build/typecheck summary
- coverage summary
- assumptions
- trade-offs
- incomplete items
