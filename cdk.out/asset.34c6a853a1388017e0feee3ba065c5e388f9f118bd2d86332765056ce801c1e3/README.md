# Eagle Bank

A production-shaped TypeScript implementation of the Eagle Bank take-home
assessment. It implements every public endpoint in `openapi.yaml`, all
assessment scenarios, strict bearer-session enforcement, Ledger-owned money
movement, and a no-AWS-account local runtime.

## Quick Start

Prerequisites: Docker and Docker Compose only.

```bash
docker compose up --build
```

The public API is `http://localhost:3000`.

```bash
curl http://localhost:3000/health
curl http://localhost:3000/ready
./scripts/smoke-test.sh
docker compose logs -f api auth-service ledger-service
docker compose down
```

To test a completely clean volume:

```bash
docker compose down -v
docker compose up --build
```

Compose waits for PostgreSQL and the local AWS emulators, applies only
unapplied Prisma migrations, creates the DynamoDB table and SQS queues
idempotently, then starts the application services.

## Architecture

```text
Client
  |
  v
API :3000 ---- signed 60s JWT ----> Auth service :3001
  |                                  |          |
  |                                  |          +-> PostgreSQL users
  |                                  +------------> DynamoDB Local sessions
  |
  +----------- signed 60s JWT ----> Ledger service :3002
                                      |
                                      +-> PostgreSQL Ledger + outbox
                                                   |
                                                   v
                                      Ledger Event Publisher -> LocalStack SQS

Ledger Worker -> SQS FIFO command queue (modeled, disabled locally)
```

Runtime services are `api`, `auth-service`, `ledger-service`,
`ledger-worker`, `ledger-event-publisher`, `postgres`, `postgres-test`,
`dynamodb-local`, and `localstack`.

The public API service implements the OpenAPI contract but does not own the
banking Ledger. Deposits, withdrawals, immutable transaction records,
idempotency, and balance mutation are owned by a separate Ledger service.

The Ledger Event Publisher publishes committed Ledger events from the Ledger
outbox table to the Ledger events queue. It is named after its business
responsibility rather than the underlying outbox implementation pattern.

These are separately deployed services using a shared PostgreSQL database as a
take-home simplification. A stricter production design would split databases
and coordinate through events and sagas.

## Service Ownership

- API: OpenAPI façade, profiles, account metadata, ownership checks, response
  composition, Auth/Ledger delegation.
- Auth: password hashing/verification, JWT issuance, DynamoDB sessions and
  introspection.
- Ledger: balances, deposits, withdrawals, immutable transactions and entries,
  row locking, idempotency, outbox writes.
- Ledger Event Publisher: leased outbox claiming, SQS publication, retry and
  terminal failure state.
- Ledger Worker: future FIFO command consumer. It stays idle because
  `LEDGER_ASYNC_COMMANDS_ENABLED=false`.

Internal HTTP calls use HS256 service JWTs containing `iss`, `aud`, `iat`,
`exp`, and `jti`; lifetime is at most 60 seconds. Private networking is still
required in AWS. Auth introspection uses a 300 ms timeout and no retry.
Financial posts are not blindly retried; clients should supply
`Idempotency-Key`.

## Contract First

`openapi.yaml` is executable, not documentation-only:

- every matched request is validated before route handling;
- every matched response body and status is validated before sending;
- contract-invalid requests return `400`;
- an implementation response that violates the contract becomes `500`.

Corrections to the supplied contract include login, bearer security, password
input, health/readiness, `accountNumber` path naming, identifier regexes,
positive transaction amounts, transaction idempotency conflict, and
distributed-service `503` responses. Decisions are recorded in
`Contract conflicts.md`.

Public endpoints:

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

`GET /ready` uses `ReadinessResponse` for both ready and not-ready states. It
intentionally does not use the general error envelope.

## Data And Consistency

Money is PostgreSQL `DECIMAL(12,2)` and the only currency is GBP. A Ledger
transaction:

1. resolves the account by its unique account number;
2. locks the Ledger account row with `SELECT ... FOR UPDATE`;
3. enforces non-negative balance and the `10000.00` maximum;
4. writes the immutable transaction and entry;
5. updates the balance/version;
6. writes `TransactionPosted` to the outbox;
7. commits everything atomically.

Rejected commands write none of those records. Idempotency is scoped by
`(userId, accountNumber, idempotencyKey)` and conflicting payload reuse returns
`409`.

API account metadata moves through pending, active, failure, closure, and
closed states. API responses compose metadata with Ledger balances. `CLOSED`
accounts are preserved internally for historical integrity but do not block
user deletion, because the user has successfully deleted their active
accounts.

Real banking systems typically evolve this Ledger toward full double-entry
bookkeeping with independently balanced debit and credit accounts.

## Indexes

The migration includes the query-driven indexes required by the system:

- `users(email)` unique: normalized login and duplicate prevention.
- `bank_accounts(accountNumber)` unique: public lookup.
- `bank_accounts(userId,status,createdAt)`: account lists and deletion checks.
- `bank_accounts(status,updatedAt)`: reconciliation scans.
- `ledger_accounts(accountId)` and `(accountNumber)` unique: ownership and
  public-to-internal resolution.
