import fs from 'node:fs';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { CpAmm } from '@meteora-ag/cp-amm-sdk';
import { DAMM_V2_MIGRATION_FEE_ADDRESS, deriveDbcPoolAuthority } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { network, assertGenesis } from './network';
async function main() {
  const n = network();
  if (n.cluster !== 'devnet') throw new Error('Run npm run devnet:check');
  const connection = new Connection(n.rpc, 'confirmed');
  const genesis = await connection.getGenesisHash();
  assertGenesis(n.cluster, genesis);
  const publicGenesis = await new Connection(n.browserRpc, 'confirmed').getGenesisHash();
  assertGenesis(n.cluster, publicGenesis);
  const ids = [
    'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN',
    'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG',
    'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
  ];
  const accounts = await connection.getMultipleAccountsInfo(ids.map(x => new PublicKey(x)));
  accounts.forEach((a, i) => { if (!a?.executable) throw new Error(`Missing program: ${ids[i]}`); });
  const config = DAMM_V2_MIGRATION_FEE_ADDRESS[6];
  const account = await connection.getAccountInfo(config);
  if (!account?.owner.equals(new PublicKey(ids[1]))) throw new Error('Invalid DAMM migration config owner');
  // Decode using the exact SDK version shipped with this application.
  await new CpAmm(connection).fetchConfigState(config);
  const rentAuthorityLamports = await connection.getBalance(deriveDbcPoolAuthority());
  console.log({ cluster: n.cluster, genesis, dependencies: 'executable', migrationConfig: config.toBase58(), rentAuthorityLamports });
  if (rentAuthorityLamports < 50_000_000) throw new Error('Shared Meteora migration authority is underfunded; contact Meteora before graduation');
  const programId = new PublicKey('8AXvPZN7mSM2twASsL9QqKqLqQBnJLGjDKBmzZktnx7K');
  const program = await connection.getAccountInfo(programId);
  console.log('Vestra program:', program?.executable ? 'deployed' : 'not yet deployed');
  if (!process.env.ANCHOR_WALLET) throw new Error('Set ANCHOR_WALLET to a dedicated devnet wallet');
  const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.ANCHOR_WALLET, 'utf8'))));
  console.log('Operator:', wallet.publicKey.toBase58(), 'test SOL:', await connection.getBalance(wallet.publicKey) / 1e9);
  const keyPath = 'target/deploy/vestra-keypair.json';
  if (fs.existsSync(keyPath)) {
    const key = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, 'utf8'))));
    if (!key.publicKey.equals(programId)) throw new Error('Program keypair does not match Vestra program ID');
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
