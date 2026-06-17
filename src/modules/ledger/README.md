# Ledger Module

The ledger module owns account balances, posted transactions, ledger entries,
idempotency records, and the transactional outbox used to publish ledger events.

The public API module does not update balances directly. It calls Ledger through
`LedgerGateway`, either in-process during tests or through `LedgerHttpClient`
when the application is composed as separate services.

## Directory Map

### `domain/`

Shared Ledger vocabulary and types.

- `ledger.contracts.ts` contains Zod schemas and TypeScript command/response
  contracts.
- `ledger.constants.ts` contains Ledger policy constants and event names.
- `ledger.errors.ts` contains Ledger-specific errors and the logged rejection
  helper.
- `ledger.mapper.ts` maps database records to Ledger API responses.

### `application/`

Use-case orchestration.

- `ledger.service.ts` is the Ledger application service. It owns account
  lifecycle, balance reads, transaction lookup/listing, and delegates transaction
  posting.
- `ledger-transaction-poster.ts` coordinates one atomic money movement. It
  controls retry behavior and the write order, but delegates domain rules,
  idempotency, and event payload construction.

### `posting/`

Money-posting domain behavior.

- `ledger-posting-policy.ts` validates whether a transaction can be posted:
  active account, owner, currency, insufficient funds, max balance, and balance
  reservation.
- `ledger-idempotency.ts` owns request hashing, replay, conflict detection, and
  idempotency record create/complete behavior.
- `ledger-outbox-event.ts` builds the `TransactionPosted` outbox event payload.
- `ledger-posting.types.ts` contains internal posting context/state types shared
  by the posting collaborators.

### `persistence/`

Database access.

- `ledger.repository.ts` wraps Prisma access for ledger accounts, transactions,
  entries, and idempotency records.
- `ledger-outbox.repository.ts` wraps Prisma access for outbox claiming,
  publishing, retry, and dead-letter state.

### `events/`

Event publishing infrastructure.

- `ledger-event-publisher.ts` claims committed outbox rows and publishes them
  through a sink. It is storage/provider agnostic.
- `ledger-event-sink.ts` is the SQS adapter for publishing outbox events. SQS
  client construction happens at service startup, outside this module.

### `transport/`

Service-to-service communication.

- `ledger.client.ts` is the HTTP client used by the public API process to call
  the private Ledger service. It implements `LedgerGateway`.

## Transaction Posting Flow

1. `LedgerService.postTransaction` validates the public user id and delegates to
   `LedgerTransactionPoster`.
2. `LedgerIdempotencyHandler` computes the request hash and replays an existing
   completed idempotent response when possible.
3. `LedgerTransactionPoster` opens a serializable transaction through
   `LedgerRepository.runInTransaction`.
4. `LedgerPostingPolicy` loads the account, validates ownership/currency/balance
   rules, computes the next balance, and reserves it using the account version.
5. The poster creates the ledger transaction and ledger entry in the same
   database transaction.
6. The poster stores a `TransactionPosted` outbox event in the same database
   transaction.
7. The idempotency record is completed with the exact response payload.
8. `LedgerEventPublisher` later publishes the committed outbox event to SQS.

The balance update, transaction row, ledger entry, idempotency completion, and
outbox event are committed together. SQS publishing is intentionally outside that
transaction and retried through the outbox.
