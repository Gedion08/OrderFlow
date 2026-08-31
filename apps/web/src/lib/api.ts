/**
 * Frontend API client — talks to the OrderFlow read-layer API.
 */

import { PublicKey } from '@solana/web3.js';
import { signingMessage } from '@orderflow/core';

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

async function del<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw new Error(`API ${res.status} for ${path}`);
  return res.json() as Promise<T>;
}

export function createStrategySignature(owner: string, strategyId: string): string {
  return signingMessage(owner, strategyId, 'create');
}

export function createCancelSignature(owner: string, strategyId: string): string {
  return signingMessage(owner, strategyId, 'cancel');
}

export async function signMessageWithWallet(
  getPublicKey: () => { toBase58: () => string } | undefined,
  signMessage: (message: Uint8Array) => Promise<{ signature: Uint8Array }>,
  owner: string,
  strategyId: string,
  action: 'create' | 'cancel'
): Promise<string> {
  const message = signingMessage(owner, strategyId, action);
  const publicKey = getPublicKey();
  if (!publicKey || publicKey.toBase58() !== owner) {
    throw new Error('Wallet not connected or does not match owner');
  }
  const sig = await signMessage(Buffer.from(message));
  return Buffer.from(sig.signature).toString('base64');
}

export interface StrategyPayload {
  strategyId?: string;
  owner: string;
  signature: string;
  pool: string;
  tokenMint?: string;
  side: 'bid' | 'ask';
  totalAmount: number;
  totalAmountLabel?: string;
  tranches: number;
  intervalSeconds: number;
  minPrice: number | null;
  maxPrice: number | null;
  slippageBps?: number;
  rebalanceFrequencyMs?: number;
}

export interface Strategy {
  strategyId: string;
  owner: string;
  signature: string;
  pool: string;
  tokenMint: string;
  side: 'bid' | 'ask';
  totalAmount: number;
  totalAmountLabel: string;
  tranches: number;
  intervalSeconds: number;
  minPrice: number | null;
  maxPrice: number | null;
  slippageBps: number;
  rebalanceFrequencyMs: number;
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
  cancelStrategy: (id: string, signature: string) =>
    del<{ ok: boolean }>(`/api/strategies/${id}?signature=${encodeURIComponent(signature)}`),
};

export const fmtUsd = (n: number | undefined | null, digits = 2) =>
  n == null ? '—' : `$${n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

export const fmtPrice = (n: number | undefined | null) =>
  n == null ? '—' : n.toLocaleString(undefined, { maximumSignificantDigits: 6 });
