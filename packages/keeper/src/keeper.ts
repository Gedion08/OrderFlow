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
import { VaultSdk, vaultPda } from '@orderflow/sdk';
import { JsonStrategyStore, PostgresStrategyStore } from '@orderflow/store';
import DLMM from '@meteora-ag/dlmm';

function makeCrankKeypair(): Keypair {
  const pk = process.env.CRANK_PRIVATE_KEY ?? process.env.KEEPER_PRIVATE_KEY;
  if (!pk) throw new Error('CRANK_PRIVATE_KEY (or legacy KEEPER_PRIVATE_KEY) is required');
  return Keypair.fromSecretKey(bs58.decode(pk));
}

interface LbPairInfo {
  lbPair: PublicKey;
  reserve: PublicKey;      // reserve for the token being sold by the vault
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
    const info: LbPairInfo = {
      lbPair,
      reserveX: new PublicKey((dlmm as any).lbPair?.reserveX ?? (dlmm as any).reserveX ?? '11111111111111111111111111111111'),
      reserveY: new PublicKey((dlmm as any).lbPair?.reserveY ?? (dlmm as any).reserveY ?? '11111111111111111111111111111111'),
      tokenXMint: new PublicKey((dlmm as any).tokenX?.mint?.address ?? '11111111111111111111111111111111'),
      tokenYMint: new PublicKey((dlmm as any).tokenY?.mint?.address ?? '11111111111111111111111111111111'),
      reserve: (dlmm as any).tokenX?.mint?.address ? new PublicKey((dlmm as any).reserveX ?? '11111111111111111111111111111111') : new PublicKey('11111111111111111111111111111111'),
      binStep: Number((dlmm as any).binStep ?? (dlmm as any).state?.binStep ?? 100),
      activeId: Number((await dlmm.getActiveBin())?.binId ?? 0),
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
   */
  private async advance(s: DcaStrategy) {
    const owner = new PublicKey(s.owner);
    const nonce = s.vaultNonce != null ? BigInt(s.vaultNonce) : null;
    if (nonce == null || !s.vaultAddress) {
      await this.ensureVault(s);
      return;
    }
    const vault = new PublicKey(s.vaultAddress);
    const info = await this.lbPairInfo(s.pool);

    // 1. claim fees on already-placed orders (funds return to vault)
    for (const o of s.orders) {
      if (o.status === 'placed' || o.status === 'partially_filled') {
        try {
          await this.claimFees(s, vault, nonce, info, o);
        } catch (e) {
          console.error(`[keeper] ${s.strategyId} claim fees failed:`, (e as Error).message);
        }
      }
    }

    // 2. place tranches that are due
    const now = Date.now();
    let dueCount = 0;
    if (s.tranches > 0) {
      const elapsed = now - s.createdAt;
      const perTrancheMs = s.intervalSeconds * 1000;
      if (perTrancheMs > 0) dueCount = Math.min(s.tranches, Math.floor(elapsed / perTrancheMs) + 1);
    }
    if (s.intervalSeconds <= 0) dueCount = s.tranches;
    dueCount = Math.max(1, dueCount);

    const lower = s.minPrice ?? 0;
    const upper = s.maxPrice ?? (lower || 1);
    const binStep = info.binStep;
    const targetBins = spreadBinsBetweenBrackets(lower, upper, 1, binStep);
    const binId = targetBins[0];

    while (s.orders.length < Math.min(s.tranches, dueCount)) {
      const idx = s.orders.length;
      await this.placeTranche(s, vault, nonce, info, idx, [binId]);
      const order: DcaOrder = {
        orderId: `${s.strategyId}-${idx}`,
        address: vault.toBase58(),
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
        createdAt: now,
        lastClaimedAt: null,
      };
      s.orders.push(order);
      console.log(`[keeper] ${s.strategyId} crank placed tranche ${idx + 1}/${s.tranches} @ bin ${binId}`);
    }

    const allPlaced = s.orders.length >= s.tranches;
    if (allPlaced) s.status = 'active';
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
    vault: PublicKey,
    nonce: bigint,
    info: LbPairInfo,
    order: DcaOrder,
  ) {
    const limitOrder = new PublicKey(order.address);
    const tx = await this.sdk.buildClaimFeesTx({
      crank: this.crank,
      owner: new PublicKey(s.owner),
      vaultNonce: nonce,
      limitOrder,
      binIds: order.binIds,
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