- `ledger_transactions(ledgerAccountId,createdAt,id)`: stable account history.
- `ledger_transactions(transactionId)` unique: detail lookup.
- Ledger-entry foreign-key/history indexes.
- idempotency unique key plus expiry index.
- outbox due-event and lease-recovery indexes, including partial indexes.

PostgreSQL does not automatically index foreign keys, so every introduced
foreign-key lookup has explicit support. These indexes improve reads and
locking but add write amplification and storage cost; no speculative duplicate
indexes are included.

DynamoDB uses:

```text
pk = USER#<userId>
sk = SESSION#<sessionId>
TTL = expiresAtEpoch
```

Strongly consistent `GetItem` supports introspection and `Query(pk)` supports
future per-user revocation. No GSI/LSI or request-path scan is required.

## Local AWS Emulation

Local execution uses DynamoDB Local for auth sessions and LocalStack for SQS.
It does not require AWS credentials, an AWS account, CDK bootstrap, or deployed
AWS resources. Placeholder `test` credentials are scoped to Compose.

```text
Local PostgreSQL        -> Amazon RDS for PostgreSQL
DynamoDB Local          -> Amazon DynamoDB
LocalStack SQS          -> Amazon SQS
Docker Compose services -> ECS Fargate services/tasks
Docker env/secrets      -> Secrets Manager and ECS task configuration
localhost routing       -> AWS WAF and Application Load Balancer
local logs              -> CloudWatch Logs
```

The same application code and container images are deployable to AWS. Local
endpoint overrides and placeholder credentials are omitted in AWS, where ECS
task roles and native AWS service endpoints are used.

## AWS CDK

The offline-synthesizable CDK stack models a two-AZ VPC, public ALB, private
Fargate services, isolated RDS PostgreSQL, DynamoDB TTL, Ledger event and FIFO
command queues with DLQs, Secrets Manager, CloudWatch logs, security groups,
least-privilege task grants, a migration task, and WAF managed/rate rules.

ALB routing is `/health` and `/ready` to API, `/v1/auth/*` to Auth, `/v1/*` to
API, and fixed `404` otherwise. Ledger runtimes are private.

```bash
pnpm infra:test
pnpm infra:synth
```

Those commands require no AWS account. `pnpm infra:diff`,
`pnpm infra:deploy`, `pnpm infra:destroy`, and `cdk bootstrap` are optional AWS
operations and require configured credentials.

AWS deployment uses an explicit stage and a two-phase migration gate:

```bash
DEPLOYMENT_STAGE=preprod ACTIVATE_SERVICES=false pnpm infra:deploy
# Run the emitted migration task using the emitted cluster, private subnet,
# and migration security-group outputs. Wait for exit code 0.
DEPLOYMENT_STAGE=preprod ACTIVATE_SERVICES=true pnpm infra:deploy
```

`prod` additionally requires `ALB_CERTIFICATE_ARN`; synthesis rejects a
production deployment without TLS. Stage configuration controls capacity,
WAF rate limits, RDS protection and backups, log retention, and removal
policy.

## Development And Tests

Host development requires Node.js 24+, pnpm 10.12.1, and PostgreSQL:

```bash
corepack enable
pnpm install
pnpm db:generate
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm infra:test
pnpm infra:synth
```

Unit tests are colocated with executable source. Integration tests use the
separate `postgres-test` service and must never target the development
database.

```bash
docker compose up -d postgres-test
TEST_DATABASE_URL='postgresql://eagle:eagle@localhost:5433/eagle_bank_test?schema=public' \
DATABASE_URL="$TEST_DATABASE_URL" pnpm db:deploy
TEST_DATABASE_URL='postgresql://eagle:eagle@localhost:5433/eagle_bank_test?schema=public' \
DATABASE_URL="$TEST_DATABASE_URL" pnpm test:integration
```

Other scripts include `api:dev`, `auth:dev`, `ledger:dev`,
`ledger-worker:dev`, `ledger-event-publisher:dev`, `test:coverage`, `lint`,
`format`, `docker:up`, and `docker:down`.

## Example Requests

Copy-pasteable requests for every public endpoint, including variable capture,
idempotent replay, conflict reuse, and insufficient funds, are in
[`examples/requests.http`](examples/requests.http).

The automated reviewer flow is:

```bash
docker compose up --build -d
./scripts/smoke-test.sh
```

It waits for readiness and verifies health, user creation/login, account
creation, deposit, withdrawal, account/transaction reads, account closure, and
user deletion. Expected successful statuses are `200`, `201`, or `204`;
invalid input is `400`, invalid authentication `401`, cross-owner access `403`,
missing resources `404`, idempotency/deletion conflicts `409`, insufficient
funds or balance limit `422`, and unavailable dependencies `503`.

## Trade-offs

- Shared PostgreSQL reduces reviewer setup but weakens physical service
  ownership; AWS production should split stores.
- Account create/delete use explicit lifecycle states and reconciliation-ready
  metadata rather than pretending distributed calls are atomic.
- Async Ledger commands are modeled but disabled to keep the public API
  deterministic for the assessment.
- The outbox provides at-least-once event delivery, so downstream consumers
  must deduplicate by `eventId`.
- Pagination, refresh-token endpoints, administrative session revocation, and
  a continuously scheduled account reconciler are logical next production
  additions.
