# OrderFlow

**Self-executing DCA, take-profit and auto-rebalancing terminal powered by Meteora DLMM limit orders.**

> While your "buy the dip" / "take profit" order waits for the price, it stays live
> on a Meteora DLMM bin as real on-chain liquidity — **earning LP fees**. That's the
> DCA-with-yield loop only DLMM makes possible.

## The idea

DLMM is the only place on Solana where a **limit order is also productive liquidity**.
No matching engine, no off-chain bot — just swap flow filling your bins, and you get
paid while you wait. OrderFlow wraps that engine behind a "set it and forget it" UX.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  apps/web  (Vite + React)                                       │
│  • "Set it & forget it" wizard (amount→token→tranches→go)       │
│  • Live orderbook-style dashboard (/api/book/:pool)             │
└───────────────┬───────────────────────────────┬─────────────────┘
                │  HTTP (read)                  │
┌───────────────▼───────────────────────────────▼─────────────────┐
│  packages/api  (Express read layer)                             │
│  /api/pools  /api/book/:pool  /api/limit-orders/:w              │
│  /api/portfolio/:w  /api/positions/:pool/:w                     │
│   └── MeteoraApiClient → dlmm-api.meteora.ag (official Data API)│
└───────────────▲───────────────────────────────┬─────────────────┘
                │ store                        │ executes
┌───────────────┴───────────────────────────────▼─────────────────┐
│  packages/keeper  (cron/keeper)                                  │
│  • advance scheduled tranches → place DLMM limit orders          │
│  • re-pin LP positions around active bin                         │
│  • claim fees from owned bins                                     │
│   └── OrderFlowSdk → @meteora-ag/dlmm + @meteora-ag/zap-sdk     │
└───────────────────────────────┬──────────────────────────────────┘
                                │ CPI
┌───────────────────────────────▼──────────────────────────────────┐
│  Meteora DLMM (lb_clmm) · Zap · DBC — Solana mainnet             │
└──────────────────────────────────────────────────────────────────┘

packages/anchor — on-chain DcaStrategy ledger (Anchor, optional coordinator)
```

## Repo layout

| Path | What it is |
|---|---|
| `packages/core` | Shared types, constants, config, DLMM bin math (dependency-free) |
| `packages/sdk` | `OrderFlowSdk` — wraps `@meteora-ag/dlmm` + `@meteora-ag/zap-sdk` |
| `packages/api` | Express read layer proxying Meteora's Data API |
| `packages/keeper` | Cron/keeper: places tranches, re-pins bins, claims fees |
| `packages/anchor` | Solana program storing DCA state on-chain (skeleton + tests) |
| `apps/web` | React frontend: wizard + orderbook dashboard |

## Quick start

> **Requires Node >= 20.18** — the keeper/runtime pulls Solana's `rpc-websockets`
> which ships ESM-only in recent versions and errors on Node 18.

```bash
npm install

# 1) read layer
cp .env.example .env          # set RPC + keeper key for live execution
npm run dev:api               # Express on :8080

# 2) keeper (execution)
npm run dev:keeper            # needs KEEPER_PRIVATE_KEY

# 3) web
npm run dev:web               # Vite on :5173, points at /api proxy
```

## Building

```bash
npm run build                 # core + sdk + api + keeper
npm run build:web             # frontend
```

## Data model

The shared core types (`packages/core/src/types.ts`) drive the whole system:

- **`DcaStrategy`** — a user's plan: pool, side, total amount, tranche count,
  interval, price brackets, plus its `DcaOrder[]`.
- **`DcaOrder`** — one DLMM limit order (one or more bins): address, resolved bin
  ids, price range, amount, `filled`, `feesEarned`, status.
- **`BookView` / `BinQuote`** — the orderbook read model rendered by the dashboard.

## How the DCA-with-yield loop works

1. The **wizard** turns "amount + tranches + timeframe" into a set of price brackets.
2. The **keeper** spreads those brackets across DLMM bins
   (`spreadBinsBetweenBrackets` in `packages/core/src/bin-math.ts`) and places each
   tranche via `@meteora-ag/dlmm` `createLimitOrder` — a real on-chain order.
3. While price never reaches a bin, the order **still earns the LP fee share** on
   swap flow that touches it (DLMM credits 50% of the limit-order fee portion to
   order participants).
4. The **keeper loop** claims those fees (above a threshold) and re-pins any LP
   positions that drifted out of range.

## Production notes

- Replace the JSON `StrategyStore` with a real DB for horizontal keeper scaling.
- Set a KEEPER key on a dedicated cluster; guard with the Anchor program if you
  want on-chain authorization of `record_tranche`.
- The Anchor program (`packages/anchor`) is an optional coordinator. Execution is
  delegated to Meteora's battle-tested programs via CPI / the official SDKs.

## Safety

This is a reference implementation of a novel DeFi UX. DLMM limit orders are not
guaranteed to fill and concentrated liquidity requires active management — the
keeper automates that, but always audit the Anchor program before mainnet custody.
