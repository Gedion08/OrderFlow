/**
 * Seed a demo DCA strategy into the store so the keeper can be observed
 * working end-to-end (once a KEEPER_PRIVATE_KEY + live RPC are configured).
 *
 *   npm run seed -w @orderflow/keeper
 */

import { DcaStrategy, resolveRepoRoot } from '@orderflow/core';
import { JsonStrategyStore } from '@orderflow/store';
import path from 'path';

const store = new JsonStrategyStore(process.env.STORE_FILE ?? path.join(resolveRepoRoot(), 'data', 'strategies.json'));

const demo: DcaStrategy = {
  strategyId: `demo-${Date.now()}`,
  owner: process.env.OWNER_PUBKEY ?? '11111111111111111111111111111111',
  signature: '',
  pool: process.env.POOL_ADDRESS ?? 'REPLACE_WITH_DLMM_POOL_ADDRESS',
  tokenMint: 'REPLACE_WITH_BASE_MINT',
  side: 'bid',
  totalAmount: 1000,
  totalAmountLabel: '1000 USDC',
  tranches: 10,
  intervalSeconds: 3600,
  minPrice: 120,
  maxPrice: 210,
  slippageBps: 100,
  rebalanceFrequencyMs: 3_600_000,
  status: 'scheduled',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  orders: [],
  vaultNonce: null,
  vaultAddress: null,
};

store.upsert(demo);
console.log(`[seed] wrote strategy ${demo.strategyId}`);
console.log('[seed] strategy:', JSON.stringify(demo, null, 2));
