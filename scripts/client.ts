import {buildEpochBatch, EPOCHS_PER_TRANSACTION} from "./epoch-batch";
import * as anchor from "@anchor-lang/core";
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import fs from "node:fs";
import path from "node:path";

export const bn = (value: number | bigint | string) => new anchor.BN(value.toString());
export function loadProgram(provider: anchor.AnchorProvider): anchor.Program {
  const idl = JSON.parse(fs.readFileSync(path.resolve("target/idl/vestra.json"), "utf8"));
  return new anchor.Program(idl, provider);
}

export class VestraClient {
  constructor(readonly program: anchor.Program) {}
  pda(...seeds: Buffer[]): PublicKey {
    return PublicKey.findProgramAddressSync(seeds, this.program.programId)[0];
  }
  u64(value: number | bigint): Buffer {
    const result = Buffer.alloc(8);
    result.writeBigUInt64LE(BigInt(value));
    return result;
  }
  launch(base: PublicKey, authority: PublicKey): PublicKey {
    return this.pda(Buffer.from("launch"), base.toBuffer(), authority.toBuffer());
  }
  epoch(launch: PublicKey, index: number | bigint): PublicKey {
    return this.pda(Buffer.from("epoch"), launch.toBuffer(), this.u64(index));
  }
  position(launch: PublicKey, owner: PublicKey, nonce: number | bigint): PublicKey {
    return this.pda(Buffer.from("position"), launch.toBuffer(), owner.toBuffer(), this.u64(nonce));
  }
  principal(launch: PublicKey): PublicKey {
    return this.pda(Buffer.from("principal"), launch.toBuffer());
  }
  rewards(launch: PublicKey): PublicKey {
    return this.pda(Buffer.from("rewards"), launch.toBuffer());
  }
  // Dynamic IDL account namespace until generated types are available.
  async launchState(launch: PublicKey): Promise<any> {
    return (this.program.account as any).launch.fetch(launch);
  }
  async positionState(position: PublicKey): Promise<any> {
    return (this.program.account as any).lockPosition.fetch(position);
  }
  async epochState(launch: PublicKey, index: number): Promise<any> {
    return (this.program.account as any).epoch.fetch(this.epoch(launch, index));
  }
  async ensureEpoch(launch: PublicKey, index: number, payer: PublicKey): Promise<void> {
    const epoch = this.epoch(launch, index);
    const connection = this.program.provider.connection;
    if (await connection.getAccountInfo(epoch)) return;
    try {
      await this.program.methods.createEpoch(bn(index)).accountsStrict({
        payer, launch, epoch, systemProgram: SystemProgram.programId,
      }).rpc();
    } catch (error) {
      // Another keeper may have created exactly this PDA. Otherwise propagate.
      if (!(await connection.getAccountInfo(epoch))) throw error;
    }
  }
  async epochBatch(launch: PublicKey, start: number, count: number, payer: PublicKey, quoteMint: PublicKey, treasury: PublicKey): Promise<Transaction> {
    if (!Number.isInteger(count) || count < 1 || count > EPOCHS_PER_TRANSACTION) throw new Error("Invalid epoch batch size");
    const accounts = await this.program.provider.connection.getMultipleAccountsInfo(
      Array.from({length: count}, (_, i) => this.epoch(launch, start + i + 1)), "confirmed",
    );
    return buildEpochBatch(start, count, accounts.map(Boolean), async index =>
      this.program.methods.createEpoch(bn(index)).accountsStrict({
        payer, launch, epoch: this.epoch(launch, index), systemProgram: SystemProgram.programId,
      }).instruction(), index => this.finalizeIx(launch, index, quoteMint, treasury));
  }
  async finalizeIx(launch: PublicKey, index: number, quoteMint: PublicKey, treasury: PublicKey): Promise<TransactionInstruction> {
    return this.program.methods.finalizeEpoch().accountsStrict({
      launch, quoteMint, treasury, rewardVault: this.rewards(launch),
      epoch: this.epoch(launch, index), nextEpoch: this.epoch(launch, index + 1),
      tokenProgram: TOKEN_PROGRAM_ID,
    }).instruction();
  }
  async claimIx(launch: PublicKey, position: PublicKey, owner: PublicKey, quoteMint: PublicKey, destination: PublicKey, index: number): Promise<TransactionInstruction> {
    return this.program.methods.claimEpoch().accountsStrict({
      owner, launch, quoteMint, position, epoch: this.epoch(launch, index),
      rewardVault: this.rewards(launch), destination, tokenProgram: TOKEN_PROGRAM_ID,
    }).instruction();
  }
}
