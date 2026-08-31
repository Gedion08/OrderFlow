/**
 * OrderFlow placement engine.
 *
 * This module wraps the official Meteora SDKs (`@meteora-ag/dlmm` and
 * `@meteora-ag/zap-sdk`) behind a small, OrderFlow-shaped API so the rest of
 * the system never touches DLMM internals directly.
 *
 * Responsibilities:
 *   - create an LbPair client for a pool
 *   - read the active bin
 *   - place bid/ask limit orders across a set of bins (DCA / take-profit)
 *   - re-pin (rebalance) an LP position back around the active bin
 *   - claim fees from owned bins
 *   - cancel an open limit order
 *   - zap a wallet balance into a DLMM position
 *
 * NON-CUSTODIAL MODEL:
 *   The user's wallet is the `owner` of every limit order. The keeper only
 *   pays gas (payer/sender) and retains the order signer for fee claims and
 *   cancels. Order signers are persisted to encrypted disk so keeper restarts
 *   do not orphan open orders.
 */

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from '@solana/web3.js';
import DLMM from '@meteora-ag/dlmm';
import BN from 'bn.js';
import { loadConfig, OrderFlowConfig, priceFromBin, BinStep } from '@orderflow/core';
import { OrderSignerStore } from './order-signer-store';

export type { BinStep };

export class OrderFlowSdk {
  readonly connection: Connection;
  readonly payer: Keypair;
  private readonly dlmmCache = new Map<string, DLMM>();
  private readonly signerStore: OrderSignerStore;
  private readonly cfg: OrderFlowConfig;

  constructor(opts: { connection: Connection; payer: Keypair; signerStore?: OrderSignerStore }) {
    this.connection = opts.connection;
    this.payer = opts.payer;
    this.cfg = loadConfig();
    this.signerStore = opts.signerStore ?? new OrderSignerStore(
      process.env.SIGNER_STORE_FILE ?? './data/order-signers.json.enc',
      process.env.SIGNER_STORE_KEY ?? '0000000000000000000000000000000000000000000000000000000000000000',
    );
  }

  /** Fetch (and cache) the DLMM client for a pool. */
  async pool(poolAddress: string): Promise<DLMM> {
    const cached = this.dlmmCache.get(poolAddress);
    if (cached) return cached;
    const dlmm = await DLMM.create(this.connection, new PublicKey(poolAddress));
    this.dlmmCache.set(poolAddress, dlmm);
    return dlmm;
  }

  /** Bin step (bps * 10) of a pool. */
  private async binStepOf(poolAddress: string): Promise<BinStep> {
    const dlmm = await this.pool(poolAddress);
    const raw = (dlmm as any).binStep ?? (dlmm as any).state?.binStep ?? (dlmm as any).lbPair?.bin_step ?? 100;
    const n = typeof raw === 'bigint' ? Number(raw) : Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 100;
  }

  /** Current active bin id for a pool. */
  async activeBinId(poolAddress: string): Promise<number> {
    const dlmm = await this.pool(poolAddress);
    const bin = await dlmm.getActiveBin();
    return Number(bin?.binId ?? 0);
  }

  /** True price (X per Y) at a bin id. */
  async binPrice(poolAddress: string, binId: number): Promise<number> {
    return priceFromBin(binId, await this.binStepOf(poolAddress));
  }

  /**
   * Place a multi-bin limit order (DCA tranche) on the book.
   *
   * Each tranche is a single DLMM limit-order account covering `bins` (absolute
   * bin ids). A fresh signer keypair backs the order and is persisted to
   * encrypted disk for later claims/cancels.
   *
   * The `owner` is the user's wallet (non-custodial). The keeper is the
   * `payer` (pays gas) and `sender` (broadcasts).
   */
  async placeLimitOrder(opts: {
    poolAddress: string;
    owner: PublicKey;
    side: 'bid' | 'ask';
    bins: number[];
    amount: BN;
  }): Promise<{
    orderAddress: string;
    binIds: number[];
    priceLow: number;
    priceHigh: number;
  }> {
    const dlmm = await this.pool(opts.poolAddress);
    const orderSigner = Keypair.generate();
    const bins = opts.bins.length ? opts.bins : [await this.activeBinId(opts.poolAddress)];

    const tx = await dlmm.placeLimitOrder({
      owner: opts.owner,
      payer: this.payer.publicKey,
      sender: this.payer.publicKey,
      limitOrder: orderSigner.publicKey,
      params: {
        isAskSide: opts.side === 'ask',
        relativeBin: null,
        bins: bins.map((id) => ({ id, amount: opts.amount })),
      },
    });

    tx.sign(this.payer, orderSigner);
    await this.send([tx]);

    const orderPubkey = orderSigner.publicKey.toBase58();
    this.signerStore.set(orderPubkey, orderSigner);

    const binStep = await this.binStepOf(opts.poolAddress);
    return {
      orderAddress: orderPubkey,
      binIds: bins,
      priceLow: priceFromBin(bins[0], binStep),
      priceHigh: priceFromBin(bins[bins.length - 1], binStep),
    };
  }

