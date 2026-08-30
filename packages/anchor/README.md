# OrderFlow Anchor program

The Solana program that stores DCA strategy state on-chain and performs CPI into
Meteora's DLMM (`lb_clmm`) to place/claim/cancel limit orders.

## Layout

```
programs/orderflow/src/lib.rs   # Anchor program (skeleton)
programs/orderflow/Cargo.toml   # Rust manifest
tests/                          # TS integration tests (anchor test)
migrations/deploy.js            # anchor deploy hook
Anchor.toml                     # workspace config
```

## Prerequisites

- Rust + `anchor-cli` (>= 0.29): `cargo install --git https://github.com/coral-xyz/anchor avm`
- Solana CLI: `solana --version`

## Build & test

```bash
anchor build
anchor test
```

## How it fits

The program is intentionally thin: it stores the DCA schedule and routes
executions through the existing, battle-tested Meteora programs rather than
re-implementing AMM math. See `programs/orderflow/src/lib.rs` for the account
model and instruction set.
