import { loadEnvFromRepo } from '@orderflow/core';
loadEnvFromRepo();

import { Keeper } from './keeper';
import { StrategyStore } from './store';

const keeper = new Keeper();
keeper.start();

// Keep process alive; handle graceful shutdown.
let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[keeper] received ${signal}, shutting down`);
  keeper.stop();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export { keeper, StrategyStore };
