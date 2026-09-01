# OrderFlow Anchor program

The non-custodial vault program for OrderFlow. It owns a `StrategyVault` PDA per
strategy and performs CPI into Meteora's DLMM (`lb_clmm`) to place/claim/cancel
limit orders — but only subject to the bounds the owner recorded at creation.

## Security property

A user deposits into a `StrategyVault` PDA (seeded `[vault, owner, nonce]`) that
the program owns. No party has a private key for the vault: every token move is
authorized on-chain via `invoke_signed` against the vault seeds. The keeper is a
permissionless crank that can only trigger pre-authorized calls
(`place_tranche`, `claim_fees`); it can never exceed the stored price bracket /
cadence / total cap, and can never redirect funds anywhere the vault does not own.

## Instructions

| Instruction | Signer | Effect |
|---|---|---|
| `create_vault` | owner | Records bounds (mint, bracket as bin ids, tranche size, cadence, total cap) |
| `deposit` | owner | Moves tokens from owner ATA into vault ATA |
| `place_tranche` | crank (permissionless) | Validates bounds on-chain, then CPIs DLMM `place_limit_order` as the vault |
| `claim_fees` | crank (permissionless) | CPIs DLMM `cancel_limit_order`; funds return to the vault |
| `cancel` | owner | Marks cancelled (no further tranches) |
| `withdraw` | owner | Sweeps vault balance to the owner |

## Layout

```
programs/orderflow/src/lib.rs   # Anchor vault program
programs/orderflow/Cargo.toml   # Rust manifest
tests/orderflow.ts              # TS integration tests (anchor test)
Anchor.toml                     # workspace config
```

## Prerequisites

- Rust + `anchor-cli` (>= 0.29): `cargo install --git https://github.com/coral-xyz/anchor avm`
- Solana CLI: `solana --version`
- Node >= 20.18 for the TS test runner.

## Build & test

```bash
anchor build
anchor test
```

> The program's DLMM CPI uses exact byte-level instruction serialization
> (discriminator + borsh args) matching the published `lb_clmm` IDL, so it does
> not depend on a generated `lb_clmm` Rust crate. Validate against devnet before
> deploying to mainnet.

## How it fits

User funds are custodial-free by construction: they sit in the vault PDA under
program rules anyone can audit, and the keeper is reduced to a gas-paying crank.
