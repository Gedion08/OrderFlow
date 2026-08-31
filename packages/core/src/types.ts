/**
 * Shared domain types for OrderFlow.
 *
 * Everything in the system (SDK, keeper, API, web) speaks in these types so the
 * read layer and the execution layer stay in sync.
 */

export type Side = 'bid' | 'ask';

/** A strategy a user creates through the "Set it and forget it" wizard. */
export interface DcaStrategy {
  strategyId: string;
  owner: string;
  signature: string;
  /** DLMM LbPair address (public key string). */
  pool: string;
  /** The token being traded (base mint for the pair). */
  tokenMint: string;
  /** Side of the book these tranches sit on. */
  side: Side;
  /** Total amount (in quote/base tokens) to deploy across all tranches. */
  totalAmount: number;
  /** Human-friendly amount string, e.g. "250 USDC". */
  totalAmountLabel: string;
  /** How many tranches (bins) to split across. */
  tranches: number;
  /** Seconds between planned tranche activations (scheduling aid). */
  intervalSeconds: number;
  /** Price range bounds (in token X per token Y terms as DLMM exposes). */
  minPrice: number | null;
  maxPrice: number | null;
  /** Allowed slippage in basis points for rebalance operations. */
  slippageBps: number;
  /** Minimum milliseconds between rebalance operations. */
  rebalanceFrequencyMs: number;
  /** Status of the strategy. */
  status: DcaStatus;
  createdAt: number;
  updatedAt: number;
  /** List of per-tranche orders. */
  orders: DcaOrder[];
}

export type DcaStatus =
  | 'scheduled'
  | 'active'
  | 'partially_filled'
  | 'completed'
  | 'cancelled'
  | 'failed';

/** A single DLMM limit order (one or more bins) that is part of a strategy. */
export interface DcaOrder {
  orderId: string;
  /** DLMM limit order account address. */
  address: string;
  /** Bins this order targets. */
  binIds: number[];
  /** Absolute bin ids (resolved, for display). */
  binIdsResolved: number[];
  /** Price range this order covers. */
  priceLow: number;
  priceHigh: number;
  /** Nominal amount deployed on this order. */
  amount: number;
  side: Side;
  /** Filled fraction 0..1. */
  filled: number;
  /** Fee share earned so far while waiting (LP fees on the limit-order bins). */
  feesEarned: number;
  filledAmount: number;
  status: DcaOrderStatus;
  createdAt: number;
  lastClaimedAt: number | null;
}

export type DcaOrderStatus =
  | 'placed'
  | 'filled'
  | 'partially_filled'
  | 'cancelled'
  | 'error';

/** A bin row in the live orderbook-style dashboard. */
export interface BinQuote {
  binId: number;
  /**
   * Price of the bin, expressed consistently as: price of token X in terms of
   * token Y (i.e. how many Y per 1 X), matching DLMM's `getPriceFromBin` output.
   */
  price: number;
  /** Reserve of token X in the bin (for ask/quote-side reads). */
  baseReserve: number;
  /** Reserve of token Y in the bin. */
  quoteReserve: number;
  /** Fee/LP amount available in this bin. */
  feeX: number;
  feeY: number;
  side?: Side;
  active: boolean;
  /** Whether OrderFlow owns a limit order in this bin. */
  ours: boolean;
  ourAmount: number;
  ourFees: number;
}

/** Aggregated read-layer result for a pool around the active bin. */
export interface BookView {
  pool: string;
  activeBinId: number;
  activeBinPrice: number;
  binStep: number;
  asks: BinQuote[];
  bids: BinQuote[];
  tokenX: { mint: string; symbol: string; decimals: number };
  tokenY: { mint: string; symbol: string; decimals: number };
  poolTokenSymbol: string;
  poolQuoteSymbol: string;
  fetchedAt: number;
}
