/**
 * Vault SDK — TypeScript client for the OrderFlow Anchor vault program.
 *
 * Every public method builds one program instruction (or transaction) so the
 * caller composes a transaction.  The keeper never holds a custodial key: it
 * submits transactions as the `crank` wallet (gas/rent payer only).
 *
 * Derivation convention:
 *   vault_pda        = findProgramAddress("vault", owner, nonce)
 *   limit_order_pda  = findProgramAddress("limit_order", vault, tranche_idx)
 *   vault_ata        = getAssociatedTokenAddress(mint, vault)
 *
 * DLMM account resolution (lb_pair, reserves, bin arrays) is done by the
 * caller, who supplies the DLMM pair address and (optionally) the bin arrays
 * as remaining accounts.  The SDK derives the deterministic bin-array PDAs
 * for the requested bin ids so the caller doesn't have to.
 */

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import crypto from "crypto";
import { OrderFlowConfig, loadConfig } from "@orderflow/core";

const ORDERFLOW_PROGRAM = new PublicKey(
  "7WNQhMKbKhZGYw3zYc77KAHS47hcxss2PCkztQui51fR",
);
const DLMM_PROGRAM = new PublicKey(
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
);
const MEMO_PROGRAM = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);

// ─── Anchor discriminator helper ──────────────────────────────────────────────
function ixDiscriminator(name: string): Buffer {
  return crypto
    .createHash("sha256")
    .update(`global:${name}`)
    .digest()
    .subarray(0, 8);
}

// ─── Borsh helpers ────────────────────────────────────────────────────────────
function leU8(v: number) {
  const b = Buffer.alloc(1);
  b.writeUInt8(v);
  return b;
}
function leU16(v: number) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v);
  return b;
}
function leU32(v: number) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v);
  return b;
}
function leI64(v: bigint) {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(v);
  return b;
}
function leU64(v: bigint) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}
function lePubkey(k: PublicKey) {
  return k.toBuffer();
}

function vecI64(vals: number[]): Buffer {
  const buf = [leU32(vals.length)];
  for (const v of vals) buf.push(leI64(BigInt(v)));
  return Buffer.concat(buf);
}

// ─── PDA derivation ───────────────────────────────────────────────────────────
export function vaultPda(owner: PublicKey, nonce: bigint): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), owner.toBuffer(), leU64(nonce)],
    ORDERFLOW_PROGRAM,
  )[0];
}

export function limitOrderPda(vault: PublicKey, trancheIdx: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("limit_order"), vault.toBuffer(), leU16(trancheIdx)],
    ORDERFLOW_PROGRAM,
  )[0];
}

// DLMM bin-array PDA: seeds ["bin_array", lb_pair, index(i64)]
function binArrayPda(lbPair: PublicKey, index: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bin_array"), lbPair.toBuffer(), leI64(BigInt(index))],
    DLMM_PROGRAM,
  )[0];
}

function binIdToBinArrayIndex(binId: number): number {
  // binArrayIndex = binId >> 7 (arithmetic shift right 7 bits, equivalent to divide by 128)
  return Math.floor(binId / 128);
}

/** Derive the unique bin-array account ids required for a set of bin ids. */
export function resolveBinArrayPubkeys(
  lbPair: PublicKey,
  binIds: number[],
): PublicKey[] {
  const indexes = new Set<number>();
  for (const id of binIds) indexes.add(binIdToBinArrayIndex(id));
  return [...indexes].map((idx) => binArrayPda(lbPair, idx));
}

// DLMM bin-array bitmap extension PDA
function binArrayBitmapExtensionPda(lbPair: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bin_array_bitmap_extension"), lbPair.toBuffer()],
    DLMM_PROGRAM,
  )[0];
}

/** If any bin id overflows the default bitmap, return the extension PDA; else DLMM_PROGRAM_ID. */
export function resolveBitmapExtension(
  lbPair: PublicKey,
  binIds: number[],
): PublicKey {
  for (const id of binIds) {
    if (binIdToBinArrayIndex(id) > 0) return binArrayBitmapExtensionPda(lbPair);
  }
  return DLMM_PROGRAM; // placeholder — DLMM accepts its own program id as the "none" sentinel
}

// ─── Instruction builders ─────────────────────────────────────────────────────

/** On-chain status enum (must match lib.rs `VaultStatus`). */
export type OnChainVaultStatus = 0 | 1 | 2 | 3; // Depositing | Active | Completed | Cancelled

/** An open limit order currently owned by the vault (latest tranche). */
export interface PendingLimitOrder {
  address: PublicKey;
  binIds: number[];
}

