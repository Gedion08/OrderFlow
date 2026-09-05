import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import { Orderflow } from "../target/types/orderflow";
import idl from "../target/idl/orderflow.json";

const { SystemProgram } = anchor.web3;

// OrderFlow program id (must match lib.rs declare_id!)
const PROGRAM_ID = new anchor.web3.PublicKey("7WNQhMKbKhZGYw3zYc77KAHS47hcxss2PCkztQui51fR");

describe("orderflow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = new Program(idl as any, PROGRAM_ID, provider) as Program<Orderflow>;

  const owner = provider.wallet.publicKey;
  const nonce = new anchor.BN(Date.now() % 0xffffffff);
  const pool = anchor.web3.Keypair.generate().publicKey;
  const mint = anchor.web3.Keypair.generate().publicKey;

  function vaultPda(ownerKey: anchor.web3.PublicKey, n: anchor.BN) {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), ownerKey.toBuffer(), n.toArrayLike(Buffer, "le", 8)],
      PROGRAM_ID
    );
  }

  it("creates a vault", async () => {
    const [vault] = vaultPda(owner, nonce);
    const tx = await program.methods
      .createVault(
        nonce,
        pool,
        mint,
        { bid: {} },
        10,               // tranches
        new anchor.BN(3600), // interval_seconds
        new anchor.BN(100),  // min_bin_id
        new anchor.BN(200),  // max_bin_id
        new anchor.BN(1_000_000), // tranche_amount
        new anchor.BN(10_000_000) // total_cap
      )
      .accounts({
        vault,
        owner,
        systemProgram: SystemProgram.programId,
        mint,
      })
      .rpc();

    const v = await program.account.strategyVault.fetch(vault);
    expect(v.tranches).to.equal(10);
    expect(v.trancheAmount.toString()).to.equal("1000000");
    expect(v.totalCap.toString()).to.equal("10000000");
    expect(v.status.depositing).to.equal(true);
    expect(tx).to.be.a("string");
  });
});
