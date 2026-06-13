export class LedgerConcurrencyError extends Error {
  constructor() {
    super('Ledger account changed during transaction processing');
    this.name = 'LedgerConcurrencyError';
  }
}
