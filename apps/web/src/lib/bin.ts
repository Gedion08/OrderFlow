/**
 * DLMM bin math — local copy for the web app.
 *
 * Kept in the frontend so the browser bundle does not depend on the Node CJS
 * core package at runtime. Mirrors `@orderflow/core` bin-math exactly so the
 * wizard preview matches what the keeper places. bin step is bps * 10 (e.g.
 * 100 = 1.00% price jump per bin).
 */

export type BinStep = number;

export function priceFromBin(binId: number, binStep: BinStep): number {
  return Math.pow(1 + binStep * 0.0001, binId);
}

export function binFromPriceFloor(price: number, binStep: BinStep): number {
  if (!(price > 0)) return 0;
  return Math.floor(Math.log(price) / Math.log(1 + binStep * 0.0001));
}

export function spreadBinsBetweenBrackets(
  lowerPrice: number,
  upperPrice: number,
  count: number,
  binStep: BinStep,
): number[] {
  if (!(lowerPrice > 0) || !(upperPrice >= lowerPrice)) return [];
  const start = binFromPriceFloor(lowerPrice, binStep);
  const end = binFromPriceFloor(upperPrice, binStep);
  const step = Math.max(1, Math.round((end - start) / (count - 1 || 1)));
  const bins: number[] = [];
  for (let i = 0; i < count; i++) {
    const b = start + i * step;
    if (b > end + step) break;
    bins.push(b);
  }
  return bins;
}
