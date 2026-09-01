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
                │  HTTP (read) + owner-signed create/deposit
┌───────────────▼───────────────────────────────▼─────────────────┐
│  packages/api  (Express read layer)                             │
│  /api/pools  /api/book/:pool  /api/limit-orders/:w              │
│  /api/portfolio/:w  /api/positions/:pool/:w                     │
│   └── MeteoraApiClient → dlmm-api.meteora.ag (official Data API)│
└───────────────▲───────────────────────────────┬─────────────────┘
                │ store                        │ crank
┌───────────────┴───────────────────────────────▼─────────────────┐
│  packages/keeper  (permissionless crank caller)                 │
│  • CRANK_PRIVATE_KEY = gas/rent payer ONLY (never custodial)    │
│  • triggers place_tranche / claim_fees on due vaults            │
│   └── VaultSdk → OrderFlow Anchor program (on-chain vault)      │
└───────────────────────────────┬──────────────────────────────────┘
                                │ CPI (vault PDA signs invariant-secure calls)
┌───────────────────────────────▼──────────────────────────────────┐
│  packages/anchor (OrderFlow vault program)                      │
│  • StrategyVault PDA per (owner, nonce) holds user funds        │
│  • enforces price bracket, cadence, total cap on-chain          │
└───────────────────────────────┬──────────────────────────────────┘
                                │ CPI
┌───────────────────────────────▼──────────────────────────────────┐
│  Meteora DLMM (lb_clmm) — Solana mainnet                         │
└──────────────────────────────────────────────────────────────────┘
```

## Repo layout

| Path | What it is |
|---|---|
| `packages/core` | Shared types, constants, config, DLMM bin math (dependency-free) |
| `packages/sdk` | `VaultSdk` — builds OrderFlow vault instructions + DLMM CPI; `OrderFlowSdk` (legacy direct-DLMM) |
| `packages/api` | Express read layer proxying Meteora's Data API |
| `packages/keeper` | Crank loop: triggers pre-authorized vault instructions |
| `packages/anchor` | Solana program owning per-strategy vault PDAs (non-custodial) |
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
npm run dev:keeper            # needs CRANK_PRIVATE_KEY (gas payer, non-custodial)

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
2. The owner signs a **non-custodial vault** transaction: `create_vault` (records the
   bounds — token mint, price bracket, tranche size, cadence, total cap) plus
   `deposit` (moves tokens into the program-owned vault PDA).
3. The **keeper** is now a *permissionless crank caller*. It spreads each tranche
   across a DLMM bin and triggers `place_tranche` — but the **on-chain program
   re-validates** the cadence, price bracket, and remaining cap before it lets the
   call through, signing the DLMM limit order as the vault PDA. A compromised or
   malicious crank cannot exceed the bounds and cannot route funds anywhere the
   vault does not own.
4. While price never reaches a bin, the limit order **still earns the LP fee share**
   on swap flow (DLMM credits 50% of the limit-order fee portion to participants).
5. The keeper triggers `claim_fees`; fees and remaining principal return **to the
   vault PDA**, never to the keeper. The owner can `withdraw` at any time.

## Custody & security model

**No party holds a private key for user funds.**

- User tokens live in a `StrategyVault` PDA derived from `(owner, nonce)`. The
  OrderFlow program is the only authority that can move them, via `invoke_signed`.
- The keeper's `CRANK_PRIVATE_KEY` pays gas/rent only. It can spam
  `place_tranche`/`claim_fees` harmlessly because every call is re-validated
  against on-chain state.
- `withdraw` and `cancel` are owner-signed and always available; the keeper can
  never trigger them.

## Production notes

- Replace the JSON `StrategyStore` with a real DB for horizontal keeper scaling.
- `CRANK_PRIVATE_KEY` is a disposable gas wallet. `KEEPER_PRIVATE_KEY` is kept as a
  legacy alias but carries **no custodial power** in the vault flow.
- **Audit the Anchor program (`packages/anchor`) before mainnet custody.** The
  program is the trust floor; nothing else matters without it.

## Safety

This is a reference implementation of a novel DeFi UX. DLMM limit orders are not
guaranteed to fill and concentrated liquidity requires active management — the
keeper automates that, but always audit the Anchor program before mainnet custody.
