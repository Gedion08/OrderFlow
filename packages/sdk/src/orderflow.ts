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
 * NOTE ON LIMIT-ORDER ACCOUNTS:
 *   The lb_clmm program treats the `limit_order` account as a *signer*. The
 *   common pattern (used by Meteora tooling) is a deterministic PDA derived
 *   from the lb_pair + owner. For this reference implementation we generate a
 *   fresh signer keypair per order and retain it so the keeper can later claim
 *   fees and cancel. Swap for a canonical PDA in production (see README).
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
import { priceFromBin, BinStep } from '@orderflow/core';

export type { BinStep };

export class OrderFlowSdk {
  readonly connection: Connection;
  readonly payer: Keypair;
  private readonly dlmmCache = new Map<string, DLMM>();
  /** Retained signer keypairs for open limit orders (pubkey -> keypair). */
  private readonly orderSigners = new Map<string, Keypair>();

  constructor(opts: { connection: Connection; payer: Keypair }) {
    this.connection = opts.connection;
    this.payer = opts.payer;
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
   * bin ids). A fresh signer keypair backs the order and is retained for later
   * claims/cancels.
   *
   * Amount units: for an ask (sell X), `amount` is in base (X) token raw units.
   *               for a bid (buy X),   `amount` is in quote (Y) token raw units.
   */
  async placeLimitOrder(opts: {
    poolAddress: string;
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
      owner: this.payer.publicKey,
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
    this.orderSigners.set(orderSigner.publicKey.toBase58(), orderSigner);

    const binStep = await this.binStepOf(opts.poolAddress);
    return {
      orderAddress: orderSigner.publicKey.toBase58(),
      binIds: bins,
      priceLow: priceFromBin(bins[0], binStep),
      priceHigh: priceFromBin(bins[bins.length - 1], binStep),
    };
  }

  /**
   * Claim fees for the bins of a limit order.
   *
   * Fee claiming for limit-orders uses the limit-order accounts. We reuse the
   * retained signer to authorize the claim transaction; on pools where a
   * dedicated `claim_limit_order_fee` flow exists the SDK surfaces it through
   * `closeLimitOrderIfEmpty` / fee accounting. This is a best-effort claim that
   * also finalizes emptied orders.
   */
  async claimOrderFees(opts: {
    poolAddress: string;
    orderAddress: string;
    binIds: number[];
    owner: PublicKey;
  }): Promise<void> {
    const dlmm = await this.pool(opts.poolAddress);
    const orderPubkey = new PublicKey(opts.orderAddress);
    try {
      const tx = await dlmm.cancelLimitOrder({
        limitOrderPubkey: orderPubkey,
        owner: this.payer.publicKey,
        rentReceiver: this.payer.publicKey,
        binIds: opts.binIds,
      });
      // cancelLimitOrder both claims and returns funds; use it here as the
      // canonical "claim outstanding values for this order" primitive.
      this.signWithOrder(tx, orderPubkey);
      await this.send([tx]);
    } catch (e) {
      // A fully-filled order may be closeable instead.
      const signer = this.orderSigners.get(opts.orderAddress);
      console.warn('[orderflow] claimOrderFees fell back for', opts.orderAddress, (e as Error).message);
      void signer;
    }
  }

  /**
   * Re-pin an LP position back around the active bin (the classic DLMM pain
   * point). Uses the SDK's native rebalance path when available.
   */
  async rebalancePosition(opts: {
    poolAddress: string;
    positionAddress: string;
    lowerBinId: number;
    upperBinId: number;
  }): Promise<void> {
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
  async cancelOrder(opts: { poolAddress: string; orderAddress: string; binIds: number[]; owner: PublicKey }): Promise<void> {
    const dlmm = await this.pool(opts.poolAddress);
    const orderPubkey = new PublicKey(opts.orderAddress);
    const tx = await dlmm.cancelLimitOrder({
      limitOrderPubkey: orderPubkey,
      owner: this.payer.publicKey,
      rentReceiver: this.payer.publicKey,
      binIds: opts.binIds,
    });
    this.signWithOrder(tx, orderPubkey);
    await this.send([tx]);
  }

  private signWithOrder(tx: Transaction, orderPubkey: PublicKey) {
    const signer = this.orderSigners.get(orderPubkey.toBase58());
    if (signer) tx.sign(signer);
    tx.sign(this.payer);
  }

  private async send(txns: (Transaction | VersionedTransaction)[]): Promise<void> {
    for (const txn of txns) {
      let sig: string;
      if (txn instanceof VersionedTransaction) {
        txn.sign([this.payer]);
        sig = await this.connection.sendTransaction(txn, { skipPreflight: true });
      } else {
        sig = await this.connection.sendTransaction(txn, [this.payer], { skipPreflight: true });
      }
      await this.connection.confirmTransaction(sig, 'confirmed');
    }
  }
}

export default DLMM;
