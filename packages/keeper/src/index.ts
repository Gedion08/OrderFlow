import { loadEnvFromRepo } from '@orderflow/core';
loadEnvFromRepo();

import { Keeper } from './keeper';

const keeper = new Keeper();
keeper.start();

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

export { keeper };
