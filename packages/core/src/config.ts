/**
 * Environment / configuration loading for OrderFlow.
 *
 * Reads from process.env (populated from .env). Kept dependency-light so it can
 * be shared by the api and keeper.
 */

import { DEFAULT_KEEPER_INTERVAL_MS } from './constants';

import * as fs from 'fs';
import * as path from 'path';

/**
 * Resolve the monorepo root directory by walking up from `startDir` looking for
 * the root package.json (where the npm workspaces are declared). Falls back to
 * `startDir` if not found.
 */
export function resolveRepoRoot(startDir: string = process.cwd()): string {
  let dir = path.resolve(startDir);
  for (;;) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        const json = JSON.parse(fs.readFileSync(pkg, 'utf8'));
        if (json.workspaces) return dir;
      } catch {
        /* keep walking */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(startDir);
}

/**
 * Load a `.env` into process.env (without overwriting existing values).
 * Resolves the monorepo-root `.env` by walking up from `cwd` so it works no
 * matter which workspace runs the process. Zero-dependency.
 */
export function loadEnvFromRepo(startDir: string = process.cwd()): void {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) {
      const content = fs.readFileSync(candidate, 'utf8');
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq <= 0) continue;
        const key = line.slice(0, eq).trim();
        const value = line.slice(eq + 1).trim();
        if (process.env[key] === undefined) process.env[key] = value;
      }
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

export interface OrderFlowConfig {
  meteoraApiBase: string;
  rpcEndpoint: string;
  rpcWss: string;
  keeperIntervalMs: number;
  claimThresholdUsd: number;
  port: number;
  webApiUrl: string;
  skipPreflight: boolean;
  sendMaxRetries: number;
  sendRetryDelayMs: number;
  databaseUrl: string;
  rebalanceMaxFrequencyMs: number;
  rebalanceSlippageBps: number;
  keeperAlertWebhook: string;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function str(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OrderFlowConfig {
  return {
    meteoraApiBase: str('METEORA_API_BASE', 'https://dlmm.datapi.meteora.ag'),
    rpcEndpoint: str('RPC_ENDPOINT', 'https://api.mainnet-beta.solana.com'),
    rpcWss: str('RPC_WSS', 'wss://api.mainnet-beta.solana.com'),
    keeperIntervalMs: int('KEEPER_INTERVAL_MS', DEFAULT_KEEPER_INTERVAL_MS),
    claimThresholdUsd: int('CLAIM_THRESHOLD_USD', 1) / 1000,
    port: int('PORT', 8080),
    webApiUrl: str('VITE_API_URL', 'http://localhost:8080'),
    skipPreflight: env['SKIP_PREFLIGHT'] !== 'true',
    sendMaxRetries: int('SEND_MAX_RETRIES', 3),
    sendRetryDelayMs: int('SEND_RETRY_DELAY_MS', 1000),
    databaseUrl: str('DATABASE_URL', ''),
    rebalanceMaxFrequencyMs: int('REBALANCE_MAX_FREQUENCY_MS', 3_600_000),
    rebalanceSlippageBps: int('REBALANCE_SLIPPAGE_BPS', 100),
    keeperAlertWebhook: str('KEEPER_ALERT_WEBHOOK', ''),
  };
}
