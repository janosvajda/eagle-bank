# Assessment Compliance

This matrix maps the scenarios in `take-home-test-text-from-pdf.txt` to the
executable API contract and integration coverage.

The assessment prose names account path parameters `{accountId}`. The supplied
OpenAPI contract defines the public identifier as `{accountNumber}` matching
`^01\d{6}$`; the implementation follows that contract. This resolution is also
recorded in `Contract conflicts.md`.

| Assessment requirement                | Endpoint                                                        | Expected result            | Integration coverage                     |
| ------------------------------------- | --------------------------------------------------------------- | -------------------------- | ---------------------------------------- |
| Create user                           | `POST /v1/users`                                                | `201`                      | `tests/integration/users.test.ts`        |
| Reject incomplete user                | `POST /v1/users`                                                | `400` and error details    | `tests/integration/users.test.ts`        |
| Authenticate and return JWT           | `POST /v1/auth/login`                                           | `200`, bearer JWT          | `tests/integration/auth.test.ts`         |
| Reject missing or invalid credentials | All protected endpoints                                         | `401` and error message    | `tests/integration/auth.test.ts`         |
| Fetch own user                        | `GET /v1/users/{userId}`                                        | `200`                      | `tests/integration/users.test.ts`        |
| Fetch another user                    | `GET /v1/users/{userId}`                                        | `403`                      | `tests/integration/users.test.ts`        |
| Fetch missing user                    | `GET /v1/users/{userId}`                                        | `404`                      | `tests/integration/users.test.ts`        |
| Update own user                       | `PATCH /v1/users/{userId}`                                      | `200`, updated data        | `tests/integration/users.test.ts`        |
| Update another user                   | `PATCH /v1/users/{userId}`                                      | `403`                      | `tests/integration/users.test.ts`        |
| Update missing user                   | `PATCH /v1/users/{userId}`                                      | `404`                      | `tests/integration/users.test.ts`        |
| Delete user without accounts          | `DELETE /v1/users/{userId}`                                     | `204`                      | `tests/integration/users.test.ts`        |
| Delete user with account              | `DELETE /v1/users/{userId}`                                     | `409`                      | `tests/integration/users.test.ts`        |
| Delete another user                   | `DELETE /v1/users/{userId}`                                     | `403`                      | `tests/integration/users.test.ts`        |
| Delete missing user                   | `DELETE /v1/users/{userId}`                                     | `404`                      | `tests/integration/users.test.ts`        |
| Create account                        | `POST /v1/accounts`                                             | `201`, account data        | `tests/integration/accounts.test.ts`     |
| Reject incomplete account             | `POST /v1/accounts`                                             | `400` and error details    | `tests/integration/accounts.test.ts`     |
| List own accounts                     | `GET /v1/accounts`                                              | `200`, only owned accounts | `tests/integration/accounts.test.ts`     |
| Fetch own account                     | `GET /v1/accounts/{accountNumber}`                              | `200`                      | `tests/integration/accounts.test.ts`     |
| Fetch another account                 | `GET /v1/accounts/{accountNumber}`                              | `403`                      | `tests/integration/accounts.test.ts`     |
| Fetch missing account                 | `GET /v1/accounts/{accountNumber}`                              | `404`                      | `tests/integration/accounts.test.ts`     |
| Update own account                    | `PATCH /v1/accounts/{accountNumber}`                            | `200`, updated data        | `tests/integration/accounts.test.ts`     |
| Update another account                | `PATCH /v1/accounts/{accountNumber}`                            | `403`                      | `tests/integration/accounts.test.ts`     |
| Update missing account                | `PATCH /v1/accounts/{accountNumber}`                            | `404`                      | `tests/integration/accounts.test.ts`     |
| Delete own account                    | `DELETE /v1/accounts/{accountNumber}`                           | `204`                      | `tests/integration/accounts.test.ts`     |
| Delete another account                | `DELETE /v1/accounts/{accountNumber}`                           | `403`                      | `tests/integration/accounts.test.ts`     |
| Delete missing account                | `DELETE /v1/accounts/{accountNumber}`                           | `404`                      | `tests/integration/accounts.test.ts`     |
| Deposit and update balance            | `POST /v1/accounts/{accountNumber}/transactions`                | `201`                      | `tests/integration/transactions.test.ts` |
| Withdraw and update balance           | `POST /v1/accounts/{accountNumber}/transactions`                | `201`                      | `tests/integration/transactions.test.ts` |
| Reject insufficient funds             | `POST /v1/accounts/{accountNumber}/transactions`                | `422`                      | `tests/integration/transactions.test.ts` |
| Reject transaction on another account | `POST /v1/accounts/{accountNumber}/transactions`                | `403`                      | `tests/integration/transactions.test.ts` |
| Reject transaction on missing account | `POST /v1/accounts/{accountNumber}/transactions`                | `404`                      | `tests/integration/transactions.test.ts` |
| Reject incomplete transaction         | `POST /v1/accounts/{accountNumber}/transactions`                | `400` and error details    | `tests/integration/transactions.test.ts` |
| List own-account transactions         | `GET /v1/accounts/{accountNumber}/transactions`                 | `200`                      | `tests/integration/transactions.test.ts` |
| Reject listing another account        | `GET /v1/accounts/{accountNumber}/transactions`                 | `403`                      | `tests/integration/transactions.test.ts` |
| Reject listing missing account        | `GET /v1/accounts/{accountNumber}/transactions`                 | `404`                      | `tests/integration/transactions.test.ts` |
| Fetch matching transaction            | `GET /v1/accounts/{accountNumber}/transactions/{transactionId}` | `200`                      | `tests/integration/transactions.test.ts` |
| Reject fetch through another account  | Same                                                            | `403`                      | `tests/integration/transactions.test.ts` |
| Reject fetch through missing account  | Same                                                            | `404`                      | `tests/integration/transactions.test.ts` |
| Reject missing transaction            | Same                                                            | `404`                      | `tests/integration/transactions.test.ts` |
| Reject transaction/account mismatch   | Same                                                            | `404`                      | `tests/integration/transactions.test.ts` |

Additional contract tests verify that every OpenAPI operation is registered,
all protected operations declare bearer authentication, requests are validated,
and successful and error responses conform to `openapi/v1/openapi.yaml`.
