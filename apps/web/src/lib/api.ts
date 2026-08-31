/**
 * Frontend API client — talks to the OrderFlow read-layer API.
 */

const BASE = import.meta.env.VITE_API_URL ?? '';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API ${res.status} for ${path}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status} for ${path}`);
  return res.json() as Promise<T>;
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`API ${res.status} for ${path}`);
  return res.json() as Promise<T>;
}

export interface StrategyPayload {
  strategyId?: string;
  owner: string;
  pool: string;
  tokenMint?: string;
  side: 'bid' | 'ask';
  totalAmount: number;
  totalAmountLabel?: string;
  tranches: number;
  intervalSeconds: number;
  minPrice: number | null;
  maxPrice: number | null;
}

export interface Strategy {
  strategyId: string;
  owner: string;
  pool: string;
  tokenMint: string;
  side: 'bid' | 'ask';
  totalAmount: number;
  totalAmountLabel: string;
  tranches: number;
  intervalSeconds: number;
  minPrice: number | null;
  maxPrice: number | null;
  status: string;
  createdAt: number;
  updatedAt: number;
  orders: unknown[];
}

export interface PoolRow {
  address: string;
  name?: string;
  symbol?: string;
  tvl?: number;
  volume24h?: number;
  fees24h?: number;
  bin_step?: number;
  active_bin?: number;
  token_x_uri?: string;
  token_y_uri?: string;
  [k: string]: unknown;
}

export interface BookRow {
  binId: number;
  price: number;
  baseReserve: number;
  quoteReserve: number;
  feeX: number;
  feeY: number;
  side?: 'bid' | 'ask';
  active: boolean;
  ours: boolean;
  ourAmount: number;
  ourFees: number;
}

export interface BookView {
  pool: string;
  activeBinId: number;
  activeBinPrice: number;
  binStep: number;
  asks: BookRow[];
  bids: BookRow[];
  poolTokenSymbol: string;
  poolQuoteSymbol: string;
  fetchedAt: number;
}

export const api = {
  searchPools: (q = '', limit = 20) =>
    get<{ pools: PoolRow[] }>(`/api/pools?${q ? `q=${encodeURIComponent(q)}&` : ''}limit=${limit}`),
  pool: (address: string) => get<PoolRow>(`/api/pools/${address}`),
  book: (address: string) => get<BookView>(`/api/book/${address}`),
  limitOrders: (wallet: string) => get<any>(`/api/limit-orders/${wallet}`),
  portfolio: (wallet: string) => get<any>(`/api/portfolio/${wallet}`),
  positions: (pool: string, wallet: string) => get<any>(`/api/positions/${pool}/${wallet}`),
  strategies: (wallet: string) => get<{ strategies: Strategy[] }>(`/api/strategies/${wallet}`),
  createStrategy: (s: StrategyPayload) => post<{ strategy: Strategy }>('/api/strategies', s),
  cancelStrategy: (id: string) => del<{ ok: boolean }>(`/api/strategies/${id}`),
};

export const fmtUsd = (n: number | undefined | null, digits = 2) =>
  n == null ? '—' : `$${n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

export const fmtPrice = (n: number | undefined | null) =>
  n == null ? '—' : n.toLocaleString(undefined, { maximumSignificantDigits: 6 });