/** Mirror of `StrategyVault` deserialized from chain. */
export interface OnChainVault {
  owner: PublicKey;
  nonce: bigint;
  pool: PublicKey;
  mint: PublicKey;
  side: "bid" | "ask";
  tranches: number;
  tranchesPlaced: number;
  intervalSeconds: bigint;
  minBinId: bigint;
  maxBinId: bigint;
  trancheAmount: bigint;
  totalCap: bigint;
  amountPlaced: bigint;
  lastPlacedAt: bigint;
  pending: PendingLimitOrder | null;
  status: OnChainVaultStatus;
  bump: number;
}

/** Accounts layout (manual, no IDL dependency). */
export interface CreateVaultAccounts {
  vault: PublicKey;
  owner: PublicKey;
  systemProgram: PublicKey;
  mint: PublicKey;
}

export interface DepositAccounts {
  vault: PublicKey;
  owner: PublicKey;
  mint: PublicKey;
  ownerAta: PublicKey;
  vaultAta: PublicKey;
  tokenProgram: PublicKey;
  systemProgram: PublicKey;
  associatedTokenProgram: PublicKey;
}

export interface PlaceTrancheAccounts {
  vault: PublicKey;
  vaultAta: PublicKey;
  limitOrder: PublicKey;
  crank: PublicKey;
  dlmmProgram: PublicKey;
  lbPair: PublicKey;
  binArrayBitmapExtension: PublicKey;
  reserve: PublicKey;
  tokenMint: PublicKey;
  eventAuthority: PublicKey;
  tokenProgram: PublicKey;
  systemProgram: PublicKey;
}

export interface ClaimFeesAccounts {
  vault: PublicKey;
  vaultAta: PublicKey;
  crank: PublicKey;
  dlmmProgram: PublicKey;
  lbPair: PublicKey;
  binArrayBitmapExtension: PublicKey;
  reserveX: PublicKey;
  reserveY: PublicKey;
  tokenXMint: PublicKey;
  tokenYMint: PublicKey;
  limitOrder: PublicKey;
  ownerTokenX: PublicKey;
  ownerTokenY: PublicKey;
  eventAuthority: PublicKey;
  tokenProgram: PublicKey;
  memoProgram: PublicKey;
}

export interface CancelAccounts {
  vault: PublicKey;
  owner: PublicKey;
}

export interface WithdrawAccounts {
  vault: PublicKey;
  owner: PublicKey;
  mint: PublicKey;
  ownerAta: PublicKey;
  vaultAta: PublicKey;
  tokenProgram: PublicKey;
  systemProgram: PublicKey;
  associatedTokenProgram: PublicKey;
}

// ─── VaultSdk ─────────────────────────────────────────────────────────────────

export class VaultSdk {
  readonly connection: Connection;
  readonly programId: PublicKey;
  readonly cfg: OrderFlowConfig;

  constructor(connection: Connection, cfg?: OrderFlowConfig) {
    this.connection = connection;
    this.programId = ORDERFLOW_PROGRAM;
    this.cfg = cfg ?? loadConfig();
  }

  // ── instruction builders ──────────────────────────────────────────────────

