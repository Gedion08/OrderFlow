import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import { Orderflow } from "../target/types/orderflow";

const { SystemProgram, Keypair } = anchor.web3;

describe("orderflow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Orderflow as Program<Orderflow>;

  const owner = provider.wallet.publicKey;
  const pool = Keypair.generate().publicKey;

  it("creates a strategy", async () => {
    const tx = await program.methods
      .createStrategy(
        pool,
        { bid: {} },
        new anchor.BN(100_000_000),
        10,
        3600,
        new anchor.BN(1_000_000),
        new anchor.BN(2_000_000)
      )
      .accounts({
        strategy: strategyPda(owner, pool)[0],
        owner,
        pool,
      })
      .rpc();

    const s = await program.account.strategy.fetch(strategyPda(owner, pool)[0]);
    expect(s.tranches).to.equal(10);
    expect(s.status.scheduled).to.equal(true);
    expect(tx).to.be.a("string");
  });
});

function strategyPda(owner: anchor.web3.PublicKey, pool: anchor.web3.PublicKey) {
  return anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("strategy"), owner.toBuffer(), pool.toBuffer()],
    new anchor.web3.PublicKey("AnChOrFlow11111111111111111111111111111111")
  );
}
