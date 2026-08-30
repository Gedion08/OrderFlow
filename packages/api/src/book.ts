/**
 * Book read model.
 *
 * Builds an orderbook-style view (bids/asks around the active bin) for a pool
 * by combining:
 *   - pool metadata from the Meteora Data API (bin step, active bin, tokens)
 *   - the raw bin data (reserves + fees)
 *   - OrderFlow strategy state (which bins belong to us, amounts, fees)
 *
 * The frontend renders this directly as its "live orderbook-style dashboard".
 */

import { BinQuote, BookView, DcaStrategy, priceFromBin, BinStep } from '@orderflow/core';

export interface BuildBookArgs {
  poolAddress: string;
  binStep: BinStep;
  activeBinId: number;
  /** Bins at/below the active bin and their quote reserves (raw). */
  binBases: Array<{ binId: number; amount: number; feeAmountX: number; feeAmountY: number }>;
  /** Bins at/above the active bin and their quotes. */
  binAsks: Array<{ binId: number; amount: number; feeAmountX: number; feeAmountY: number }>;
  tokenX: { mint: string; symbol: string; decimals: number };
  tokenY: { mint: string; symbol: string; decimals: number };
  poolTokenSymbol: string;
  poolQuoteSymbol: string;
  /** OrderFlow strategies that may touch this pool. */
  strategies?: DcaStrategy[];
}

interface BinIndex {
  ours: number; // our amount
  fees: number; // our unclaimed fees in this bin
  active: boolean;
}

function indexStrategies(strategies: DcaStrategy[] | undefined): Map<number, BinIndex> {
  const map = new Map<number, BinIndex>();
  for (const s of strategies ?? []) {
    for (const o of s.orders) {
      for (const b of o.binIdsResolved) {
        const entry = map.get(b) ?? { ours: 0, fees: 0, active: false };
        entry.ours += o.amount * (1 - o.filled);
        entry.fees += o.feesEarned;
        map.set(b, entry);
      }
    }
  }
  return map;
}

export function buildBook(args: BuildBookArgs): BookView {
  const { binStep, activeBinId } = args;
  const own = indexStrategies(args.strategies);

  const toQuote = (b: { binId: number; amount: number; feeAmountX: number; feeAmountY: number }, side: 'bid' | 'ask'): BinQuote => {
    const mine = own.get(b.binId);
    return {
      binId: b.binId,
      price: priceFromBin(b.binId, binStep),
      baseReserve: b.amount,
      quoteReserve: b.amount,
      feeX: b.feeAmountX,
      feeY: b.feeAmountY,
      side,
      active: b.binId === activeBinId,
      ours: (mine?.ours ?? 0) > 0,
      ourAmount: mine?.ours ?? 0,
      ourFees: mine?.fees ?? 0,
    };
  };

  const bids = args.binBases.map((b) => toQuote(b, 'bid'));
  const asks = args.binAsks.map((b) => toQuote(b, 'ask'));

  return {
    pool: args.poolAddress,
    activeBinId,
    activeBinPrice: priceFromBin(activeBinId, binStep),
    binStep,
    // sort: bids descending, asks ascending — classic orderbook layout
    bids: bids.sort((a, b) => b.binId - a.binId),
    asks: asks.sort((a, b) => a.binId - b.binId),
    tokenX: args.tokenX,
    tokenY: args.tokenY,
    poolTokenSymbol: args.poolTokenSymbol,
    poolQuoteSymbol: args.poolQuoteSymbol,
    fetchedAt: Date.now(),
  };
}
