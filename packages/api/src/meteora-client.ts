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
 *   /positions/{pool_address}/pnl
 *   /portfolio/open
 *   /wallets/{wallet}/limit_orders/summary
 *   /stats/protocol_metrics
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

  private normalizePool(raw: any): any {
    if (!raw || typeof raw !== 'object') return raw;
    return {
      ...raw,
      symbol: raw.token_x?.symbol || raw.token_y?.symbol || raw.symbol || raw.name,
      bin_step: raw.pool_config?.bin_step ?? raw.bin_step ?? raw.binStep,
      active_bin: raw.active_bin_id ?? raw.activeBinId ?? raw.active_bin,
      activeBinId: raw.active_bin_id ?? raw.activeBinId ?? raw.active_bin,
      volume24h: raw.volume?.['24h'] ?? raw.volume24h,
      fees24h: raw.fees?.['24h'] ?? raw.fees24h,
      token_x_uri: raw.token_x?.icon ?? raw.token_x?.name,
      token_y_uri: raw.token_y?.icon ?? raw.token_y?.name,
    };
  }

  private normalizePortfolioItem(raw: any): any {
    if (!raw || typeof raw !== 'object') return raw;
    return {
      ...raw,
      pool_symbol: raw.tokenX || raw.tokenY || raw.poolAddress,
      symbol: raw.tokenX || raw.tokenY || raw.poolAddress,
      value: raw.balances ?? raw.totalValue ?? 0,
      totalValue: raw.balances ?? raw.totalValue ?? 0,
      unclaimed_fees: raw.unclaimedFees ?? raw.unclaimed_fees ?? 0,
      pnl: raw.pnl ?? 0,
    };
  }

  /** Paginated pools. */
  async pools(limit = 20, offset = 0) {
    const resp = await this.get<any>(`/pools`, { limit, offset });
    const list = Array.isArray(resp?.data) ? resp.data : Array.isArray(resp) ? resp : [];
    return list.map((p: any) => this.normalizePool(p));
  }

  /** A single pool's metadata + current state. */
  async pool(address: string) {
    return this.normalizePool(await this.get<any>(`/pools/${address}`));
  }

  /** OHLCV candles for a pool. */
  async ohlcv(address: string, timeRange = '1d', timeBucket = 'H1') {
    return this.get<any[]>(`/pools/${address}/ohlcv`, { time_range: timeRange, time_bucket: timeBucket });
  }

  /** Open + closed positions for a wallet in a pool. */
  async positions(pool: string, wallet: string) {
    const data = await this.get<any>(`/positions/${pool}/pnl`, { user: wallet });
    return Array.isArray(data?.positions) ? data.positions : [];
  }

  /** All pools a wallet has open positions in, with balances/fees/PnL. */
  async portfolio(wallet: string) {
    const data = await this.get<any>(`/portfolio/open`, { user: wallet });
    const list = Array.isArray(data?.pools) ? data.pools : [];
    return list.map((p: any) => this.normalizePortfolioItem(p));
  }

  /** Wallet's DLMM limit orders (open + closed). */
  async limitOrders(wallet: string) {
    return this.get<any>(`/wallets/${wallet}/limit_orders/summary`);
  }

  /** Protocol-wide aggregated metrics. */
  async protocolStats() {
    return this.get<any>(`/stats/protocol_metrics`);
  }
}

export function createMeteoraClient(cfg?: OrderFlowConfig): MeteoraApiClient {
  const c = cfg ?? loadConfig();
  return new MeteoraApiClient({ meteoraApiBase: c.meteoraApiBase });
}
