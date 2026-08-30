import { loadConfig, loadEnvFromRepo } from '@orderflow/core';
loadEnvFromRepo();

import { createApp } from './app';
import { createMeteoraClient } from './meteora-client';

const cfg = loadConfig();

createApp()
  .listen(cfg.port, () => {
    console.log(`[orderflow-api] listening on :${cfg.port}`);
    console.log(`[orderflow-api] meteora base: ${createMeteoraClient(cfg) instanceof Object ? cfg.meteoraApiBase : ''}`);
  })
  .on('error', (e) => {
    console.error('[orderflow-api] failed to start', e);
    process.exit(1);
  });
