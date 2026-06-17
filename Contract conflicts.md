# Contract Conflicts

This document records the differences found between the assessment scenarios and
the supplied OpenAPI specification, together with the agreed resolutions.

## Account route identifier

- Assessment text: account routes use `{accountId}`.
- OpenAPI specification: account routes use `{accountNumber}` with the pattern
  `^01\d{6}$`.
- Resolution: follow the authoritative OpenAPI specification. The public API
  identifies accounts by their eight-digit account number.

## Authentication credentials

- Assessment text: requires JWT authentication.
- OpenAPI specification: the original `CreateUserRequest` did not provide a way
  to establish a password.
- Resolution: add a required `password` field to `CreateUserRequest` and add
  `POST /v1/auth/login` accepting `email` and `password`. Passwords are hashed
  with argon2 and are never returned.

## Transaction identifier pattern

- Original OpenAPI pattern: `^tan-[A-Za-z0-9]$`.
- OpenAPI example: `tan-123abc`.
- Resolution: correct the pattern to `^tan-[A-Za-z0-9]+$`, allowing the example
  and generated transaction identifiers to conform.

## Misused OpenAPI formats

- Original OpenAPI used custom regular expressions in `format` for account
  numbers, user IDs, and phone numbers.
- Resolution: express these constraints with the OpenAPI `pattern` keyword.
  Standard formats such as `email` and `date-time` remain unchanged.

## User email conflicts

- Assessment text: requires appropriate error handling for invalid scenarios, but
  does not explicitly name the response for duplicate user emails.
- OpenAPI specification: the original user create/update operations did not
  document a `409` response for the unique `email` constraint.
- Resolution: keep `email` unique because it is used for login identity, and
  document `409 Conflict` for duplicate emails on user creation and update.
