/**
 * Thin client for Meteora's public DLMM Data API.
 *
 * OrderFlow's read layer proxies/aggregates these endpoints so the frontend
 * does not talk to Meteora directly and so we can decorate the raw payloads
 * with OrderFlow strategy context (which bins belong to us, fees earned, etc).
 *
 * Official endpoint shapes (see docs.meteora.ag/developer-guides/dlmm/api-reference):
 *   /pools
 *   /pools/{address}
 *   /pools/{address}/ohlcv
 *   /positions/{pool}/{wallet}
 *   /portfolio/{wallet}/pools
 *   /limit-orders/{wallet}
 */

import { loadConfig, OrderFlowConfig } from '@orderflow/core';

export class MeteoraApiClient {
  private readonly base: string;

  constructor(cfg: Pick<OrderFlowConfig, 'meteoraApiBase'>) {
    this.base = cfg.meteoraApiBase.replace(/\/+$/, '');
  }

  private async get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
    const url = new URL(`${this.base}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    }
    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`Meteora API ${res.status} for ${path}`);
    }
    return res.json() as Promise<T>;
  }

  /** Paginated pools. */
  async pools(limit = 20, offset = 0) {
    return this.get<any[]>(`/pools`, { limit, offset });
  }

  /** A single pool's metadata + current state. */
  async pool(address: string) {
    return this.get<any>(`/pools/${address}`);
  }

  /** OHLCV candles for a pool. */
  async ohlcv(address: string, timeRange = '1d', timeBucket = 'H1') {
    return this.get<any[]>(`/pools/${address}/ohlcv`, { time_range: timeRange, time_bucket: timeBucket });
  }

  /** Open + closed positions for a wallet in a pool. */
  async positions(pool: string, wallet: string) {
    return this.get<any[]>(`/positions/${pool}/${wallet}`);
  }

  /** All pools a wallet has open positions in, with balances/fees/PnL. */
  async portfolio(wallet: string) {
    return this.get<any[]>(`/portfolio/${wallet}/pools`);
  }

  /** Wallet's DLMM limit orders (open + closed). */
  async limitOrders(wallet: string) {
    return this.get<any>(`/limit-orders/${wallet}`);
  }

  /** Protocol-wide aggregated metrics. */
  async protocolStats() {
    return this.get<any>(`/stats/protocol`);
  }
}

export function createMeteoraClient(cfg?: OrderFlowConfig): MeteoraApiClient {
  const c = cfg ?? loadConfig();
  return new MeteoraApiClient({ meteoraApiBase: c.meteoraApiBase });
}
