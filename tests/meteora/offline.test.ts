import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CollectFeeMode, MigrationOption, TokenAuthorityOption, MigrationFeeOption, validateConfigParameters } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { Keypair } from '@solana/web3.js';
import { buildLaunchConfig, rawAmount } from '../../scripts/meteora/config';
test('curve uses quote fees, immutable base, and permanently locked DAMM v2 liquidity',()=>{
  const c=buildLaunchConfig(6);
  assert.doesNotThrow(()=>validateConfigParameters({...c,leftoverReceiver:Keypair.generate().publicKey}));
  assert.equal(c.collectFeeMode,CollectFeeMode.QuoteToken);
  assert.equal(c.migrationOption,MigrationOption.MET_DAMM_V2);
  assert.equal(c.tokenUpdateAuthority,TokenAuthorityOption.Immutable);
  assert.equal(c.creatorTradingFeePercentage,20);
  assert.equal(c.partnerPermanentLockedLiquidityPercentage,80);
  assert.equal(c.creatorPermanentLockedLiquidityPercentage,20);
  assert.equal(c.partnerLiquidityPercentage,0);
  assert.equal(c.creatorLiquidityPercentage,0);
  assert.equal(c.migrationFeeOption,MigrationFeeOption.Customizable);
  assert.equal(c.migrationQuoteThreshold.toString(),'100000000');
});
test('amount parser preserves exact SPL units and rejects unsafe inputs',()=>{
  assert.equal(rawAmount('100.000001',6),100000001n);
  for(const input of ['0','-1','1e3','NaN','0.0000001','18446744073709551616']) assert.throws(()=>rawAmount(input,6));
});
test('curve configuration rejects invalid precision and thresholds',()=>{
  for(const d of [-1,10,1.5]) assert.throws(()=>buildLaunchConfig(d));
  for(const n of [0,-1,Infinity,1_000_001]) assert.throws(()=>buildLaunchConfig(6,n));
});
