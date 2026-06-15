# Eagle Bank

A JavaScript/TypeScript implementation of the Eagle Bank take-home assessment. It
implements every public endpoint in
[`openapi/v1/openapi.yaml`](openapi/v1/openapi.yaml), all
assessment scenarios, JWT authentication backed by revocable sessions,
Ledger-owned money movement, and local execution without an AWS account.

The original-scenario traceability matrix is available in
[`ASSESSMENT_COMPLIANCE.md`](ASSESSMENT_COMPLIANCE.md).

The complete implementation specification is available in
[`specification_v1.md`](specification_v1.md).

Differences and ambiguities between the assessment scenarios and the supplied
OpenAPI document are recorded in
[`Contract conflicts.md`](Contract%20conflicts.md). It explains each conflict,
the chosen resolution, and which contract the implementation follows.

## Test Locally With Docker

Prerequisites: Docker and Docker Compose only.

No AWS account or AWS credentials are required for local execution. Docker
Compose uses [LocalStack](https://docs.localstack.cloud/) to emulate Amazon SQS
and DynamoDB Local to emulate Amazon DynamoDB. AWS deployments use the real
CDK-managed SQS and DynamoDB services instead of these local endpoints.

After checking out the repository, open a terminal in the repository root and
run the following steps in order. Do not run `npm install` for this workflow.

### 1. Start the application

Build and start the complete local stack:

```bash
docker compose up --build -d --wait
```

When the command returns successfully, the application is ready at
`http://localhost:3000`.

### 2. Run the automated tests

Run linting, formatting checks, unit tests, integration tests, and
infrastructure tests inside Docker:

```bash
docker compose run --build --rm test-suite
```

This command uses the isolated `integration-test-db`. It does not modify the
application database and requires no host installation of Node.js or npm.

### 3. Run the API smoke test

With the application stack still running:

```bash
./scripts/smoke-test.sh
```

The smoke test exercises every public endpoint plus the assessment's required
authentication, validation, ownership, missing-resource, deletion-conflict,
idempotency, and insufficient-funds responses.

### 4. View logs when needed

Run this in another terminal to follow application logs:

```bash
docker compose logs --follow api auth-service ledger-service
```

Pressing `Ctrl+C` stops only the log stream. The application continues running
in Docker.

### 5. Stop the application

After testing, stop all services:

```bash
docker compose down
```

To remove all local database state as well:

```bash
docker compose down -v
```

Compose waits for PostgreSQL, LocalStack, and DynamoDB Local, applies only
unapplied Prisma migrations, creates the DynamoDB table and SQS queues
idempotently, then starts the application services.

The manual API walkthrough in [Example Requests](#example-requests) additionally
requires host `curl` and `jq`.

## Test Locally With Node.js

Use this alternative when Node.js 24 and npm are already installed. npm is
included with Node.js. Confirm the installed versions:

```bash
node --version
npm --version
```

The Node.js version must start with `v24`, and the npm version must be `11` or
newer. The required versions are also declared in `package.json`. From the
repository root, install the locked dependencies and run every automated check:

```bash
npm ci
npm run verify
```

`npm ci` runs `prisma generate` automatically. Run `npm run db:generate`
again after changing `prisma/schema.prisma`.

`npm run verify` runs linting, TypeScript checks, formatting checks, unit tests,
integration tests, and infrastructure tests. Docker must be running because
the integration tests start an isolated PostgreSQL container automatically.

Individual checks are also available:

```bash
npm run lint
npm run format
npm run test:unit
npm run test:integration
npm run infra:test
npm run infra:synth
```

The generated Prisma client is written to `src/generated/prisma` and excluded
from source control.

## Continuous Integration

The [GitHub Actions CI workflow](.github/workflows/ci.yml) runs for every pull
request and every push to `main`. It executes the same Docker-based test suite
documented above, including linting, TypeScript checks, formatting checks, unit
tests with coverage, integration tests, and infrastructure tests.

To prevent unverified changes from being merged, configure the repository's
`main` branch protection rules to require the `Verify` status check.

## Example Requests

This section is a manual, sequential API walkthrough. Use the three-terminal
setup from [Test Locally With Docker](#test-locally-with-docker).

**Terminal 1 - start the stack**

```bash
docker compose up --build -d --wait
```

**Terminal 2 - watch logs while sending requests**

```bash
docker compose logs --follow api auth-service ledger-service
```

**Terminal 3 - run the requests**

From the repository root, ensure `curl` and `jq` are installed, and run every
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

Reusing that key with a different request is rejected with HTTP `409` and
`Idempotency key was reused for a different transaction`:

```bash
curl --silent --show-error \
  --request POST \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  --header "Idempotency-Key: $DEPOSIT_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "amount": 101.00,
    "currency": "GBP",
    "type": "deposit",
    "reference": "Conflicting replay"
  }' \
  --write-out '\nHTTP %{http_code}\n' \
  "$BASE_URL/v1/accounts/$ACCOUNT_NUMBER/transactions"
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
  "$BASE_URL/v1/users/usr-999999"

show_response PATCH \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"name":"Missing user"}' \
  "$BASE_URL/v1/users/usr-999999"

show_response DELETE \
  --header "Authorization: Bearer $ACCESS_TOKEN" \
  "$BASE_URL/v1/users/usr-999999"
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
  "$BASE_URL/v1/accounts/$ACCOUNT_NUMBER/transactions/tan-999999"

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

The successful core flow and insufficient-funds example are also available in
IDE HTTP-client format at [`examples/requests.http`](examples/requests.http).
The README remains the complete cross-owner and missing-resource walkthrough.

The manual walkthrough is now complete. Stop the local stack when finished:

```bash
docker compose down
```

For an automated verification, start the stack using
[Test Locally With Docker](#test-locally-with-docker) and run
`./scripts/smoke-test.sh`. It runs the complete public endpoint and assessment
error workflow described above.

Expected successful statuses are `200`, `201`, or `204`; invalid input is
`400`, invalid authentication `401`, cross-owner access `403`, missing
resources `404`, idempotency/deletion conflicts `409`, insufficient funds or
balance limit `422`, and unavailable dependencies `503`.

## Architecture

The public system design diagram is available on the
[Eagle Bank Miro board](https://miro.com/app/board/uXjVHGNA2To=/?moveToWidget=3458764675429521615&cot=14).

```text
Client
  |
  v
API :3000 ---- signed 60s JWT ----> Auth service :3001
  |                                  |          |
  |                                  |          +-> Shared application database
  |                                  +------------> Auth session database
  |
  +----------- signed 60s JWT ----> Ledger service :3002
                                      |
                                      +-> Shared application database
                                                |
                                                +-> Ledger + outbox
                                                          |
                                                          v
                                                Ledger Event Publisher
                                                          |
                                                          v
                                                    LocalStack SQS

Ledger Worker -> SQS FIFO command queue (modeled, disabled locally)
```

Runtime services are `api`, `auth-service`, `ledger-service`,
`ledger-worker`, `ledger-event-publisher`, `shared-application-db`,
`integration-test-db`, `auth-session-db`, and `localstack`.

The public API service implements the OpenAPI contract but does not own the
banking Ledger. Deposits, withdrawals, immutable transaction records,
idempotency, and balance mutation are owned by a separate Ledger service.

The Ledger Event Publisher reads committed events from the Ledger outbox table
and publishes them to the Ledger events queue.

`shared-application-db` is PostgreSQL database `eagle_bank`, used by API, Auth,
and Ledger to keep local setup manageable. `integration-test-db` is the
isolated PostgreSQL database `eagle_bank_test`. `auth-session-db` is an
in-memory DynamoDB emulator containing the `eagle-bank-auth-sessions` table. In
AWS it is replaced by the CDK-managed DynamoDB table.

A database-per-service deployment would provide stronger storage isolation but
would require event-driven coordination for cross-service workflows.

## Security

- Passwords use explicitly configured Argon2id (`m=19456`, `t=2`, `p=1`) with
  per-password salts. Unknown-user login performs a dummy Argon2 verification
  to reduce email-enumeration timing differences.
- User JWTs pin `HS256`, `typ=JWT`, issuer, and audience. Internal Auth and
  Ledger tokens are audience-bound and expire after at most 60 seconds. Their
  separate signing secrets are injected from SSM `SecureString` parameters.
- Account and transaction endpoints require a live JWT-backed DynamoDB session
  and enforce resource ownership. Ledger repeats ownership, currency, and
  path/body integrity checks before changing a balance.
- Activated public AWS services require TLS, use a TLS 1.3-capable ALB policy,
  HSTS, defensive response headers, WAF managed protections, and dedicated
  login/registration throttles.
- RDS, DynamoDB, and SQS are encrypted at rest. RDS forces TLS and application
  connections request SSL. The image runs as a non-root user; ECS tasks also
  drop all Linux capabilities.
- Logger redaction covers authorization headers, cookies, passwords, access
  tokens, database URLs, and named application secrets.

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

[`openapi/v1/openapi.yaml`](openapi/v1/openapi.yaml) is the executable
version 1 contract, not documentation-only:

- every matched request is validated before route handling;
- every matched response body and status is validated before sending;
- contract-invalid requests return `400`;
- an implementation response that violates the contract becomes `500`.

The URI version is centralized as `v1` in the application. Contract tests
verify that all public resource paths use `/v1`, protected operations declare
bearer authentication, and every OpenAPI operation is registered by Fastify.
Operational `/health` and `/ready` endpoints are unversioned.

Corrections to the supplied contract include login, bearer security, password
input, health/readiness, `accountNumber` path naming, identifier regexes,
positive transaction amounts, transaction idempotency conflict, and
distributed-service `503` responses. Decisions are recorded in
[`Contract conflicts.md`](Contract%20conflicts.md) so reviewers can distinguish
intentional contract resolutions from implementation deviations.

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

`GET /ready` uses `ReadinessResponse` for both ready and not-ready states
instead of the general error envelope.

## Data And Consistency

Users and transactions use PostgreSQL `BIGINT` identity primary keys. Public
OpenAPI identifiers are derived at the application boundary by rendering the
numeric key in decimal and adding the required prefix:

- user database ID `123` becomes `usr-123`;
- transaction database ID `456` becomes `tan-456`.

The conversion is centralized in small domain-owned formatter/parser functions
rather than repeated in routes or services. No redundant public-ID columns or
indexes are stored.
`BankAccount.userId` is a nullable `BIGINT` foreign key to `User.id`; it becomes
null only when a user is deleted after all their accounts have been closed.

Money is PostgreSQL `DECIMAL(12,2)` and the only currency is GBP. A Ledger
transaction:

1. resolves the account by its unique account number;
2. runs at PostgreSQL serializable isolation and reserves the balance with a
   versioned compare-and-swap update;
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

The current Ledger records each posted transaction and its resulting balance.
Full double-entry bookkeeping with independently balanced debit and credit
accounts is not implemented.

## Indexes

The migration includes the query-driven indexes required by the system:

- `users(email)` unique: normalized login and duplicate prevention.
- user and transaction primary keys: direct detail lookup after decoding the
  prefixed API identifier.
- `bank_accounts(accountNumber)` unique: public lookup.
- `bank_accounts(userId,status,createdAt)`: account lists and deletion checks.
- `bank_accounts(status,updatedAt)`: reconciliation scans.
- `ledger_accounts(accountId)` and `(accountNumber)` unique: ownership and
  public-to-internal resolution.
- `ledger_transactions(accountId,createdAt,id)`: stable account history.
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
Docker env/secrets      -> SSM Parameter Store and ECS secret injection
localhost routing       -> AWS WAF and Application Load Balancer
local logs              -> CloudWatch Logs
```

The same application code and container images are deployable to AWS. Local
endpoint overrides and placeholder credentials are omitted in AWS, where ECS
task roles and native AWS service endpoints are used.

## AWS CDK

The offline-synthesizable CDK stack models a two-AZ VPC, public ALB, private
Fargate services, isolated RDS PostgreSQL, DynamoDB TTL, Ledger event and FIFO
command queues with DLQs, SSM Parameter Store, CloudWatch logs, security groups,
least-privilege task grants, a migration task, and WAF managed/rate rules.

ALB routing is `/health` and `/ready` to API, `/v1/auth/*` to Auth, `/v1/*` to
API, and fixed `404` otherwise. Ledger runtimes are private.

```bash
npm run infra:test
npm run infra:synth
```

Those commands require no AWS account. `npm run infra:diff`,
`npm run infra:deploy`, `npm run infra:destroy`, and `npm exec -- cdk bootstrap` are
optional AWS operations and require configured credentials.

Before the first deployment of a stage, create four `SecureString` parameters.
The stack references existing parameters so secret values do not enter source
control, CDK context, or the generated CloudFormation template:

```text
/eagle-bank-<stage>/secrets/database-password
/eagle-bank-<stage>/secrets/user-jwt
/eagle-bank-<stage>/secrets/auth-service-jwt
/eagle-bank-<stage>/secrets/ledger-service-jwt
```

For example, provision a value without placing it directly in shell history:

```bash
read -s SECRET_VALUE
aws ssm put-parameter \
  --name /eagle-bank-preprod/secrets/database-password \
  --type SecureString \
  --value "$SECRET_VALUE" \
  --overwrite
unset SECRET_VALUE
```

Repeat that command for `user-jwt`, `auth-service-jwt`, and
`ledger-service-jwt`, using different cryptographically random values of at
least 32 characters. Audience-specific keys prevent one compromised service
from authenticating to another service. ECS injects only the parameters needed
by each task; AWS deployments do not use LocalStack endpoints or placeholder
AWS credentials.

Deployment then uses an explicit stage and a two-phase migration gate:

```bash
DEPLOYMENT_STAGE=preprod ACTIVATE_SERVICES=false npm run infra:deploy
# Run the emitted migration task using the emitted cluster, private subnet,
# and migration security-group outputs. Wait for exit code 0.
DEPLOYMENT_STAGE=preprod ACTIVATE_SERVICES=true npm run infra:deploy
```

Both `preprod` and `prod` require `ALB_CERTIFICATE_ARN`; synthesis rejects
either deployable environment without TLS. Stage configuration controls
capacity, WAF rate limits, RDS protection and backups, log retention, and
removal policy.

## Trade-offs

- Shared PostgreSQL reduces reviewer setup but weakens physical service
  ownership. A database-per-service deployment would provide stronger
  isolation.
- Private service HTTP is security-group isolated and signed. Service-to-service
  mTLS and certificate rotation are not implemented.
- JWTs currently use symmetric `HS256` secrets. A larger deployment could use
  asymmetric signing, managed key rotation, and verification through a
  published JWKS so verifiers do not hold signing keys.
- Customer PII currently relies on RDS encryption at rest. Regulatory threat
  models may also require application-level envelope encryption with KMS and
  searchable tokenization for selected fields.
- Account create/delete use explicit lifecycle states and reconciliation
  metadata to represent partial failures across services.
- Async Ledger commands are modeled but disabled so public transaction requests
  complete synchronously.
- The outbox provides at-least-once event delivery, so downstream consumers
  must deduplicate by `eventId`.
- Pagination, refresh-token endpoints, administrative session revocation, and
  a continuously scheduled account reconciler are not implemented.

## System diagram high level description:

Create a simple left-to-right system architecture diagram for Eagle Bank.

Use two boundaries:

PUBLIC

- Client
- AWS WAF
- Application Load Balancer

PRIVATE

- API Service
- Auth Service
- Ledger Service
- Ledger Event Publisher Service
- Ledger Worker Service
- Shared PostgreSQL Database
- DynamoDB Auth Sessions
- SQS Ledger Events Queue
- SQS Ledger Commands Queue

Arrange the main request flow horizontally:

Client
→ AWS WAF
→ Application Load Balancer
→ API Service
→ Ledger Service

Place Auth Service above API Service.

Place the data store used by each service directly below that service:

API Service
↓
Shared PostgreSQL Database
Label: users and account metadata

Auth Service
↓
Shared PostgreSQL Database
Label: credentials

Auth Service
↓
DynamoDB Auth Sessions
Label: authentication sessions

Ledger Service
↓
Shared PostgreSQL Database
Label: balances, transactions and outbox records

Draw service relationships:

Application Load Balancer
→ API Service
Label: public banking API

Application Load Balancer
→ Auth Service
Label: public login API

API Service
→ Auth Service
Label: validate active session

API Service
→ Ledger Service
Label: balances and transactions

Show the event flow as a separate horizontal flow below the main request flow:

Ledger Service
→ Shared PostgreSQL Database
Label: commit transaction and outbox event

Ledger Event Publisher Service
→ Shared PostgreSQL Database
Label: poll unpublished outbox events

Ledger Event Publisher Service
→ SQS Ledger Events Queue
Label: publish Ledger events

The Ledger Event Publisher is a private background service that reads PostgreSQL and publishes to SQS. Do not draw PostgreSQL as calling the service.

Show the optional command flow separately:

SQS Ledger Commands Queue
→ Ledger Worker Service
Label: consume asynchronous commands

Important rules:

- Only WAF and Application Load Balancer are public infrastructure.
- API and Auth are reachable only through the load balancer.
- Ledger Service, Event Publisher Service, Worker Service, databases and queues are private.
- Auth Service is the only service connected to DynamoDB.
- Use one shared PostgreSQL box with labelled API, Auth and Ledger ownership sections.
- Use direct arrows with labels.
- Do not merge services with databases.
- Do not add components or relationships not listed here.
