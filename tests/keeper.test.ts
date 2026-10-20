import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey,TransactionInstruction,ComputeBudgetProgram,SystemProgram} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {buildEpochBatch} from '../scripts/epoch-batch';
import {recoverConfirmation} from '../scripts/confirmation';
test('epoch batching preserves every boundary and never recreates existing schedules',async()=>{
  const operations:string[]=[];
  const programId=Keypair.generate().publicKey;
  const ix=()=>new TransactionInstruction({programId,keys:[],data:Buffer.alloc(8)});
  const tx=await buildEpochBatch(20,4,[false,true,false,true],async index=>{operations.push('create:'+index);return ix();},async index=>{operations.push('finalize:'+index);return ix();});
  assert.deepEqual(operations,['create:21','finalize:20','finalize:21','create:23','finalize:22','finalize:23']);
  assert.equal(tx.instructions.length,6);
  await assert.rejects(buildEpochBatch(20,5,[],async()=>ix(),async()=>ix()),/Invalid/);
});
test('worst-case four-epoch batch with all schedule creations fits a legacy packet',async()=>{
  const key=()=>Keypair.generate().publicKey;
  const owner=key(),launch=key(),quote=key(),treasury=key(),vault=key(),programId=key();
  const epochs=Array.from({length:5},key);
  const meta=(pubkey:PublicKey,isWritable=true,isSigner=false)=>({pubkey,isWritable,isSigner});
  const tx=await buildEpochBatch(0,4,[false,false,false,false],async index=>new TransactionInstruction({programId,data:Buffer.alloc(16),keys:[meta(owner,true,true),meta(launch,false),meta(epochs[index]),meta(SystemProgram.programId,false)]}),async index=>new TransactionInstruction({programId,data:Buffer.alloc(8),keys:[meta(launch),meta(quote,false),meta(treasury),meta(vault),meta(epochs[index]),meta(epochs[index+1]),meta(TOKEN_PROGRAM_ID,false)]}));
  tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({units:600_000}));
  tx.feePayer=owner;tx.recentBlockhash=PublicKey.default.toBase58();
  assert.ok(tx.serialize({requireAllSignatures:false,verifySignatures:false}).length<=1232);
});
test('only confirmed successful signatures recover a client-side confirmation error',async()=>{
  assert.equal(await recoverConfirmation('signature',async()=>({err:null,confirmationStatus:'confirmed'})),true);
  assert.equal(await recoverConfirmation('signature',async()=>({err:null,confirmationStatus:'finalized'})),true);
  assert.equal(await recoverConfirmation('signature',async()=>({err:{InstructionError:[0,'failure']},confirmationStatus:'finalized'})),false);
  assert.equal(await recoverConfirmation('signature',async()=>({err:null,confirmationStatus:'processed'})),false);
  assert.equal(await recoverConfirmation('signature',async()=>null),false);
  assert.equal(await recoverConfirmation('signature',async()=>{throw new Error('RPC down');}),false);
});
