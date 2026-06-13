# Eagle Bank

A production-shaped TypeScript implementation of the Eagle Bank take-home
assessment. It implements every public endpoint in `openapi.yaml`, all
assessment scenarios, strict bearer-session enforcement, Ledger-owned money
movement, and a no-AWS-account local runtime.

## Quick Start

Prerequisites: Docker and Docker Compose only.

Use separate terminals so requests and live service logs are visible at the
same time.

**Terminal 1 - start the application**

From the repository root, start the complete stack and wait for its health
checks to pass:

```bash
docker compose up --build -d --wait
```

When the command returns successfully, the application is ready at
`http://localhost:3000`.

**Terminal 2 - follow live logs**

Keep this command running while testing the application:

```bash
docker compose logs --follow api auth-service ledger-service
```

Pressing `Ctrl+C` stops only the log stream. The application continues running
in Docker.

**Terminal 3 - test the application**

Run the automated end-to-end check:

```bash
./scripts/smoke-test.sh
```

The smoke test runs inside the API container, so it requires no host Node.js,
pnpm, `curl`, or `jq` installation. The manual requests in
[Example Requests](#example-requests) are also run from Terminal 3.

**Terminal 1 - stop the application**

After testing, stop all services:

```bash
docker compose down
```

To remove all local database state as well:

```bash
docker compose down -v
```

Compose waits for PostgreSQL and the local AWS emulators, applies only
unapplied Prisma migrations, creates the DynamoDB table and SQS queues
idempotently, then starts the application services.

## Development And Tests

Host development requires Node.js 24+ and pnpm 10.12.1. Install dependencies
and generate the Prisma client once:

```bash
corepack enable
pnpm install
pnpm db:generate
```

Run static checks, colocated unit tests, and offline infrastructure tests:

```bash
pnpm typecheck
pnpm test:unit
pnpm infra:test
pnpm infra:synth
```

Unit tests are colocated with executable source. Integration tests use the
separate `postgres-test` service and must never target the development
database. Start that database, apply migrations to it, and then run the
integration suite:

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

This section is a manual, sequential API walkthrough. Use the three-terminal
setup from [Quick Start](#quick-start).

**Terminal 1 - start the stack**

```bash
docker compose up --build -d --wait
```

**Terminal 2 - watch logs while sending requests**

```bash
docker compose logs --follow api auth-service ledger-service
```

**Terminal 3 - run the requests**

Open the repository root, ensure `curl` and `jq` are installed, and run every
code block below in order in this same shell.

Later commands use shell variables created by earlier commands, including
`ACCESS_TOKEN`, `USER_ID`, and `ACCOUNT_NUMBER`. Closing the terminal, opening
a new shell, or skipping a setup block loses those values.

First confirm that the stack is running and ready:

```bash
docker compose ps
curl --fail --silent --show-error http://localhost:3000/ready | jq
```

All required services should be running, and the readiness response should
contain `"status": "ready"`.

Initialize the shell variables used throughout the walkthrough:

```bash
BASE_URL="http://localhost:3000"
EMAIL="reviewer-$(date +%s)@example.com"
PASSWORD="ReviewPassword123!"
```

Routes under `/internal/auth/*` and `/internal/ledger/*` are intentionally not
client examples. They require short-lived service JWTs and are available only
for authenticated communication between application services.

### Health check

```bash
curl --fail-with-body --silent --show-error \
  "$BASE_URL/health" | jq
```

### Create a user

```bash
CREATE_USER_RESPONSE=$(
  curl --fail-with-body --silent --show-error \
    --request POST \
    --header "Content-Type: application/json" \
    --data "{
      \"name\": \"Review User\",
      \"address\": {
        \"line1\": \"1 Eagle Street\",
        \"town\": \"London\",
        \"county\": \"Greater London\",
        \"postcode\": \"SW1A 1AA\"
      },
      \"phoneNumber\": \"+447700900123\",
      \"email\": \"$EMAIL\",
      \"password\": \"$PASSWORD\"
    }" \
    "$BASE_URL/v1/users"
)

echo "$CREATE_USER_RESPONSE" | jq
USER_ID=$(echo "$CREATE_USER_RESPONSE" | jq --raw-output '.id')
```

### Log in

```bash
LOGIN_RESPONSE=$(
  curl --fail-with-body --silent --show-error \
    --request POST \
    --header "Content-Type: application/json" \
    --data "{
      \"email\": \"$EMAIL\",
      \"password\": \"$PASSWORD\"
    }" \
    "$BASE_URL/v1/auth/login"
)

echo "$LOGIN_RESPONSE" | jq
ACCESS_TOKEN=$(echo "$LOGIN_RESPONSE" | jq --raw-output '.accessToken')
```

### Fetch and update the user

```bash
curl --fail-with-body --silent --show-error \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  "$BASE_URL/v1/users/$USER_ID" | jq

curl --fail-with-body --silent --show-error \
  --request PATCH \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{
    "name": "Updated Review User",
    "phoneNumber": "+447700900124"
  }' \
  "$BASE_URL/v1/users/$USER_ID" | jq
```

### Create and list accounts

```bash
CREATE_ACCOUNT_RESPONSE=$(
  curl --fail-with-body --silent --show-error \
    --request POST \
    --header "Authorization: Bearer $ACCESS_TOKEN" \
    --header "Content-Type: application/json" \
    --data '{
      "name": "Everyday Account",
      "accountType": "personal"
    }' \
    "$BASE_URL/v1/accounts"
)

echo "$CREATE_ACCOUNT_RESPONSE" | jq
ACCOUNT_NUMBER=$(
  echo "$CREATE_ACCOUNT_RESPONSE" | jq --raw-output '.accountNumber'
)

curl --fail-with-body --silent --show-error \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  "$BASE_URL/v1/accounts" | jq
```

### Fetch and update the account

```bash
curl --fail-with-body --silent --show-error \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  "$BASE_URL/v1/accounts/$ACCOUNT_NUMBER" | jq

curl --fail-with-body --silent --show-error \
  --request PATCH \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{
    "name": "Updated Everyday Account"
  }' \
  "$BASE_URL/v1/accounts/$ACCOUNT_NUMBER" | jq
```

### Deposit money

Use a unique idempotency key for each financial command. Repeating the same
request with the same key returns the original result without applying the
deposit twice.

```bash
DEPOSIT_KEY="reviewer-deposit-$(date +%s)"

DEPOSIT_RESPONSE=$(
  curl --fail-with-body --silent --show-error \
    --request POST \
    --header "Authorization: Bearer $ACCESS_TOKEN" \
    --header "Idempotency-Key: $DEPOSIT_KEY" \
    --header "Content-Type: application/json" \
    --data '{
      "amount": 100.00,
      "currency": "GBP",
      "type": "deposit",
      "reference": "Initial funding"
    }' \
    "$BASE_URL/v1/accounts/$ACCOUNT_NUMBER/transactions"
)

echo "$DEPOSIT_RESPONSE" | jq
TRANSACTION_ID=$(echo "$DEPOSIT_RESPONSE" | jq --raw-output '.id')
```

Idempotent replay:

```bash
curl --fail-with-body --silent --show-error \
  --request POST \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  --header "Idempotency-Key: $DEPOSIT_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "amount": 100.00,
    "currency": "GBP",
    "type": "deposit",
    "reference": "Initial funding"
  }' \
  "$BASE_URL/v1/accounts/$ACCOUNT_NUMBER/transactions" | jq
```

### Withdraw money

```bash
curl --fail-with-body --silent --show-error \
  --request POST \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  --header "Idempotency-Key: reviewer-withdrawal-$(date +%s)" \
  --header "Content-Type: application/json" \
  --data '{
    "amount": 25.00,
    "currency": "GBP",
    "type": "withdrawal",
    "reference": "Cash withdrawal"
  }' \
  "$BASE_URL/v1/accounts/$ACCOUNT_NUMBER/transactions" | jq
```

### List and fetch transactions

```bash
curl --fail-with-body --silent --show-error \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  "$BASE_URL/v1/accounts/$ACCOUNT_NUMBER/transactions" | jq

curl --fail-with-body --silent --show-error \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  "$BASE_URL/v1/accounts/$ACCOUNT_NUMBER/transactions/$TRANSACTION_ID" | jq
```

### Required failure scenarios

These requests cover the failure cases required by the original assessment.
The helper prints the response body followed by its HTTP status. Expected
`4xx` responses are not treated as shell failures.

```bash
show_response() {
  local method="$1"
  shift

  curl --silent --show-error \
    --request "$method" \
    --write-out '\nHTTP %{http_code}\n' \
    "$@"
}
```

#### Authentication errors: HTTP 401

Missing or invalid bearer credentials return
`Access token is missing or invalid`.

```bash
show_response GET \
  "$BASE_URL/v1/accounts"

show_response GET \
  --header "Authorization: Bearer invalid-token" \
  "$BASE_URL/v1/accounts"

show_response POST \
  --header "Content-Type: application/json" \
  --data "{
    \"email\": \"$EMAIL\",
    \"password\": \"incorrect-password\"
  }" \
  "$BASE_URL/v1/auth/login"
```

The login request returns HTTP `401` with `Invalid email or password`.

#### Invalid request data: HTTP 400

The API returns `Invalid details supplied` and a validation `details` array
when required request data is missing.

```bash
show_response POST \
  --header "Content-Type: application/json" \
  --data '{}' \
  "$BASE_URL/v1/users"

show_response POST \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{}' \
  "$BASE_URL/v1/accounts"

show_response POST \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  --header "Idempotency-Key: invalid-transaction-$(date +%s)" \
  --header "Content-Type: application/json" \
  --data '{
    "currency": "GBP",
    "type": "deposit"
  }' \
  "$BASE_URL/v1/accounts/$ACCOUNT_NUMBER/transactions"
```

#### Prepare cross-owner and account-relationship checks

Create another user and account, plus a second account belonging to the first
user. These resources let the following examples distinguish forbidden access
from a resource that does not exist under an otherwise authorized account.

```bash
OTHER_EMAIL="other-reviewer-$(date +%s)@example.com"

OTHER_USER_RESPONSE=$(
  curl --fail-with-body --silent --show-error \
    --request POST \
    --header "Content-Type: application/json" \
    --data "{
      \"name\": \"Other Review User\",
      \"address\": {
        \"line1\": \"2 Eagle Street\",
        \"town\": \"London\",
        \"county\": \"Greater London\",
        \"postcode\": \"SW1A 1AA\"
      },
      \"phoneNumber\": \"+447700900125\",
      \"email\": \"$OTHER_EMAIL\",
      \"password\": \"$PASSWORD\"
    }" \
    "$BASE_URL/v1/users"
)
OTHER_USER_ID=$(echo "$OTHER_USER_RESPONSE" | jq --raw-output '.id')

OTHER_LOGIN_RESPONSE=$(
  curl --fail-with-body --silent --show-error \
    --request POST \
    --header "Content-Type: application/json" \
    --data "{
      \"email\": \"$OTHER_EMAIL\",
      \"password\": \"$PASSWORD\"
    }" \
    "$BASE_URL/v1/auth/login"
)
OTHER_ACCESS_TOKEN=$(
  echo "$OTHER_LOGIN_RESPONSE" | jq --raw-output '.accessToken'
)

OTHER_ACCOUNT_RESPONSE=$(
  curl --fail-with-body --silent --show-error \
    --request POST \
    --header "Authorization: Bearer $OTHER_ACCESS_TOKEN" \
    --header "Content-Type: application/json" \
    --data '{
      "name": "Other User Account",
      "accountType": "personal"
    }' \
    "$BASE_URL/v1/accounts"
)
OTHER_ACCOUNT_NUMBER=$(
  echo "$OTHER_ACCOUNT_RESPONSE" | jq --raw-output '.accountNumber'
)

SECOND_ACCOUNT_RESPONSE=$(
  curl --fail-with-body --silent --show-error \
    --request POST \
    --header "Authorization: Bearer $ACCESS_TOKEN" \
    --header "Content-Type: application/json" \
    --data '{
      "name": "Second Review Account",
      "accountType": "personal"
    }' \
    "$BASE_URL/v1/accounts"
)
SECOND_ACCOUNT_NUMBER=$(
  echo "$SECOND_ACCOUNT_RESPONSE" | jq --raw-output '.accountNumber'
)
```

#### User authorization and lookup errors: HTTP 403 and 404

Reading, updating, or deleting another user returns HTTP `403` with
`You are not allowed to access this user`.

```bash
show_response GET \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  "$BASE_URL/v1/users/$OTHER_USER_ID"

show_response PATCH \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"name":"Forbidden update"}' \
  "$BASE_URL/v1/users/$OTHER_USER_ID"

show_response DELETE \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  "$BASE_URL/v1/users/$OTHER_USER_ID"
```

A syntactically valid but unknown user ID returns HTTP `404` with
`User was not found`.

```bash
show_response GET \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  "$BASE_URL/v1/users/usr-missing"

show_response PATCH \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"name":"Missing user"}' \
  "$BASE_URL/v1/users/usr-missing"

show_response DELETE \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  "$BASE_URL/v1/users/usr-missing"
```

#### User deletion conflict: HTTP 409

Deleting the authenticated user while they still own an account returns
`A user cannot be deleted while associated with a bank account`.

```bash
show_response DELETE \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  "$BASE_URL/v1/users/$USER_ID"
```

#### Account authorization and lookup errors: HTTP 403 and 404

Reading, updating, or deleting another user's account returns HTTP `403` with
`You are not allowed to access this bank account`.

```bash
show_response GET \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  "$BASE_URL/v1/accounts/$OTHER_ACCOUNT_NUMBER"

show_response PATCH \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"name":"Forbidden update"}' \
  "$BASE_URL/v1/accounts/$OTHER_ACCOUNT_NUMBER"

show_response DELETE \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  "$BASE_URL/v1/accounts/$OTHER_ACCOUNT_NUMBER"
```

An unknown account number returns HTTP `404` with
`Bank account was not found`.

```bash
show_response GET \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  "$BASE_URL/v1/accounts/01999999"

show_response PATCH \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"name":"Missing account"}' \
  "$BASE_URL/v1/accounts/01999999"

show_response DELETE \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  "$BASE_URL/v1/accounts/01999999"
```

#### Transaction errors: HTTP 403, 404, and 422

A withdrawal larger than the available balance returns HTTP `422` with
`Insufficient funds to process transaction`.

```bash
show_response POST \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  --header "Idempotency-Key: insufficient-funds-$(date +%s)" \
  --header "Content-Type: application/json" \
  --data '{
    "amount": 9999.00,
    "currency": "GBP",
    "type": "withdrawal",
    "reference": "Expected insufficient funds"
  }' \
  "$BASE_URL/v1/accounts/$ACCOUNT_NUMBER/transactions"
```

Creating or listing transactions against another user's account returns HTTP
`403`. Performing the same operations against an unknown account returns HTTP
`404`.

```bash
show_response POST \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  --header "Idempotency-Key: forbidden-account-$(date +%s)" \
  --header "Content-Type: application/json" \
  --data '{
    "amount": 10.00,
    "currency": "GBP",
    "type": "deposit"
  }' \
  "$BASE_URL/v1/accounts/$OTHER_ACCOUNT_NUMBER/transactions"

show_response POST \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  --header "Idempotency-Key: missing-account-$(date +%s)" \
  --header "Content-Type: application/json" \
  --data '{
    "amount": 10.00,
    "currency": "GBP",
    "type": "deposit"
  }' \
  "$BASE_URL/v1/accounts/01999999/transactions"

show_response GET \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  "$BASE_URL/v1/accounts/$OTHER_ACCOUNT_NUMBER/transactions"

show_response GET \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  "$BASE_URL/v1/accounts/01999999/transactions"
```

Fetching a transaction through another user's account returns HTTP `403`.
Unknown accounts, unknown transactions, and transactions requested through
the wrong account return HTTP `404`. The last request uses a real transaction
ID with a different account owned by the same user, so it specifically tests
the account-to-transaction relationship.

```bash
show_response GET \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  "$BASE_URL/v1/accounts/$OTHER_ACCOUNT_NUMBER/transactions/$TRANSACTION_ID"

show_response GET \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  "$BASE_URL/v1/accounts/01999999/transactions/$TRANSACTION_ID"

show_response GET \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  "$BASE_URL/v1/accounts/$ACCOUNT_NUMBER/transactions/tan-missing"

show_response GET \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  "$BASE_URL/v1/accounts/$SECOND_ACCOUNT_NUMBER/transactions/$TRANSACTION_ID"
```

### Delete the accounts and users

Each account must be closed before its owner can be deleted. Successful delete
operations return HTTP `204` with no response body. The primary account has
transactions, but the Ledger service preserves those records while closing
the account.

```bash
curl --fail-with-body --silent --show-error \
  --request DELETE \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  --write-out "delete primary account: HTTP %{http_code}\n" \
  --output /dev/null \
  "$BASE_URL/v1/accounts/$ACCOUNT_NUMBER"

curl --fail-with-body --silent --show-error \
  --request DELETE \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  --write-out "delete second account: HTTP %{http_code}\n" \
  --output /dev/null \
  "$BASE_URL/v1/accounts/$SECOND_ACCOUNT_NUMBER"

curl --fail-with-body --silent --show-error \
  --request DELETE \
  --header "Authorization: Bearer $OTHER_ACCESS_TOKEN" \
  --write-out "delete other account: HTTP %{http_code}\n" \
  --output /dev/null \
  "$BASE_URL/v1/accounts/$OTHER_ACCOUNT_NUMBER"

curl --fail-with-body --silent --show-error \
  --request DELETE \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  --write-out "delete primary user: HTTP %{http_code}\n" \
  --output /dev/null \
  "$BASE_URL/v1/users/$USER_ID"

curl --fail-with-body --silent --show-error \
  --request DELETE \
  --header "Authorization: Bearer $OTHER_ACCESS_TOKEN" \
  --write-out "delete other user: HTTP %{http_code}\n" \
  --output /dev/null \
  "$BASE_URL/v1/users/$OTHER_USER_ID"
```

The same endpoint collection is available in IDE HTTP-client format at
[`examples/requests.http`](examples/requests.http).

The manual walkthrough is now complete. Stop the local stack when finished:

```bash
docker compose down
```

For a shorter automated verification, start the stack using
[Quick Start](#quick-start) and run `./scripts/smoke-test.sh`. It verifies
health, user creation/login, account creation, deposit, withdrawal,
account/transaction reads, account closure, and user deletion.

Expected successful statuses are `200`, `201`, or `204`; invalid input is
`400`, invalid authentication `401`, cross-owner access `403`, missing
resources `404`, idempotency/deletion conflicts `409`, insufficient funds or
balance limit `422`, and unavailable dependencies `503`.

## Architecture

The public system design diagram is available on the
[Eagle Bank Miro board](https://miro.com/app/board/uXjVHGNA2To=/?share_link_id=415580388985).

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

- API: OpenAPI facade, profiles, account metadata, ownership checks, response
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
