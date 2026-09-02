/**
 * OrderFlow keeper.
 *
 * A long-running process that turns scheduled DCA strategies into reality.
 *
 * NON-CUSTODIAL MODEL (vault):
 *   Deposited funds live in an on-chain `StrategyVault` PDA owned by the
 *   OrderFlow program — not in any wallet anyone controls. The keeper is no
 *   longer a custodian; it is a permissionless *crank caller* that pays gas
 *   and triggers pre-authorized instructions. It can never exceed the bounds
 *   the owner recorded at creation, and it can never redirect funds anywhere
 *   the vault does not own.
 *
 *   For each active strategy the loop:
 *     1. Ensures an on-chain vault exists (`create_vault` once).
 *     2. Places due tranches via `place_tranche` — the program itself
 *        validates the cadence, price bracket, and total cap.
 *     3. Claims accrued fees via `claim_fees` — funds always return *to the
 *        vault*.
 *
 * The keeper holds a `CRANK_PRIVATE_KEY` (gas/rent payer only). Compromise is
 * confined to spamming harmless instructions; it cannot move user funds.
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import path from 'path';
import {
  loadConfig,
  resolveRepoRoot,
  DcaStrategy,
  DcaOrder,
  spreadBinsBetweenBrackets,
} from '@orderflow/core';
import { VaultSdk, vaultPda, limitOrderPda } from '@orderflow/sdk';
import { JsonStrategyStore, PostgresStrategyStore } from '@orderflow/store';
import DLMM from '@meteora-ag/dlmm';

function makeCrankKeypair(): Keypair {
  const pk = process.env.CRANK_PRIVATE_KEY ?? process.env.KEEPER_PRIVATE_KEY;
  if (!pk) throw new Error('CRANK_PRIVATE_KEY (or legacy KEEPER_PRIVATE_KEY) is required');
  return Keypair.fromSecretKey(bs58.decode(pk));
}

interface LbPairInfo {
  lbPair: PublicKey;
  reserveX: PublicKey;
  reserveY: PublicKey;
  tokenXMint: PublicKey;
  tokenYMint: PublicKey;
  binStep: number;
  activeId: number;
}

export class Keeper {
  private readonly cfg;
  private readonly sdk: VaultSdk;
  private readonly store: JsonStrategyStore | PostgresStrategyStore;
  private readonly crank: Keypair;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastAlertAt = 0;
  private readonly pairCache = new Map<string, LbPairInfo>();

  constructor() {
    this.cfg = loadConfig();
    const storeFile = process.env.STORE_FILE ?? path.join(resolveRepoRoot(), 'data', 'strategies.json');
    this.store = this.cfg.databaseUrl
      ? new PostgresStrategyStore(this.cfg.databaseUrl)
      : new JsonStrategyStore(storeFile);

    const connection = new Connection(this.cfg.rpcEndpoint, 'confirmed');
    this.crank = makeCrankKeypair();
    this.sdk = new VaultSdk(connection, this.cfg);
  }

  start() {
    console.log(`[keeper] starting (crank=${this.crank.publicKey.toBase58()})`);
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

  /** Fetch + cache DLMM pair metadata (reserves, mints, bin step, active id). */
  private async lbPairInfo(poolAddress: string): Promise<LbPairInfo> {
    const cached = this.pairCache.get(poolAddress);
    if (cached) return cached;
    const dlmm = await DLMM.create(this.sdk.connection, new PublicKey(poolAddress));
    const lbPair = new PublicKey(poolAddress);
    const reserveX = new PublicKey((dlmm as any).lbPair?.reserveX ?? (dlmm as any).reserveX);
    const reserveY = new PublicKey((dlmm as any).lbPair?.reserveY ?? (dlmm as any).reserveY);
    const tokenXMint = new PublicKey((dlmm as any).tokenX?.mint?.address ?? (dlmm as any).tokenXMint);
    const tokenYMint = new PublicKey((dlmm as any).tokenY?.mint?.address ?? (dlmm as any).tokenYMint);
    const binStep = Number((dlmm as any).binStep ?? (dlmm as any).state?.binStep ?? 100);
    const activeId = Number((await dlmm.getActiveBin())?.binId ?? 0);
    const info: LbPairInfo = {
      lbPair,
      reserveX,
      reserveY,
      tokenXMint,
      tokenYMint,
      binStep,
      activeId,
    };
    this.pairCache.set(poolAddress, info);
    return info;
  }

  /** Ensure the strategy carries an on-chain vault address (idempotent).
   *
   *  Actual `create_vault` + `deposit` are owner-signed; the keeper (crank)
   *  cannot and must not do it on the owner's behalf. So this step only
   *  provisions a deterministic nonce + vault address into the strategy record
   *  so each strategy maps to one vault PDA. The web/wallet flow then builds
   *  and signs the `create_vault` + `deposit` transaction.
   */
  private async ensureVault(s: DcaStrategy): Promise<void> {
    if (s.vaultAddress && s.vaultNonce != null) return;
    const owner = new PublicKey(s.owner);
    const nonce = BigInt((Math.floor(Date.now() / 1000) % 0xffffffff) >>> 0);
    const vault = vaultPda(owner, nonce);
    s.vaultAddress = vault.toBase58();
    s.vaultNonce = Number(nonce);
    s.updatedAt = Date.now();
    await this.store.upsert(s);
    // Owner must still sign create_vault + deposit. Mark as scheduled so the
    // flow knows provisioning is pending.
    console.log(`[keeper] ${s.strategyId} provisioned vault ${vault.toBase58()} (owner must sign create_vault+deposit)`);
  }

  /**
   * Advance a strategy: claim fees on open orders, then place tranches that are
   * due. Because the vault enforces cadence/bracket/cap on-chain, we simply
   * submit the crank txs and let the invariant checks happen in the program.
   *
   * The **on-chain** `vault.tranchesPlaced` is the source of truth for which
   * tranche to place next (it determines the limit-order PDA index). We do
   * not trust local `s.orders.length` — it may be stale if a previous crank
   * instance ran and was then restarted.
   */
  private async advance(s: DcaStrategy) {
    const owner = new PublicKey(s.owner);
    const nonce = s.vaultNonce != null ? BigInt(s.vaultNonce) : null;
    if (nonce == null || !s.vaultAddress) {
      await this.ensureVault(s);
      return;
    }
    const vault = new PublicKey(s.vaultAddress);

    const onChain = await this.sdk.fetchVault(vault);
    if (!onChain) {
      console.warn(`[keeper] ${s.strategyId} vault ${vault.toBase58()} not found on chain; skipping`);
      return;
    }
    if (onChain.status === 3 /* Cancelled */) {
      s.status = 'cancelled';
      await this.store.upsert(s);
      return;
    }
    if (onChain.tranchesPlaced >= onChain.tranches) {
      s.status = 'completed';
      await this.store.upsert(s);
      return;
    }

    const info = await this.lbPairInfo(s.pool);

    // 1. claim fees on already-placed orders (funds return to vault).
    //    We only attempt this for orders that match the on-chain pending limit
    //    order; older rows from a previous keeper are kept but never claimed
    //    again because the on-chain cancel would also settle the original.
    if (onChain.pending) {
      const known = s.orders.find(
        (o) => o.address === onChain.pending!.address.toBase58(),
      );
      if (known && (known.status === 'placed' || known.status === 'partially_filled')) {
        try {
          await this.claimFees(s, vault, nonce, info, known, onChain.pending.binIds);
        } catch (e) {
          console.error(`[keeper] ${s.strategyId} claim fees failed:`, (e as Error).message);
        }
      }
    }

    // 2. place the next tranche only if cadence has elapsed since the
    //    on-chain `last_placed_at`. The on-chain program re-checks this too.
    const nowSec = Math.floor(Date.now() / 1000);
    const cadenceOk =
      s.intervalSeconds <= 0 ||
      nowSec >= Number(onChain.lastPlacedAt) + s.intervalSeconds;
    if (!cadenceOk) {
      await this.store.upsert(s);
      return;
    }

    const lower = s.minPrice ?? 0;
    const upper = s.maxPrice ?? (lower || 1);
    const binStep = info.binStep;
    const targetBins = spreadBinsBetweenBrackets(lower, upper, 1, binStep);
    const binId = targetBins[0];

    const idx = onChain.tranchesPlaced;
    await this.placeTranche(s, vault, nonce, info, idx, [binId]);
    const order: DcaOrder = {
      orderId: `${s.strategyId}-${idx}`,
      address: limitOrderPda(vault, idx).toBase58(),
      binIds: [binId],
      binIdsResolved: [binId],
      priceLow: lower,
      priceHigh: upper,
      amount: s.totalAmount / s.tranches,
      side: s.side,
      filled: 0,
      feesEarned: 0,
      filledAmount: 0,
      status: 'placed',
      createdAt: Date.now(),
      lastClaimedAt: null,
    };
    s.orders.push(order);
    console.log(`[keeper] ${s.strategyId} crank placed tranche ${idx + 1}/${s.tranches} @ bin ${binId}`);

    s.status = 'active';
    await this.store.upsert(s);
  }

  private async placeTranche(
    s: DcaStrategy,
    vault: PublicKey,
    nonce: bigint,
    info: LbPairInfo,
    trancheIdx: number,
    binIds: number[],
  ) {
    const isAsk = s.side === 'ask';
    const reserve = isAsk ? info.reserveX : info.reserveY;
    const tokenMint = isAsk ? info.tokenXMint : info.tokenYMint;
    const tx = await this.sdk.buildPlaceTrancheTx({
      crank: this.crank,
      owner: new PublicKey(s.owner),
      vaultNonce: nonce,
      trancheIdx,
      binIds,
      lbPair: info.lbPair,
      reserve,
      tokenMint,
    });
    await this.send(tx);
  }

  private async claimFees(
    s: DcaStrategy,
    _vault: PublicKey,
    nonce: bigint,
    info: LbPairInfo,
    order: DcaOrder,
    binIds: number[],
  ) {
    const limitOrder = new PublicKey(order.address);
    const tx = await this.sdk.buildClaimFeesTx({
      crank: this.crank,
      owner: new PublicKey(s.owner),
      vaultNonce: nonce,
      limitOrder,
      binIds,
      lbPair: info.lbPair,
      reserveX: info.reserveX,
      reserveY: info.reserveY,
      tokenXMint: info.tokenXMint,
      tokenYMint: info.tokenYMint,
    });
    await this.send(tx);
  }

  private async send(tx: import('@solana/web3.js').Transaction): Promise<string> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < this.cfg.sendMaxRetries; attempt++) {
      try {
        tx.sign(this.crank);
        const sig = await this.sdk.connection.sendTransaction(tx, [], { skipPreflight: !this.cfg.skipPreflight });
        await this.sdk.connection.confirmTransaction(sig, 'confirmed');
        return sig;
      } catch (e) {
        lastError = e as Error;
        if (attempt < this.cfg.sendMaxRetries - 1) {
          await new Promise((r) => setTimeout(r, this.cfg.sendRetryDelayMs * (attempt + 1)));
        }
      }
    }
    if (lastError) throw lastError;
    throw new Error('send failed');
  }
}