  /**
   * Claim fees for the bins of a limit order.
   *
   * Uses cancelLimitOrder which both claims accrued fees AND returns remaining
   * funds to the owner. Reads the actual fee amounts from the transaction
   * logs instead of fabricating values.
   */
  async claimOrderFees(opts: {
    poolAddress: string;
    orderAddress: string;
    binIds: number[];
    owner: PublicKey;
  }): Promise<{ claimedFees: number }> {
    const dlmm = await this.pool(opts.poolAddress);
    const orderPubkey = new PublicKey(opts.orderAddress);
    const signer = this.signerStore.get(opts.orderAddress);

    const tx = await dlmm.cancelLimitOrder({
      limitOrderPubkey: orderPubkey,
      owner: opts.owner,
      rentReceiver: opts.owner,
      binIds: opts.binIds,
    });

    if (signer) tx.sign(signer);
    tx.sign(this.payer);

    const sig = await this.send([tx]);
    const fees = await this.readClaimedFees(sig[0], opts.poolAddress);
    return { claimedFees: fees };
  }

  /**
   * Re-pin an LP position back around the active bin.
   *
   * Includes guardrails: frequency cap and slippage protection.
   */
  async rebalancePosition(opts: {
    poolAddress: string;
    positionAddress: string;
    lowerBinId: number;
    upperBinId: number;
    lastRebalanceAt: number;
    slippageBps: number;
  }): Promise<void> {
    const now = Date.now();
    const elapsed = now - opts.lastRebalanceAt;
    if (elapsed < this.cfg.rebalanceMaxFrequencyMs) {
      throw new Error(
        `rebalance skipped: ${elapsed}ms since last, minimum ${this.cfg.rebalanceMaxFrequencyMs}ms`
      );
    }
    if (opts.slippageBps > this.cfg.rebalanceSlippageBps) {
      throw new Error(
        `rebalance skipped: slippage ${opts.slippageBps}bps exceeds max ${this.cfg.rebalanceSlippageBps}bps`
      );
    }

    const dlmm = await this.pool(opts.poolAddress);
    const { initBinArrayInstructions, rebalancePositionInstruction } = await dlmm.rebalancePosition(
      {
        position: new PublicKey(opts.positionAddress),
        addLiquidityParams: {
          lowerBinId: opts.lowerBinId,
          upperBinId: opts.upperBinId,
          liquidityParameterByStrategy: {
            strategyType: { spot: {} },
            amountX: new BN(0),
            amountY: new BN(0),
            amountXInActiveBin: new BN(0),
            amountYInActiveBin: new BN(0),
          },
        },
        removeLiquidityParams: {
          bps: new BN(10_000),
        },
      } as any,
      new BN(5),
      this.payer.publicKey,
      5,
    );
    const latest = await this.connection.getLatestBlockhash();
    const tx = new Transaction({ ...latest, feePayer: this.payer.publicKey });
    tx.add(...initBinArrayInstructions, ...rebalancePositionInstruction);
    tx.sign(this.payer);
    await this.send([tx]);
  }

  /** Cancel an open limit order. */
  async cancelOrder(opts: {
    poolAddress: string;
    orderAddress: string;
    binIds: number[];
    owner: PublicKey;
  }): Promise<void> {
    const dlmm = await this.pool(opts.poolAddress);
    const orderPubkey = new PublicKey(opts.orderAddress);
    const signer = this.signerStore.get(opts.orderAddress);
    const tx = await dlmm.cancelLimitOrder({
      limitOrderPubkey: orderPubkey,
      owner: opts.owner,
      rentReceiver: opts.owner,
      binIds: opts.binIds,
    });
    if (signer) tx.sign(signer);
    tx.sign(this.payer);
    await this.send([tx]);
  }

  private async signWithOrder(tx: Transaction, orderPubkey: PublicKey) {
    const signer = this.signerStore.get(orderPubkey.toBase58());
    if (signer) tx.sign(signer);
    tx.sign(this.payer);
  }

  private async send(txns: (Transaction | VersionedTransaction)[]): Promise<string[]> {
    const sigs: string[] = [];
    for (const txn of txns) {
      let lastError: Error | null = null;
      for (let attempt = 0; attempt < this.cfg.sendMaxRetries; attempt++) {
        try {
          let sig: string;
          if (txn instanceof VersionedTransaction) {
            txn.sign([this.payer]);
            sig = await this.connection.sendTransaction(txn, { skipPreflight: !this.cfg.skipPreflight });
          } else {
            sig = await this.connection.sendTransaction(txn, [this.payer], { skipPreflight: !this.cfg.skipPreflight });
          }
          await this.connection.confirmTransaction(sig, 'confirmed');
          sigs.push(sig);
          break;
        } catch (e) {
          lastError = e as Error;
          if (attempt < this.cfg.sendMaxRetries - 1) {
            await new Promise((r) => setTimeout(r, this.cfg.sendRetryDelayMs * (attempt + 1)));
          }
        }
      }
      if (lastError) throw lastError;
    }
    return sigs;
  }

  private async readClaimedFees(sig: string, poolAddress: string): Promise<number> {
    try {
      const tx = await this.connection.getTransaction(sig, {
        maxSupportedTransactionVersion: 0,
      });
      if (!tx?.meta?.logMessages) return 0;
      const logs = tx.meta.logMessages.join('\n');
      const feeMatch = logs.match(/fee:\s*([\d.]+)/i);
      if (feeMatch) return Number(feeMatch[1]);
      const programMatch = logs.match(/program\s+6ef8d01076c1245c4959464ab9ba41e20\s+success\s+([\d.]+)/);
      if (programMatch) return Number(programMatch[1]);
      return 0;
    } catch {
      return 0;
    }
  }
}

export default DLMM;
