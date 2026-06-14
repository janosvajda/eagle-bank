import pino from 'pino';
import { ENVIRONMENT_ENABLED_VALUE } from '../common/config/runtime.constants.js';
import { loadLedgerWorkerConfig } from '../config/env.js';

const LEDGER_WORKER_HEARTBEAT_INTERVAL_MS = 60000;
const config = loadLedgerWorkerConfig();
const enabled =
  config.LEDGER_ASYNC_COMMANDS_ENABLED === ENVIRONMENT_ENABLED_VALUE;
const logger = pino({ name: 'ledger-worker' });

if (enabled) {
  logger.error('Asynchronous Ledger commands were enabled but are unsupported');
  throw new Error(
    'Asynchronous Ledger commands are modeled but intentionally not enabled',
  );
}

logger.info(
  { heartbeatIntervalMs: LEDGER_WORKER_HEARTBEAT_INTERVAL_MS },
  'Ledger worker started in idle mode',
);
const interval = setInterval(
  () => logger.info('Ledger worker heartbeat'),
  LEDGER_WORKER_HEARTBEAT_INTERVAL_MS,
);
const stop = (): void => {
  logger.info('Ledger worker shutdown requested');
  clearInterval(interval);
  process.exitCode = 0;
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
