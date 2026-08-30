/**
 * OrderFlow read-layer HTTP API.
 *
 * Routes:
 *   GET /health
 *   GET /api/pools                      -> pool search (Meteora-backed)
 *   GET /api/pools/:address             -> single pool
 *   GET /api/book/:address              -> orderbook-style book view (A primary)
 *   GET /api/limit-orders/:wallet       -> a wallet's DLMM limit orders
 *   GET /api/portfolio/:wallet          -> a wallet's per-pool positions + PnL
 *   GET /api/positions/:pool/:wallet    -> a wallet's positions in one pool
 *
 * The wallet routes delegate to the official Meteora Data API so OrderFlow
 * gets the exact same live data the meteora.ag UI shows, without re-indexing.
 */

import express from 'express';
import cors from 'cors';
import { loadConfig } from '@orderflow/core';
import { createMeteoraClient } from './meteora-client';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const meteora = createMeteoraClient();

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'orderflow-api', ts: Date.now() });
  });

  // --- Pool search ------------------------------------------------
  app.get('/api/pools', async (req, res, next) => {
    try {
      const limit = Number(req.query.limit) || 20;
      const offset = Number(req.query.offset) || 0;
      const data = await meteora.pools(limit, offset);
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
      const binStep = Number(pool?.bin_step ?? pool?.binStep ?? 100);
      const activeBinId = Number(pool?.active_bin ?? pool?.activeBinId ?? 0);
      // The Data API returns bin data in `pool.bins` for the row around active.
      const bins = Array.isArray(pool?.bins) ? pool.bins : [];
      const half = Math.max(1, Math.floor(bins.length / 2));
      const asks = bins.slice(half);
      const bidBases = bins.slice(0, half);
      const toBins = (raw: any[]) =>
        raw.map((b) => ({
          binId: Number(b.bin_id ?? b.binId ?? b.price),
          amount: Number(b.base_amount ?? b.baseAmount ?? b.market_amount ?? 0),
          feeAmountX: Number(b.fee_x ?? b.feeAmountX ?? 0),
          feeAmountY: Number(b.fee_y ?? b.feeAmountY ?? 0),
        }));
      res.json({
        pool: req.params.address,
        activeBinId,
        activeBinPrice: Math.pow(1 + binStep * 0.0001, activeBinId),
        binStep,
        tokenX: pool?.token_x ?? pool?.tokenX ?? null,
        tokenY: pool?.token_y ?? pool?.tokenY ?? null,
        poolTokenSymbol: pool?.pool_token_symbol ?? pool?.pool_symbol ?? '',
        poolQuoteSymbol: pool?.pool_quote_symbol ?? pool?.quote_symbol ?? '',
        asks: toBins(asks).sort((a, b) => a.binId - b.binId),
        bids: toBins(bidBases).sort((a, b) => b.binId - a.binId),
        fetchedAt: Date.now(),
      });
    } catch (e) { next(e); }
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