  createVaultIx(
    accounts: CreateVaultAccounts,
    args: {
      nonce: bigint;
      pool: PublicKey;
      mint: PublicKey;
      side: "bid" | "ask";
      tranches: number;
      intervalSeconds: bigint;
      minBinId: number;
      maxBinId: number;
      trancheAmount: bigint;
      totalCap: bigint;
    },
  ): TransactionInstruction {
    const data = Buffer.concat([
      ixDiscriminator("create_vault"),
      leU64(args.nonce),
      lePubkey(args.pool),
      lePubkey(args.mint),
      leU8(args.side === "ask" ? 1 : 0),
      leU16(args.tranches),
      leU64(args.intervalSeconds),
      leI64(BigInt(args.minBinId)),
      leI64(BigInt(args.maxBinId)),
      leU64(args.trancheAmount),
      leU64(args.totalCap),
    ]);

    return new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: accounts.vault, isSigner: false, isWritable: true },
        { pubkey: accounts.owner, isSigner: true, isWritable: true },
        { pubkey: accounts.systemProgram, isSigner: false, isWritable: false },
        { pubkey: accounts.mint, isSigner: false, isWritable: false },
      ],
      data,
    });
  }

  depositIx(accounts: DepositAccounts, amount: bigint): TransactionInstruction {
    const data = Buffer.concat([ixDiscriminator("deposit"), leU64(amount)]);
    return new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: accounts.vault, isSigner: false, isWritable: true },
        { pubkey: accounts.owner, isSigner: true, isWritable: true },
        { pubkey: accounts.mint, isSigner: false, isWritable: false },
        { pubkey: accounts.ownerAta, isSigner: false, isWritable: true },
        { pubkey: accounts.vaultAta, isSigner: false, isWritable: true },
        { pubkey: accounts.tokenProgram, isSigner: false, isWritable: false },
        { pubkey: accounts.systemProgram, isSigner: false, isWritable: false },
        {
          pubkey: accounts.associatedTokenProgram,
          isSigner: false,
          isWritable: false,
        },
      ],
      data,
    });
  }

  /**
   * Place the next tranche as a DLMM limit order.
   *
   * `binIds` must be sorted, contiguous within the bracket, and ≤50.
   * The builder computes the fixed-length `[i64;50]` array padded with
   * i64::MIN sentinels.
   */
  placeTrancheIx(
    accounts: PlaceTrancheAccounts,
    binIds: number[],
    remainingBinArrays: PublicKey[],
  ): TransactionInstruction {
    const padded = new Array(50)
      .fill(0)
      .map(() => BigInt.asIntN(64, BigInt(0)));
    const SENTINEL = BigInt.asIntN(64, BigInt("-9223372036854775808")); // i64::MIN
    for (let i = 0; i < Math.min(binIds.length, 50); i++)
      padded[i] = BigInt(binIds[i]);
    for (let i = binIds.length; i < 50; i++) padded[i] = SENTINEL;

    const data = Buffer.concat([
      ixDiscriminator("place_tranche"),
      Buffer.concat(padded.map((b) => leI64(b))),
    ]);

    const binArrayKeys = remainingBinArrays.map((pubkey) => ({
      pubkey,
      isSigner: false,
      isWritable: true,
    }));

    return new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: accounts.vault, isSigner: false, isWritable: true },
        { pubkey: accounts.vaultAta, isSigner: false, isWritable: true },
        { pubkey: accounts.limitOrder, isSigner: false, isWritable: true },
        { pubkey: accounts.crank, isSigner: true, isWritable: true },
        { pubkey: accounts.dlmmProgram, isSigner: false, isWritable: false },
        { pubkey: accounts.lbPair, isSigner: false, isWritable: true },
        {
          pubkey: accounts.binArrayBitmapExtension,
          isSigner: false,
          isWritable: true,
        },
        { pubkey: accounts.reserve, isSigner: false, isWritable: true },
        { pubkey: accounts.tokenMint, isSigner: false, isWritable: true },
        { pubkey: accounts.eventAuthority, isSigner: false, isWritable: false },
        { pubkey: accounts.tokenProgram, isSigner: false, isWritable: false },
        { pubkey: accounts.systemProgram, isSigner: false, isWritable: false },
        ...binArrayKeys,
      ],
      data,
    });
  }

  claimFeesIx(
    accounts: ClaimFeesAccounts,
    binIds: number[],
    remainingBinArrays: PublicKey[],
  ): TransactionInstruction {
    const data = Buffer.concat([ixDiscriminator("claim_fees"), vecI64(binIds)]);

    const binArrayKeys = remainingBinArrays.map((pubkey) => ({
      pubkey,
      isSigner: false,
      isWritable: true,
    }));

    return new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: accounts.vault, isSigner: false, isWritable: true },
        { pubkey: accounts.vaultAta, isSigner: false, isWritable: true },
        { pubkey: accounts.crank, isSigner: true, isWritable: true },
        { pubkey: accounts.dlmmProgram, isSigner: false, isWritable: false },
        { pubkey: accounts.lbPair, isSigner: false, isWritable: true },
        {
          pubkey: accounts.binArrayBitmapExtension,
          isSigner: false,
          isWritable: true,
        },
        { pubkey: accounts.reserveX, isSigner: false, isWritable: true },
        { pubkey: accounts.reserveY, isSigner: false, isWritable: true },
        { pubkey: accounts.tokenXMint, isSigner: false, isWritable: false },
        { pubkey: accounts.tokenYMint, isSigner: false, isWritable: false },
        { pubkey: accounts.limitOrder, isSigner: false, isWritable: true },
        { pubkey: accounts.ownerTokenX, isSigner: false, isWritable: true },
        { pubkey: accounts.ownerTokenY, isSigner: false, isWritable: true },
        { pubkey: accounts.eventAuthority, isSigner: false, isWritable: false },
        { pubkey: accounts.tokenProgram, isSigner: false, isWritable: false },
        { pubkey: accounts.memoProgram, isSigner: false, isWritable: false },
        ...binArrayKeys,
      ],
      data,
    });
  }

  cancelIx(accounts: CancelAccounts): TransactionInstruction {
    return new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: accounts.vault, isSigner: false, isWritable: true },
        { pubkey: accounts.owner, isSigner: true, isWritable: true },
      ],
      data: ixDiscriminator("cancel"),
    });
  }

  withdrawIx(
    accounts: WithdrawAccounts,
    amount: bigint,
  ): TransactionInstruction {
    const data = Buffer.concat([ixDiscriminator("withdraw"), leU64(amount)]);
    return new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: accounts.vault, isSigner: false, isWritable: true },
        { pubkey: accounts.owner, isSigner: true, isWritable: true },
        { pubkey: accounts.mint, isSigner: false, isWritable: false },
        { pubkey: accounts.ownerAta, isSigner: false, isWritable: true },
        { pubkey: accounts.vaultAta, isSigner: false, isWritable: true },
        { pubkey: accounts.tokenProgram, isSigner: false, isWritable: false },
        { pubkey: accounts.systemProgram, isSigner: false, isWritable: false },
        {
          pubkey: accounts.associatedTokenProgram,
          isSigner: false,
          isWritable: false,
        },
      ],
      data,
    });
  }

  // ── high-level helpers ────────────────────────────────────────────────────

  /** Derive all PDAs + ATAs for a given vault. */
  vaultAddresses(owner: PublicKey, nonce: bigint, mint: PublicKey) {
    const vault = vaultPda(owner, nonce);
    return {
      vault,
      vaultAta: getAssociatedTokenAddressSync(mint, vault, true),
      mint,
    };
  }

  /**
   * Fetch + deserialize an on-chain `StrategyVault` account.
   *
   * Returns null if the account does not exist. This is the **source of truth**
   * for keeper decisions — `tranches_placed` in particular, which determines
   * the next limit-order PDA index. Do not derive the tranche index from local
   * state; doing so races with other cranks.
   */
  async fetchVault(vault: PublicKey): Promise<OnChainVault | null> {
    const info = await this.connection.getAccountInfo(vault, "confirmed");
    if (!info) return null;
    const data = info.data;
    if (
      data.length <
      8 + 32 + 8 + 32 + 32 + 1 + 2 + 2 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 1 + 1 + 1
    ) {
      throw new Error(`vault account too small: ${data.length} bytes`);
    }
    let o = 8; // skip discriminator
    const owner = new PublicKey(data.subarray(o, o + 32));
    o += 32;
    const nonce = data.readBigUInt64LE(o);
    o += 8;
    const pool = new PublicKey(data.subarray(o, o + 32));
    o += 32;
    const mint = new PublicKey(data.subarray(o, o + 32));
    o += 32;
    const side: "bid" | "ask" = data[o] === 1 ? "ask" : "bid";
    o += 1;
    const tranches = data.readUInt16LE(o);
    o += 2;
    const tranchesPlaced = data.readUInt16LE(o);
    o += 2;
    const intervalSeconds = data.readBigUInt64LE(o);
    o += 8;
    const minBinId = data.readBigInt64LE(o);
    o += 8;
    const maxBinId = data.readBigInt64LE(o);
    o += 8;
    const trancheAmount = data.readBigUInt64LE(o);
    o += 8;
    const totalCap = data.readBigUInt64LE(o);
    o += 8;
    const amountPlaced = data.readBigUInt64LE(o);
    o += 8;
    const lastPlacedAt = data.readBigInt64LE(o);
    o += 8;
    const hasPending = data[o];
    o += 1;
    let pending: PendingLimitOrder | null = null;
    if (hasPending === 1) {
      const address = new PublicKey(data.subarray(o, o + 32));
      o += 32;
      const vecLen = data.readUInt32LE(o);
      o += 4;
      const binIds: number[] = [];
      for (let i = 0; i < vecLen; i++) {
        binIds.push(Number(data.readBigInt64LE(o)));
        o += 8;
      }
      pending = { address, binIds };
    }
    const status = data[o] as 0 | 1 | 2 | 3;
    o += 1;
    const bump = data[o];
    return {
      owner,
      nonce,
      pool,
      mint,
      side,
      tranches,
      tranchesPlaced,
      intervalSeconds,
      minBinId,
      maxBinId,
      trancheAmount,
      totalCap,
      amountPlaced,
      lastPlacedAt,
      pending,
      status,
      bump,
    };
  }

  /** Derive the limit-order PDA for a specific tranche index. */
  limitOrderForTranche(vault: PublicKey, trancheIdx: number) {
    return limitOrderPda(vault, trancheIdx);
  }

  /** Derive bin-array remaining-account PDAs for a set of bin ids. */
  binArrays(lbPair: PublicKey, binIds: number[]) {
    return resolveBinArrayPubkeys(lbPair, binIds);
  }

  /** Derive the DLMM event-authority PDA. */
  dlmmEventAuthority(): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("__event_authority")],
      DLMM_PROGRAM,
    )[0];
  }

  /** DLMM bin-array bitmap extension (or sentinel if not needed). */
  bitmapExtension(lbPair: PublicKey, binIds: number[]): PublicKey {
    return resolveBitmapExtension(lbPair, binIds);
  }

  /**
   * Convenience: build a full `place_tranche` transaction.
   *
   * This is what the keeper calls each tick. The crank keypair (gas payer)
   * must be supplied externally — the SDK never holds it.
   */
  async buildPlaceTrancheTx(opts: {
    crank: Keypair;
    owner: PublicKey;
    vaultNonce: bigint;
    trancheIdx: number;
    binIds: number[];
    lbPair: PublicKey;
    reserve: PublicKey; // reserve for the token being sold
    tokenMint: PublicKey; // the token being sold (must match vault.mint)
  }): Promise<Transaction> {
    const vault = vaultPda(opts.owner, opts.vaultNonce);
    const vaultAta = getAssociatedTokenAddressSync(opts.tokenMint, vault, true);
    const limitOrder = limitOrderPda(vault, opts.trancheIdx);
    const binArrays = resolveBinArrayPubkeys(opts.lbPair, opts.binIds);
    const bitmapExt = resolveBitmapExtension(opts.lbPair, opts.binIds);
    const eventAuth = this.dlmmEventAuthority();

    const ix = this.placeTrancheIx(
      {
        vault,
        vaultAta,
        limitOrder,
        crank: opts.crank.publicKey,
        dlmmProgram: DLMM_PROGRAM,
        lbPair: opts.lbPair,
        binArrayBitmapExtension: bitmapExt,
        reserve: opts.reserve,
        tokenMint: opts.tokenMint,
        eventAuthority: eventAuth,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      },
      opts.binIds,
      binArrays,
    );

    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash();
    const tx = new Transaction({
      blockhash,
      lastValidBlockHeight,
      feePayer: opts.crank.publicKey,
    }).add(ix);
    return tx;
  }

  /**
   * Convenience: build a full `claim_fees` transaction for a specific
   * limit-order order (with known bin ids).
   */
  async buildClaimFeesTx(opts: {
    crank: Keypair;
    owner: PublicKey;
    vaultNonce: bigint;
    limitOrder: PublicKey;
    binIds: number[];
    lbPair: PublicKey;
    reserveX: PublicKey;
    reserveY: PublicKey;
    tokenXMint: PublicKey;
    tokenYMint: PublicKey;
  }): Promise<Transaction> {
    const vault = vaultPda(opts.owner, opts.vaultNonce);
    const vaultAtaX = getAssociatedTokenAddressSync(
      opts.tokenXMint,
      vault,
      true,
    );
    const vaultAtaY = getAssociatedTokenAddressSync(
      opts.tokenYMint,
      vault,
      true,
    );
    const binArrays = resolveBinArrayPubkeys(opts.lbPair, opts.binIds);
    const bitmapExt = resolveBitmapExtension(opts.lbPair, opts.binIds);
    const eventAuth = this.dlmmEventAuthority();

    const ix = this.claimFeesIx(
      {
        vault,
        vaultAta: vaultAtaX, // vault ATA for the mint being claimed; for cancel, DLMM sends to ownerTokenX/Y
        crank: opts.crank.publicKey,
        dlmmProgram: DLMM_PROGRAM,
        lbPair: opts.lbPair,
        binArrayBitmapExtension: bitmapExt,
        reserveX: opts.reserveX,
        reserveY: opts.reserveY,
        tokenXMint: opts.tokenXMint,
        tokenYMint: opts.tokenYMint,
        limitOrder: opts.limitOrder,
        ownerTokenX: vaultAtaX,
        ownerTokenY: vaultAtaY,
        eventAuthority: eventAuth,
        tokenProgram: TOKEN_PROGRAM_ID,
        memoProgram: MEMO_PROGRAM,
      },
      opts.binIds,
      binArrays,
    );

    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash();
    return new Transaction({
      blockhash,
      lastValidBlockHeight,
      feePayer: opts.crank.publicKey,
    }).add(ix);
  }
}

export default VaultSdk;
