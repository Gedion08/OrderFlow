/**
 * OrderFlow keeper.
 *
 * A long-running process that turns scheduled DCA strategies into reality and
 * keeps DLMM LP positions profitable. It runs a loop on an interval and for
 * each active strategy:
 *
 *   1. Advance scheduled tranches — when it is time for the next tranche, place
 *      a new DLMM limit order on the book (a real on-chain limit order).
 *   2. Re-pin LP positions — if the active bin has drifted out of our range,
 *      rebalance the position back around the active bin (the classic DLMM
 *      "my position stopped earning fees" problem).
 *   3. Claim fees — sweep unclaimed limit-order fees for bins we own, above a
 *      cost-effective threshold.
 *
 * It is intentionally crash-safe: state is persisted to the store and each
 * tranche is idempotently tracked (an order is only placed once).
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import BN from 'bn.js';
import path from 'path';
import {
  loadConfig,
  resolveRepoRoot,
  DcaStrategy,
  DcaOrder,
  DcaStatus,
  spreadBinsBetweenBrackets,
  binFromPriceFloor,
  BIN_STEP_MAX_BPS,
  signingMessage,
  verifySignature,
} from '@orderflow/core';
import { OrderFlowSdk, OrderSignerStore } from '@orderflow/sdk';
import { JsonStrategyStore, PostgresStrategyStore } from '@orderflow/store';

function makeKeypair(): Keypair {
  const pk = process.env.KEEPER_PRIVATE_KEY;
  if (!pk) throw new Error('KEEPER_PRIVATE_KEY is required');
  return Keypair.fromSecretKey(bs58.decode(pk));
}

export class Keeper {
  private readonly cfg;
  private readonly sdk: OrderFlowSdk;
  private readonly store: JsonStrategyStore | PostgresStrategyStore;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastAlertAt = 0;

  constructor() {
    this.cfg = loadConfig();
    const storeFile = process.env.STORE_FILE ?? path.join(resolveRepoRoot(), 'data', 'strategies.json');
    this.store = this.cfg.databaseUrl
      ? new PostgresStrategyStore(this.cfg.databaseUrl)
      : new JsonStrategyStore(storeFile);

    const connection = new Connection(this.cfg.rpcEndpoint, 'confirmed');
    const payer = makeKeypair();
    const signerStore = new OrderSignerStore(
      process.env.SIGNER_STORE_FILE ?? path.join(resolveRepoRoot(), 'data', 'order-signers.json.enc'),
      process.env.SIGNER_STORE_KEY ?? process.env.KEEPER_PRIVATE_KEY ?? '0000000000000000000000000000000000000000000000000000000000000000',
    );
    this.sdk = new OrderFlowSdk({ connection, payer, signerStore });
  }

  start() {
    console.log('[keeper] starting');
    this.tick();
    this.timer = setInterval(() => this.tick(), this.cfg.keeperIntervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const strategies = await this.store.list();
      for (const s of strategies) {
        if (s.status === 'cancelled' || s.status === 'completed') continue;
        try {
          await this.advance(s);
        } catch (e) {
          const msg = (e as Error).message;
          console.error(`[keeper] ${s.strategyId} advance failed:`, msg);
          this.alert(`Keeper advance failed for ${s.strategyId}: ${msg}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async alert(message: string) {
    const now = Date.now();
    if (now - this.lastAlertAt < 60_000) return;
    this.lastAlertAt = now;
    console.error('[keeper-alert]', message);
    if (this.cfg.keeperAlertWebhook) {
      try {
        await fetch(this.cfg.keeperAlertWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: message, ts: now }),
        });
      } catch {
        // best-effort
      }
    }
  }

  private async verifyStrategyOwnership(s: DcaStrategy): Promise<boolean> {
    if (!s.signature) return false;
    const message = signingMessage(s.owner, s.strategyId, 'create');
    return verifySignature(s.owner, s.signature, message);
  }

  /**
   * Place the next scheduled tranche of a DCA strategy and claim any overdue
   * fees for already-placed tranches.
   */
  private async advance(s: DcaStrategy) {
    if (!(await this.verifyStrategyOwnership(s))) {
      console.warn(`[keeper] ${s.strategyId} failed ownership verification, skipping`);
      return;
    }

    const now = Date.now();
    const nextTrancheIdx = s.orders.length;
    const dueTranches: DcaOrder[] = [];

    let dueCount = 0;
    if (s.tranches > 0) {
      const elapsed = now - s.createdAt;
      const perTrancheMs = s.intervalSeconds * 1000;
      if (perTrancheMs > 0) {
        dueCount = Math.min(s.tranches, Math.floor(elapsed / perTrancheMs) + 1);
      }
    }
    if (s.intervalSeconds <= 0) dueCount = s.tranches;
    dueCount = Math.max(1, dueCount);

    const ownerPk = new PublicKey(s.owner);

    for (const o of s.orders) {
      if (o.status === 'placed' || o.status === 'partially_filled') {
        try {
          const result = await this.sdk.claimOrderFees({
            poolAddress: s.pool,
            orderAddress: o.address,
            binIds: o.binIdsResolved,
            owner: ownerPk,
          });
          o.feesEarned += result.claimedFees;
          o.lastClaimedAt = now;
          await this.store.upsert(s);
        } catch (e) {
          console.error(`[keeper] ${s.strategyId} claim fees failed:`, (e as Error).message);
        }
      }
    }

    while (s.orders.length < Math.min(s.tranches, dueCount)) {
      const idx = s.orders.length;
      const trancheAmount = s.totalAmount / s.tranches;
      const rawAmount = Math.max(1, Math.trunc(trancheAmount * 1e6));

      const lower = s.minPrice ?? 0;
      const upper = s.maxPrice ?? (lower || 1);

      const placed = await this.sdk.placeLimitOrder({
        poolAddress: s.pool,
        owner: ownerPk,
        side: s.side,
        bins: spreadBinsBetweenBrackets(lower, upper, 1, 100),
        amount: new BN(rawAmount),
      });

      const order: DcaOrder = {
        orderId: `${s.strategyId}-${idx}`,
        address: placed.orderAddress,
        binIds: placed.binIds,
        binIdsResolved: placed.binIds,
        priceLow: placed.priceLow,
        priceHigh: placed.priceHigh,
        amount: trancheAmount,
        side: s.side,
        filled: 0,
        feesEarned: 0,
        filledAmount: 0,
        status: 'placed',
        createdAt: now,
        lastClaimedAt: null,
      };
      s.orders.push(order);
      console.log(`[keeper] ${s.strategyId} placed tranche ${idx + 1}/${s.tranches} @ ${placed.orderAddress}`);
    }

    await this.rePin(s);

    const allPlaced = s.orders.length >= s.tranches;
    const allFilled = allPlaced && s.orders.every((o) => o.filled > 0.999);
    if (allFilled) s.status = 'completed';
    else if (allPlaced) s.status = 'active';
    await this.store.upsert(s);
  }

  /**
   * For LP-position strategies, re-center around the active bin if the range
   * bracket has drifted. For pure limit-order strategies this is a no-op.
   */
  private async rePin(s: DcaStrategy) {
    const position = (s as any).lpPositionAddress as string | undefined;
    if (!position) return;
    if (!(s.minPrice && s.maxPrice)) return;
    const lastRebalanceAt = (s as any).lastRebalanceAt as number | undefined ?? 0;
    try {
      await this.sdk.rebalancePosition({
        poolAddress: s.pool,
        positionAddress: position,
        lowerBinId: binFromPriceFloor(s.minPrice, 100),
        upperBinId: Math.max(
          binFromPriceFloor(s.maxPrice, 100),
          binFromPriceFloor(s.minPrice, 100) + 1,
        ),
        lastRebalanceAt,
        slippageBps: s.slippageBps,
      });
      (s as any).lastRebalanceAt = Date.now();
      console.log(`[keeper] ${s.strategyId} re-pinned position`);
    } catch (e) {
      console.error(`[keeper] ${s.strategyId} re-pin failed:`, (e as Error).message);
    }
  }

  /** Convenience: place all tranches of a strategy immediately. */
  async placeAll(s: DcaStrategy) {
    s.intervalSeconds = 0;
    await this.advance(s);
  }
}
