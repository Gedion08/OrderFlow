/**
 * OrderFlow read-layer HTTP API.
 *
 * Routes:
 *   GET /health
 *   GET /api/pools                      -> pool search (Meteora-backed)
 *   GET /api/pools/:address             -> single pool
 *   GET /api/book/:address              -> orderbook-style book view (A primary)
 *   GET /api/strategies/:wallet         -> a wallet's OrderFlow strategies
 *   POST /api/strategies                -> create a strategy (keeper picks it up)
 *   DELETE /api/strategies/:id          -> cancel a strategy
 *   GET /api/limit-orders/:wallet       -> a wallet's DLMM limit orders
 *   GET /api/portfolio/:wallet          -> a wallet's per-pool positions + PnL
 *   GET /api/positions/:pool/:wallet    -> a wallet's positions in one pool
 *
 * The wallet routes delegate to the official Meteora Data API so OrderFlow
 * gets the exact same live data the meteora.ag UI shows, without re-indexing.
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { resolveRepoRoot, DcaStrategy, binFromPriceFloor } from '@orderflow/core';
import { createMeteoraClient } from './meteora-client';
import { buildBook } from './book';
import { StrategyStore } from './strategy-store';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const meteora = createMeteoraClient();
  const store = new StrategyStore(process.env.STORE_FILE ?? path.join(resolveRepoRoot(), 'data', 'strategies.json'));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'orderflow-api', ts: Date.now() });
  });

  // --- Pool search ------------------------------------------------
  app.get('/api/pools', async (req, res, next) => {
    try {
      const limit = Number(req.query.limit) || 20;
      const offset = Number(req.query.offset) || 0;
      const q = String(req.query.q ?? '').trim().toLowerCase();
      let data = await meteora.pools(limit, offset);
      if (q) {
        const pools = Array.isArray(data) ? (data as any[]) : [];
        const norm = (s: string) => s.replace(/[\/\s-]+/g, '').toLowerCase();
        data = pools.filter((p) =>
          [p.name, p.symbol, p.address, p.token_x_uri, p.token_y_uri]
            .filter(Boolean)
            .some((field: string) => norm(String(field)).includes(norm(q))),
        );
      }
      res.json({ pools: data });
    } catch (e) { next(e); }
  });

  app.get('/api/pools/:address', async (req, res, next) => {
    try {
      res.json(await meteora.pool(req.params.address));
    } catch (e) { next(e); }
  });

  // --- Orderbook view ---------------------------------------------
  app.get('/api/book/:address', async (req, res, next) => {
    try {
      const pool = await meteora.pool(req.params.address);
      const binStep = Number(pool?.bin_step ?? pool?.binStep ?? pool?.pool_config?.bin_step ?? 100);
      const currentPrice = Number(pool?.current_price ?? 0);
      const activeBinId = currentPrice > 0 ? binFromPriceFloor(currentPrice, binStep) : 0;
      const bins: any[] = [];
      const half = Math.max(1, Math.floor(bins.length / 2));
      const asks = bins.slice(half);
      const bidBases = bins.slice(0, half);
      const toRaw = (raw: any[]) =>
        raw.map((b) => ({
          binId: Number(b.bin_id ?? b.binId ?? b.price),
          amount: Number(b.base_amount ?? b.baseAmount ?? b.market_amount ?? 0),
          feeAmountX: Number(b.fee_x ?? b.feeAmountX ?? 0),
          feeAmountY: Number(b.fee_y ?? b.feeAmountY ?? 0),
        }));

      const strategies = store.byPool(req.params.address);

      res.json(buildBook({
        poolAddress: req.params.address,
        binStep,
        activeBinId,
        binBases: toRaw(bidBases),
        binAsks: toRaw(asks),
        tokenX: {
          mint: String(pool?.token_x?.address ?? pool?.tokenX?.mint ?? ''),
          symbol: String(pool?.token_x?.symbol ?? pool?.tokenX?.symbol ?? ''),
          decimals: Number(pool?.token_x?.decimals ?? pool?.tokenX?.decimals ?? 6),
        },
        tokenY: {
          mint: String(pool?.token_y?.address ?? pool?.tokenY?.mint ?? ''),
          symbol: String(pool?.token_y?.symbol ?? pool?.tokenY?.symbol ?? ''),
          decimals: Number(pool?.token_y?.decimals ?? pool?.tokenY?.decimals ?? 6),
        },
        poolTokenSymbol: pool?.token_x?.symbol ?? pool?.poolTokenSymbol ?? '',
        poolQuoteSymbol: pool?.token_y?.symbol ?? pool?.poolQuoteSymbol ?? '',
        strategies,
      }));
    } catch (e) { next(e); }
  });

  // --- Strategy CRUD (web -> keeper persistence) ------------------
  app.get('/api/strategies/:wallet', async (req, res) => {
    res.json({ strategies: store.byOwner(req.params.wallet) });
  });

  app.post('/api/strategies', async (req, res, next) => {
    try {
      const body = req.body as Partial<DcaStrategy>;
      if (!body.owner || !body.pool) {
        res.status(400).json({ error: 'owner and pool are required' });
        return;
      }
      const strategy: DcaStrategy = {
        strategyId: body.strategyId ?? `strat-${Date.now()}`,
        owner: body.owner,
        pool: body.pool,
        tokenMint: body.tokenMint ?? '',
        side: body.side ?? 'bid',
        totalAmount: body.totalAmount ?? 0,
        totalAmountLabel: body.totalAmountLabel ?? '',
        tranches: body.tranches ?? 1,
        intervalSeconds: body.intervalSeconds ?? 0,
        minPrice: body.minPrice ?? null,
        maxPrice: body.maxPrice ?? null,
        status: 'scheduled',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        orders: [],
      };
      store.upsert(strategy);
      res.status(201).json({ strategy });
    } catch (e) { next(e); }
  });

  app.delete('/api/strategies/:id', async (req, res) => {
    store.cancel(req.params.id);
    res.json({ ok: true });
  });

  // --- Wallet routes (Meteora Data API backed) --------------------
  app.get('/api/limit-orders/:wallet', async (req, res, next) => {
    try {
      res.json(await meteora.limitOrders(req.params.wallet));
    } catch (e) { next(e); }
  });

  app.get('/api/portfolio/:wallet', async (req, res, next) => {
    try {
      res.json(await meteora.portfolio(req.params.wallet));
    } catch (e) { next(e); }
  });

  app.get('/api/positions/:pool/:wallet', async (req, res, next) => {
    try {
      res.json(await meteora.positions(req.params.pool, req.params.wallet));
    } catch (e) { next(e); }
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[orderflow-api] error:', err?.message ?? err);
    res.status(500).json({ error: err?.message ?? 'internal error' });
  });

  return app;
}
