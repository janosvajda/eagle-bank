# Assessment Compliance

This matrix traces the scenarios in
[`take-home-test-text-from-pdf.txt`](take-home-test-text-from-pdf.txt) to the
implemented API and integration tests.

The assessment text names public account route parameters `{accountId}` while
the supplied OpenAPI contract defines `{accountNumber}`. The implementation
uses the OpenAPI route form. This resolution is recorded in
[`Contract conflicts.md`](Contract%20conflicts.md).

## Authentication

| Assessment requirement                            | Implementation                                             | Verification                                                                    |
| ------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Authenticate a user and return a JWT bearer token | `POST /v1/auth/login`                                      | `tests/integration/auth.test.ts`                                                |
| Reject invalid or missing credentials             | Protected routes return `401`; invalid login returns `401` | `tests/integration/auth.test.ts`, `tests/integration/assessment-errors.test.ts` |

## Users

| Assessment scenarios                                                                   | Public behavior                                                   | Verification                      |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------- |
| Create user; reject missing required data                                              | `POST /v1/users` returns `201` or `400`                           | `tests/integration/users.test.ts` |
| Fetch own user; reject another or missing user                                         | `GET /v1/users/{userId}` returns `200`, `403`, or `404`           | `tests/integration/users.test.ts` |
| Update own user; reject another or missing user                                        | `PATCH /v1/users/{userId}` returns `200`, `403`, or `404`         | `tests/integration/users.test.ts` |
| Delete own user without accounts; reject active account, another user, or missing user | `DELETE /v1/users/{userId}` returns `204`, `409`, `403`, or `404` | `tests/integration/users.test.ts` |

## Bank Accounts

| Assessment scenarios                                    | Public behavior                                                      | Verification                         |
| ------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------ |
| Create account; reject missing required data            | `POST /v1/accounts` returns `201` or `400`                           | `tests/integration/accounts.test.ts` |
| List authenticated user's accounts                      | `GET /v1/accounts` returns only owned active accounts                | `tests/integration/accounts.test.ts` |
| Fetch owned account; reject another or missing account  | `GET /v1/accounts/{accountNumber}` returns `200`, `403`, or `404`    | `tests/integration/accounts.test.ts` |
| Update owned account; reject another or missing account | `PATCH /v1/accounts/{accountNumber}` returns `200`, `403`, or `404`  | `tests/integration/accounts.test.ts` |
| Delete owned account; reject another or missing account | `DELETE /v1/accounts/{accountNumber}` returns `204`, `403`, or `404` | `tests/integration/accounts.test.ts` |

Account deletion closes the account externally while retaining historical
Ledger records. Closed accounts are excluded from subsequent reads and no
longer block deletion of their owner.

## Transactions

| Assessment scenarios                                                                               | Public behavior                                                                | Verification                             |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------- |
| Deposit and update balance                                                                         | `POST /v1/accounts/{accountNumber}/transactions` returns `201`                 | `tests/integration/transactions.test.ts` |
| Withdraw with sufficient funds and update balance                                                  | Transaction endpoint returns `201`                                             | `tests/integration/transactions.test.ts` |
| Reject insufficient funds                                                                          | Transaction endpoint returns `422` without mutating balance or history         | `tests/integration/transactions.test.ts` |
| Reject another user's or missing account                                                           | Transaction endpoint returns `403` or `404`                                    | `tests/integration/transactions.test.ts` |
| Reject missing transaction data                                                                    | Transaction endpoint returns `400`                                             | `tests/integration/transactions.test.ts` |
| List transactions for owned account; reject another or missing account                             | `GET /v1/accounts/{accountNumber}/transactions` returns `200`, `403`, or `404` | `tests/integration/transactions.test.ts` |
| Fetch transaction from owned account                                                               | `GET /v1/accounts/{accountNumber}/transactions/{transactionId}` returns `200`  | `tests/integration/transactions.test.ts` |
| Reject another user's account, missing account, missing transaction, or wrong account relationship | Fetch endpoint returns `403` or `404`                                          | `tests/integration/transactions.test.ts` |

Transactions are immutable: the public API exposes create, list, and fetch
operations only. It exposes no transaction update or delete route.

## Contract Enforcement

The versioned OpenAPI document is
[`openapi/v1/openapi.yaml`](openapi/v1/openapi.yaml). Runtime middleware
validates matched public requests and responses against that document.

The README walkthrough and `./scripts/smoke-test.sh` exercise every public
assessment endpoint, ownership failure, missing resource, validation failure,
insufficient-funds response, deletion conflict, and idempotency behavior.
