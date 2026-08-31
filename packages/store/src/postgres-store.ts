/**
 * Postgres-backed strategy store.
 *
 * Uses proper transactions, connection pooling, and parameterized queries.
 * Falls back to JSON store if DATABASE_URL is not set.
 */

import { Pool, PoolClient } from 'pg';
import { DcaStrategy, DcaOrder, DcaStatus, Side } from '@orderflow/core';

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS strategies (
  strategy_id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  signature TEXT NOT NULL,
  pool TEXT NOT NULL,
  token_mint TEXT NOT NULL,
  side TEXT NOT NULL,
  total_amount NUMERIC NOT NULL,
  total_amount_label TEXT NOT NULL,
  tranches INTEGER NOT NULL,
  interval_seconds INTEGER NOT NULL,
  min_price NUMERIC,
  max_price NUMERIC,
  slippage_bps INTEGER NOT NULL DEFAULT 100,
  rebalance_frequency_ms INTEGER NOT NULL DEFAULT 3600000,
  status TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY,
  strategy_id TEXT NOT NULL REFERENCES strategies(strategy_id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  bin_ids INTEGER[] NOT NULL,
  bin_ids_resolved INTEGER[] NOT NULL,
  price_low NUMERIC NOT NULL,
  price_high NUMERIC NOT NULL,
  amount NUMERIC NOT NULL,
  side TEXT NOT NULL,
  filled NUMERIC NOT NULL DEFAULT 0,
  fees_earned NUMERIC NOT NULL DEFAULT 0,
  filled_amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  last_claimed_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_strategies_owner ON strategies(owner);
CREATE INDEX IF NOT EXISTS idx_strategies_pool ON strategies(pool);
CREATE INDEX IF NOT EXISTS idx_orders_strategy ON orders(strategy_id);
`;

export class PostgresStrategyStore {
  private pool: Pool | null = null;
  private initialized = false;

  constructor(private databaseUrl: string) {}

  private async ensureInitialized() {
    if (this.initialized) return;
    if (!this.databaseUrl) throw new Error('DATABASE_URL is required for PostgresStrategyStore');
    this.pool = new Pool({ connectionString: this.databaseUrl, max: 10 });
    const client = await this.pool.connect();
    try {
      await client.query(INIT_SQL);
    } finally {
      client.release();
    }
    this.initialized = true;
  }

  private async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    await this.ensureInitialized();
    if (!this.pool) throw new Error('Pool not initialized');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  private strategyRowToObj(row: any): DcaStrategy {
    return {
      strategyId: row.strategy_id,
      owner: row.owner,
      signature: row.signature,
      pool: row.pool,
      tokenMint: row.token_mint,
      side: row.side as Side,
      totalAmount: Number(row.total_amount),
      totalAmountLabel: row.total_amount_label,
      tranches: row.tranches,
      intervalSeconds: row.interval_seconds,
      minPrice: row.min_price != null ? Number(row.min_price) : null,
      maxPrice: row.max_price != null ? Number(row.max_price) : null,
      slippageBps: row.slippage_bps,
      rebalanceFrequencyMs: row.rebalance_frequency_ms,
      status: row.status as DcaStatus,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      orders: [],
    };
  }

  private orderRowToObj(row: any): DcaOrder {
    return {
      orderId: row.order_id,
      address: row.address,
      binIds: row.bin_ids,
      binIdsResolved: row.bin_ids_resolved,
      priceLow: Number(row.price_low),
      priceHigh: Number(row.price_high),
      amount: Number(row.amount),
      side: row.side as Side,
      filled: Number(row.filled),
      feesEarned: Number(row.fees_earned),
      filledAmount: Number(row.filled_amount),
      status: row.status as DcaOrder['status'],
      createdAt: row.created_at,
      lastClaimedAt: row.last_claimed_at,
    };
  }

  async list(): Promise<DcaStrategy[]> {
    await this.ensureInitialized();
    if (!this.pool) return [];
    const { rows } = await this.pool.query('SELECT * FROM strategies ORDER BY created_at DESC');
    const strategies = rows.map((r: any) => this.strategyRowToObj(r));
    for (const s of strategies) {
      s.orders = await this.ordersForStrategy(s.strategyId);
    }
    return strategies;
  }

  async byId(id: string): Promise<DcaStrategy | undefined> {
    await this.ensureInitialized();
    if (!this.pool) return undefined;
    const { rows } = await this.pool.query('SELECT * FROM strategies WHERE strategy_id = $1', [id]);
    if (rows.length === 0) return undefined;
    const s = this.strategyRowToObj(rows[0]);
    s.orders = await this.ordersForStrategy(id);
    return s;
  }

  async byPool(pool: string): Promise<DcaStrategy[]> {
    await this.ensureInitialized();
    if (!this.pool) return [];
    const { rows } = await this.pool.query('SELECT * FROM strategies WHERE pool = $1 ORDER BY created_at DESC', [pool]);
    const strategies = rows.map((r: any) => this.strategyRowToObj(r));
    for (const s of strategies) {
      s.orders = await this.ordersForStrategy(s.strategyId);
    }
    return strategies;
  }

  async byOwner(wallet: string): Promise<DcaStrategy[]> {
    await this.ensureInitialized();
    if (!this.pool) return [];
    const { rows } = await this.pool.query('SELECT * FROM strategies WHERE owner = LOWER($1) ORDER BY created_at DESC', [wallet]);
    const strategies = rows.map((r: any) => this.strategyRowToObj(r));
    for (const s of strategies) {
      s.orders = await this.ordersForStrategy(s.strategyId);
    }
    return strategies;
  }

  async upsert(s: DcaStrategy): Promise<void> {
    await this.tx(async (client) => {
      await client.query(
        `INSERT INTO strategies (strategy_id, owner, signature, pool, token_mint, side, total_amount, total_amount_label, tranches, interval_seconds, min_price, max_price, slippage_bps, rebalance_frequency_ms, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         ON CONFLICT (strategy_id) DO UPDATE SET
           owner = EXCLUDED.owner,
           signature = EXCLUDED.signature,
           pool = EXCLUDED.pool,
           token_mint = EXCLUDED.token_mint,
           side = EXCLUDED.side,
           total_amount = EXCLUDED.total_amount,
           total_amount_label = EXCLUDED.total_amount_label,
           tranches = EXCLUDED.tranches,
           interval_seconds = EXCLUDED.interval_seconds,
           min_price = EXCLUDED.min_price,
           max_price = EXCLUDED.max_price,
           slippage_bps = EXCLUDED.slippage_bps,
           rebalance_frequency_ms = EXCLUDED.rebalance_frequency_ms,
           status = EXCLUDED.status,
           updated_at = EXCLUDED.updated_at`,
        [
          s.strategyId,
          s.owner,
          s.signature,
          s.pool,
          s.tokenMint,
          s.side,
          s.totalAmount,
          s.totalAmountLabel,
          s.tranches,
          s.intervalSeconds,
          s.minPrice,
          s.maxPrice,
          s.slippageBps,
          s.rebalanceFrequencyMs,
          s.status,
          s.createdAt,
          s.updatedAt,
        ]
      );

      await client.query('DELETE FROM orders WHERE strategy_id = $1', [s.strategyId]);
      for (const o of s.orders) {
        await client.query(
          `INSERT INTO orders (order_id, strategy_id, address, bin_ids, bin_ids_resolved, price_low, price_high, amount, side, filled, fees_earned, filled_amount, status, created_at, last_claimed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            o.orderId,
            s.strategyId,
            o.address,
            o.binIds,
            o.binIdsResolved,
            o.priceLow,
            o.priceHigh,
            o.amount,
            o.side,
            o.filled,
            o.feesEarned,
            o.filledAmount,
            o.status,
            o.createdAt,
            o.lastClaimedAt,
          ]
        );
      }
    });
  }

  async remove(id: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.pool) return;
    await this.tx(async (client) => {
      await client.query('DELETE FROM orders WHERE strategy_id = $1', [id]);
      await client.query('DELETE FROM strategies WHERE strategy_id = $1', [id]);
    });
  }

  async cancel(id: string): Promise<void> {
    await this.tx(async (client) => {
      await client.query(
        "UPDATE strategies SET status = 'cancelled', updated_at = $1 WHERE strategy_id = $2 AND status != 'cancelled'",
        [Date.now(), id]
      );
    });
  }

  private async ordersForStrategy(strategyId: string): Promise<DcaOrder[]> {
    if (!this.pool) return [];
    const { rows } = await this.pool.query('SELECT * FROM orders WHERE strategy_id = $1 ORDER BY created_at ASC', [strategyId]);
    return rows.map((r: any) => this.orderRowToObj(r));
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.initialized = false;
    }
  }
}
