/**
 * DLMM bin arithmetics.
 *
 * Meteora DLMM organises liquidity into bins. Bin ids map to prices via the
 * bin step following the same convention the lb_clmm program + SDK use:
 *
 *   price(bin) = (1 + binStepBps * 0.0001) ^ (binId - 0)
 *
 * (bin step is expressed in hundredths of a basis point, i.e. the raw "bin step"
 * value such as 100 = 1.00% price jump between adjacent bins.)
 *
 * These helpers are dependency-free so both the on-chain SDK wrapper and the
 * keeper can share the exact same math.
 */

import { BIN_STEP_MAX_BPS } from './constants';

/** The "bare" bin step (basis points * 10) that DLMM stores. */
export type BinStep = number;

/** Highest bin id accepted by the lb_clmm program. */
export const MAX_BIN_ID = 6744073709551615;

function assertBinStep(binStep: BinStep): void {
  if (!Number.isFinite(binStep) || binStep <= 0 || binStep > BIN_STEP_MAX_BPS * 10) {
    throw new Error(`Invalid bin step: ${binStep}`);
  }
}

/**
 * Compute the price multiplier between adjacent bins.
 *   q = (1 + binStep * 0.0001)
 */
export function binStepToQuote(binStep: BinStep): number {
  return 1 + binStep * 0.0001;
}

/**
 * True price (X per Y, the same convention Meteora's SDK uses) at a bin id.
 *   price = q ^ binId
 */
export function priceFromBin(binId: number, binStep: BinStep): number {
  assertBinStep(binStep);
  return Math.pow(binStepToQuote(binStep), binId);
}

/**
 * Map a target price (X per Y) into the nearest DLMM bin id.
 *
 * DLMM cares about the closest power of q below (or above) the price. This
 * returns the bin whose price is closest to the requested price.
 */
export function binFromPrice(price: number, binStep: BinStep): number {
  assertBinStep(binStep);
  if (!(price > 0)) {
    throw new Error(`Invalid price: ${price}`);
  }
  return Math.round(Math.log(price) / Math.log(binStepToQuote(binStep)));
}

/**
 * Floor bin id such that price(binId) <= price.
 * Equivalent to DLMM's "bin id that is at or below this price".
 */
export function binFromPriceFloor(price: number, binStep: BinStep): number {
  assertBinStep(binStep);
  return Math.floor(Math.log(price) / Math.log(binStepToQuote(binStep)));
}

/** Number of bins that separate an upper price and a lower price. */
export function binsBetween(lowerPrice: number, upperPrice: number, binStep: BinStep): number {
  return Math.max(1, Math.ceil(Math.log(upperPrice / lowerPrice) / Math.log(binStepToQuote(binStep))));
}

/**
 * Build a list of `count` evenly spread bin ids between a lower and upper
 * price (inclusive). Used by the wizard to split a DCA into tranches.
 */
export function spreadBinsBetweenBrackets(
  lowerPrice: number,
  upperPrice: number,
  count: number,
  binStep: BinStep,
): number[] {
  if (count < 1) throw new Error('count must be >= 1');
  if (!(lowerPrice > 0) || !(upperPrice >= lowerPrice)) {
    throw new Error(`Invalid price bracket: ${lowerPrice}..${upperPrice}`);
  }
  const startBin = binFromPriceFloor(lowerPrice, binStep);
  const endBin = binFromPriceFloor(upperPrice, binStep);
  const span = Math.max(1, endBin - startBin);
  const step = Math.max(1, Math.round(span / (count - 1 || 1)));
  const bins: number[] = [];
  for (let i = 0; i < count; i++) {
    const b = startBin + i * step;
    if (b > endBin + step) break;
    bins.push(b);
  }
  return bins;
}
