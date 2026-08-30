/**
 * OrderFlow constants.
 */

/** Program IDs of the Meteora programs OrderFlow composes. */
export const METRORA_PROGRAMS = {
  /** lb_clmm — DLMM program id. */
  DLMM: 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
  /** Zap program id (zap in / zap out across DLMM + Jupiter). */
  ZAP: 'ZapXE1iZx1uwEnJrULJzTdKkjLcJxw5vzuorJs8BfAj',
  /** dynamic_bonding_curve — DBC program id (reserved). */
  DBC: 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN',
} as const;

/** Common token symbols for display fallbacks (mint -> symbol). */
export const WELL_KNOWN_MINTS: Record<string, string> = {
  // SOL is often the quote/base token in DLMM pools.
  So11111111111111111111111111111111111111112: 'SOL',
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
  Es9vMFrzaCERmJfrF4H2FYD4KjNkTnLhY9B9z8t1Bfd: 'USDT',
};

/** Default schedule the keeper uses to poll active bins. */
export const DEFAULT_KEEPER_INTERVAL_MS = 30_000;

/** Bin step (basis points * 10) bounds DLMM supports (up to 400 bp). */
export const BIN_STEP_MAX_BPS = 400;

/** Maximum bins a single DLMM limit order can cover. */
export const LIMIT_ORDER_MAX_BINS = 50;
