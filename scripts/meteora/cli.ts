import { deriveDbcPoolAuthority, DynamicBondingCurveClient, CollectFeeMode, MigrationOption, SwapMode, deriveDbcPoolAddress, deriveDammV2PoolAddress, DAMM_V2_MIGRATION_FEE_ADDRESS } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { CpAmm, getUnClaimLpFee } from '@meteora-ag/cp-amm-sdk';
import { createMint, mintTo, TOKEN_PROGRAM_ID, getAccount } from '@solana/spl-token';
import { Transaction, SystemProgram, Keypair } from '@solana/web3.js';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { buildLaunchConfig, rawAmount } from './config';
import { context, load, save, keyFile, pk, bn, send, ata, catchUp, chainTime, sleep, STATE_FILE, Manifest, NETWORK, verifyNetwork } from './runtime';

const MAX = bn('18446744073709551615');
const c = context();
const dbc = new DynamicBondingCurveClient(c.connection, 'confirmed');
const amm = new CpAmm(c.connection);
async function init() {
  await verifyNetwork(c);
  const dependencies = await c.connection.getMultipleAccountsInfo([
    pk('dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN'),
    pk('cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG'),
    pk('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'),
    DAMM_V2_MIGRATION_FEE_ADDRESS[6], c.program.programId,
  ]);
  if (dependencies.slice(0,3).some(x => !x?.executable) || !dependencies[4]?.executable)
    throw new Error('Required programs are not deployed on this cluster');
  if (!dependencies[3]?.owner.equals(pk('cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG')))
    throw new Error('DAMM migration config missing or has wrong owner');
  await amm.fetchConfigState(DAMM_V2_MIGRATION_FEE_ADDRESS[6]);
  const config = keyFile('config').key, base = keyFile('base').key;
  const collector = keyFile('collector');
  const quoteKey = keyFile('mock-quote').key;
  const quote = quoteKey.publicKey;
  let m: Manifest;
  if (fs.existsSync(STATE_FILE)) m = await load(c);
  else {
    const treasury = await createQuote();
    m = { version:1, genesis:await c.connection.getGenesisHash(), program:c.program.programId.toBase58(),
      authority:c.payer.publicKey.toBase58(), creator:c.payer.publicKey.toBase58(),
      quote:quote.toBase58(), quoteDecimals:6, mockQuote:true, config:config.publicKey.toBase58(), base:base.publicKey.toBase58(),
      collector:collector.key.publicKey.toBase58(), collectorKey:collector.file, treasury:treasury.toBase58(),
      dbcPool:deriveDbcPoolAddress(quote,base.publicKey,config.publicKey).toBase58(),
      launch:c.client.launch(base.publicKey,c.payer.publicKey).toBase58(), dammConfig:DAMM_V2_MIGRATION_FEE_ADDRESS[6].toBase58() };
    save(m);
  }
  async function createQuote() {
    if (!await c.connection.getAccountInfo(quote)) {
      await createMint(c.connection,c.payer,c.payer.publicKey,null,6,quoteKey);
      const destination = await ata(c,quote,c.payer.publicKey);
      await mintTo(c.connection,c.payer,quote,destination,c.payer,10_000_000_000n);
    }
    return ata(c,quote,c.payer.publicKey);
  }
  if (!await c.connection.getAccountInfo(pk(m.config))) await send(c, await dbc.partner.createConfig({
    ...buildLaunchConfig(6), config:pk(m.config),feeClaimer:pk(m.collector),leftoverReceiver:c.payer.publicKey,
    quoteMint:quote,payer:c.payer.publicKey,
  }),[config]);
  if (!await c.connection.getAccountInfo(pk(m.dbcPool))) await send(c,await dbc.creator.createPool({
    name:'Vestra Demo',symbol:'VESTDEMO',uri:'',payer:c.payer.publicKey,poolCreator:c.payer.publicKey,config:pk(m.config),baseMint:pk(m.base),
  }),[base]);
  if (!await c.connection.getAccountInfo(pk(m.launch))) await send(c,new Transaction().add(await c.program.methods.registerLaunch().accountsStrict({
    authority:c.payer.publicKey,collector:pk(m.collector),baseMint:pk(m.base),quoteMint:quote,treasury:pk(m.treasury),
    launch:pk(m.launch),epoch:c.client.epoch(pk(m.launch),0),principalVault:c.client.principal(pk(m.launch)),
    rewardVault:c.client.rewards(pk(m.launch)),tokenProgram:TOKEN_PROGRAM_ID,systemProgram:SystemProgram.programId,
  }).instruction()));
  const epochSeconds=(await c.client.launchState(pk(m.launch))).epochSeconds.toNumber();
  if (NETWORK.cluster === 'devnet' && epochSeconds !== 60) throw new Error('Devnet demo requires the devnet-demo build (60-second epochs)');
  m.registered=true; save(m); console.log('Initialized mock-stock launch:',m.dbcPool);
}
async function checked(m:Manifest) {
  if (!deriveDbcPoolAddress(pk(m.quote),pk(m.base),pk(m.config)).equals(pk(m.dbcPool))) throw new Error('Noncanonical DBC pool');
  const infos=await c.connection.getMultipleAccountsInfo([pk(m.dbcPool),pk(m.config)]);
  if (infos.some(info=>!info || !info.owner.equals(pk('dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN')))) throw new Error('Unexpected DBC account owner');
  const pool = await dbc.state.getPool(pk(m.dbcPool));
  const config = await dbc.state.getPoolConfig(pk(m.config));
  if (!pool || !config || !pool.poolState.config.equals(pk(m.config)) || !pool.poolState.baseMint.equals(pk(m.base))
    || !config.quoteMint.equals(pk(m.quote)) || !config.feeClaimer.equals(pk(m.collector))) throw new Error('DBC manifest/config mismatch');
  if (config.collectFeeMode!==CollectFeeMode.QuoteToken || config.migrationOption!==MigrationOption.MET_DAMM_V2 || config.creatorTradingFeePercentage!==20
    || config.partnerPermanentLockedLiquidityPercentage!==80 || config.creatorPermanentLockedLiquidityPercentage!==20
    || config.partnerLiquidityPercentage!==0 || config.creatorLiquidityPercentage!==0) throw new Error('Launch fee/liquidity policy mismatch');
  const state=await c.client.launchState(pk(m.launch));
  if (!state.collector.equals(pk(m.collector)) || !state.quoteMint.equals(pk(m.quote))) throw new Error('Vestra collector mismatch');
  return {pool,config};
}
async function trade(m:Manifest,buy:boolean,input:string) {
  const {pool,config}=await checked(m);
  const amount=bn(rawAmount(input,6));
  if (pool.poolState.isMigrated) {
    const address=deriveDammV2PoolAddress(pk(m.dammConfig),pk(m.base),pk(m.quote));
    const state=await amm.fetchPoolState(address);
    if (!state.tokenAMint.equals(pk(m.base)) || !state.tokenBMint.equals(pk(m.quote))) throw new Error('Unexpected graduated mint order');
    const inputTokenMint=pk(buy?m.quote:m.base), outputTokenMint=pk(buy?m.base:m.quote);
    const q=amm.getQuote({inAmount:amount,inputTokenMint,slippage:1,poolState:state,currentTime:await chainTime(c),currentSlot:await c.connection.getSlot(),tokenADecimal:6,tokenBDecimal:6});
    await send(c,await amm.swap({payer:c.payer.publicKey,pool:address,inputTokenMint,outputTokenMint,amountIn:amount,minimumAmountOut:q.minSwapOutAmount,
      tokenAMint:state.tokenAMint,tokenBMint:state.tokenBMint,tokenAVault:state.tokenAVault,tokenBVault:state.tokenBVault,
      tokenAProgram:TOKEN_PROGRAM_ID,tokenBProgram:TOKEN_PROGRAM_ID,referralTokenAccount:null}));
  } else {
    const q=dbc.pool.swapQuote2({swapMode:SwapMode.PartialFill,virtualPool:pool,config,swapBaseForQuote:!buy,amountIn:amount,slippageBps:100,hasReferral:false,
      eligibleForFirstSwapWithMinFee:false,currentPoint:bn(await chainTime(c))});
    if (!q.minimumAmountOut) throw new Error('SDK omitted minimum output');
    await send(c,await dbc.pool.swap2({swapMode:SwapMode.PartialFill,owner:c.payer.publicKey,pool:pk(m.dbcPool),amountIn:amount,minimumAmountOut:q.minimumAmountOut,swapBaseForQuote:!buy,referralTokenAccount:null}));
  }
}
async function collect(m:Manifest) {
  await checked(m); await catchUp(c,m);
  const collector=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(m.collectorKey,'utf8'))));
  if (!collector.publicKey.equals(pk(m.collector))) throw new Error('Wrong collector key');
  const source=await ata(c,pk(m.quote),collector.publicKey);
  if ((await getAccount(c.connection,source)).amount!==0n) throw new Error('Dedicated fee account contains an unexpected balance; inspect before collecting');
  async function ingest(tx:Transaction) {
    const index=await catchUp(c,m);
    tx.add(await c.program.methods.fundCollectedBalance().accountsStrict({collector:collector.publicKey,launch:pk(m.launch),quoteMint:pk(m.quote),
      source,rewardVault:c.client.rewards(pk(m.launch)),epoch:c.client.epoch(pk(m.launch),index),tokenProgram:TOKEN_PROGRAM_ID}).instruction());
    await send(c,tx,[collector]);
    if ((await getAccount(c.connection,source)).amount!==0n) throw new Error('Collector balance was not swept');
  }
  const fees=await dbc.state.getPoolFeeMetrics(pk(m.dbcPool));
  if (!fees.current.partnerQuoteFee.isZero()) await ingest(await dbc.partner.claimPartnerTradingFee({feeClaimer:collector.publicKey,payer:c.payer.publicKey,pool:pk(m.dbcPool),maxBaseAmount:bn(0),maxQuoteAmount:MAX,receiver:collector.publicKey}));
  const {pool}=await checked(m);
  if (pool.poolState.isMigrated) {
    const address=deriveDammV2PoolAddress(pk(m.dammConfig),pk(m.base),pk(m.quote));
    const state=await amm.fetchPoolState(address);
    if (!state.tokenBMint.equals(pk(m.quote)) || state.collectFeeMode!==1) throw new Error('DAMM quote-only fee policy mismatch');
    for (const p of await amm.getUserPositionByPool(address,collector.publicKey)) {
      const pending=getUnClaimLpFee(state,p.positionState,bn(await chainTime(c)));
      if (pending.feeTokenB.isZero()) continue;
      await ingest(await amm.claimPositionFee({owner:collector.publicKey,position:p.position,positionNftAccount:p.positionNftAccount,pool:address,
        tokenAMint:state.tokenAMint,tokenBMint:state.tokenBMint,tokenAVault:state.tokenAVault,tokenBVault:state.tokenBVault,
        tokenAProgram:TOKEN_PROGRAM_ID,tokenBProgram:TOKEN_PROGRAM_ID,receiver:collector.publicKey,feePayer:c.payer.publicKey}));
    }
  }
  console.log('Total funded quote units:',(await c.client.launchState(pk(m.launch))).totalReceived.toString());
}
async function graduate(m:Manifest) {
  const {pool,config}=await checked(m);
  if (!pool.poolState.isMigrated) {
    if (pool.poolState.quoteReserve.lt(config.migrationQuoteThreshold)) throw new Error('Curve threshold has not been reached');
    const migration=await dbc.migration.migrateToDammV2({payer:c.payer.publicKey,pool:pk(m.dbcPool),dammConfig:pk(m.dammConfig)});
    const rentAuthority = deriveDbcPoolAuthority();
    const balance = await c.connection.getBalance(rentAuthority);
    if (NETWORK.cluster === 'devnet' && balance < 50_000_000)
      throw new Error('Meteora devnet migration rent authority is underfunded. Do not apply the localnet top-up workaround to the shared devnet PDA.');
    if (NETWORK.cluster === 'localnet' && balance < 1_000_000_000) {
      migration.transaction.instructions.unshift(SystemProgram.transfer({
        fromPubkey: c.payer.publicKey,
        toPubkey: rentAuthority,
        lamports: 1_000_000_000 - balance,
      }));
    }
    await send(c,migration.transaction,[migration.firstPositionNftKeypair,migration.secondPositionNftKeypair]);
  }
  m.dammPool=deriveDammV2PoolAddress(pk(m.dammConfig),pk(m.base),pk(m.quote)).toBase58(); save(m);
  console.log('Graduated:',m.dammPool);
}
async function lock(m:Manifest,input:string,nonce:number,tier:number) {
  if (![0,1,2].includes(tier)) throw new Error('Tier must be 0, 1, or 2');
  const index=await catchUp(c,m), start=index+1,end=start+[7,30,90][tier];
  await c.client.ensureEpoch(pk(m.launch),start,c.payer.publicKey); await c.client.ensureEpoch(pk(m.launch),end,c.payer.publicKey);
  await send(c,new Transaction().add(await c.program.methods.lockTokens(bn(nonce),bn(rawAmount(input,6)),tier).accountsStrict({
    owner:c.payer.publicKey,launch:pk(m.launch),baseMint:pk(m.base),source:await ata(c,pk(m.base),c.payer.publicKey),
    principalVault:c.client.principal(pk(m.launch)),position:c.client.position(pk(m.launch),c.payer.publicKey,nonce),
    startEpoch:c.client.epoch(pk(m.launch),start),endEpoch:c.client.epoch(pk(m.launch),end),tokenProgram:TOKEN_PROGRAM_ID,systemProgram:SystemProgram.programId,
  }).instruction()));
}
async function claim(m:Manifest,nonce:number) {
  await catchUp(c,m);
  const position=c.client.position(pk(m.launch),c.payer.publicKey,nonce), destination=await ata(c,pk(m.quote),c.payer.publicKey);
  for (;;) {
    const p=await c.client.positionState(position),s=await c.client.launchState(pk(m.launch)),index=p.nextClaimEpoch.toNumber();
    if(index>=Math.min(s.currentEpoch.toNumber(),p.endEpoch.toNumber())) break;
    await send(c,new Transaction().add(await c.client.claimIx(pk(m.launch),position,c.payer.publicKey,pk(m.quote),destination,index)));
  }
}
async function withdraw(m:Manifest,nonce:number) {
  const position=c.client.position(pk(m.launch),c.payer.publicKey,nonce);
  await send(c,new Transaction().add(await c.program.methods.withdrawUnlocked().accountsStrict({
    owner:c.payer.publicKey,launch:pk(m.launch),baseMint:pk(m.base),position,
    principalVault:c.client.principal(pk(m.launch)),destination:await ata(c,pk(m.base),c.payer.publicKey),tokenProgram:TOKEN_PROGRAM_ID,
  }).instruction()));
}
async function audit(m:Manifest) {
  const s=await c.client.launchState(pk(m.launch));
  const rewards=(await getAccount(c.connection,c.client.rewards(pk(m.launch)))).amount;
  const principal=(await getAccount(c.connection,c.client.principal(pk(m.launch)))).amount;
  assert.equal(rewards+BigInt(s.totalPlatformPaid.toString())+BigInt(s.totalLockerPaid.toString()),BigInt(s.totalReceived.toString()));
  assert.equal(principal,BigInt(s.outstandingPrincipal.toString()));
  console.log({cluster:NETWORK.cluster,program:m.program,launch:m.launch,epochSeconds:s.epochSeconds.toString(),
    funded:s.totalReceived.toString(),platformPaid:s.totalPlatformPaid.toString(),lockerPaid:s.totalLockerPaid.toString(),rewards:rewards.toString(),principal:principal.toString(),reconciled:true});
}
async function main() {
  await verifyNetwork(c);
  const [command,input,nonce='0',tier='0']=process.argv.slice(2);
  if(command==='init') return init();
  if(command==='demo') {
    if(fs.existsSync(STATE_FILE)) throw new Error('Demo requires a fresh manifest; use individual commands to resume an existing launch');
    await init();
    const m=await load(c);
    const initial=await c.client.launchState(pk(m.launch));
    assert.equal(initial.epochSeconds.toNumber(),NETWORK.cluster === 'devnet' ? 60 : 10,'Wrong demo build: use devnet-demo for devnet, demo-clock for localnet');
    await trade(m,true,'10');
    await lock(m,'100',0,NETWORK.cluster === 'devnet' ? 0 : 1);
    const position=c.client.position(pk(m.launch),c.payer.publicKey,0);
    const start=(await c.client.positionState(position)).startEpoch.toNumber();
    while(await catchUp(c,m)<start) await sleep(500);
    await trade(m,true,'1');
    await collect(m);
    const beforeMigration=BigInt((await c.client.launchState(pk(m.launch))).totalReceived.toString());
    assert(beforeMigration>0n,'DBC partner fees must fund Vestra');
    for(let attempts=0;attempts<30;attempts++) {
      const {pool,config}=await checked(m);
      if(pool.poolState.quoteReserve.gte(config.migrationQuoteThreshold)) break;
      await trade(m,true,'5');
    }
    await graduate(m);
    await collect(m); // ingest any DBC fees remaining at graduation
    const beforeDamm=BigInt((await c.client.launchState(pk(m.launch))).totalReceived.toString());
    const dammBefore=await amm.fetchPoolState(pk(m.dammPool!));
    await trade(m,true,'1');
    await collect(m);
    const afterDamm=BigInt((await c.client.launchState(pk(m.launch))).totalReceived.toString());
    assert(afterDamm>beforeDamm,'DAMM v2 fees must continue funding Vestra');
    const dammAfter=await amm.fetchPoolState(pk(m.dammPool!));
    assert.equal(dammAfter.permanentLockLiquidity.toString(),dammBefore.permanentLockLiquidity.toString(),'Fee collection must preserve locked liquidity');
    const fundedEpoch=(await c.client.launchState(pk(m.launch))).currentEpoch.toNumber();
    while(await catchUp(c,m)<=fundedEpoch) await sleep(500);
    const rewardBefore=BigInt((await c.client.launchState(pk(m.launch))).totalLockerPaid.toString());
    await claim(m,0);
    const rewardAfter=BigInt((await c.client.launchState(pk(m.launch))).totalLockerPaid.toString());
    assert(rewardAfter>rewardBefore,'Eligible locker must receive quote rewards');
    if (NETWORK.cluster === 'devnet') {
      const p=await c.client.positionState(position),s=await c.client.launchState(pk(m.launch));
      console.log('Waiting for the 7-minute demo lock to expire before testing withdrawal');
      const end=s.origin.toNumber()+p.endEpoch.toNumber()*s.epochSeconds.toNumber();
      while(await chainTime(c)<end) await sleep(2000);
      await catchUp(c,m);
      await claim(m,0);
      await withdraw(m,0);
      assert.equal((await c.client.positionState(position)).withdrawn,true);
      await audit(m);
    }
    console.log('PASS: DBC fees → graduation → DAMM fees → locker rewards');
    return;
  }
  const m=await load(c);
  switch(command) {
    case 'buy': case 'sell': return trade(m,command==='buy',input);
    case 'collect': return collect(m);
    case 'graduate': return graduate(m);
    case 'lock': return lock(m,input,Number(nonce),Number(tier));
    case 'claim': return claim(m,Number(input||0));
    case 'withdraw': return withdraw(m,Number(input||0));
    case 'audit': return audit(m);
    case 'status': { const {pool,config}=await checked(m); console.log({pool:m.dbcPool,migrated:pool.poolState.isMigrated,reserve:pool.poolState.quoteReserve.toString(),threshold:config.migrationQuoteThreshold.toString(),funded:(await c.client.launchState(pk(m.launch))).totalReceived.toString()}); return; }
    case 'keeper': for (;;) { await collect(m); await sleep(5000); }
    default: throw new Error('Commands: init | buy QUOTE | sell BASE | lock BASE NONCE TIER | collect | graduate | claim NONCE | withdraw NONCE | audit | status | keeper');
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
