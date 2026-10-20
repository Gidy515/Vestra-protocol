import {Transaction, type TransactionInstruction} from '@solana/web3.js';
/** Keep account/packet/compute usage bounded; each finalize keeps its original checks. */
export const EPOCHS_PER_TRANSACTION = 4;
export async function buildEpochBatch(
  start: number,
  count: number,
  existingNext: boolean[],
  create: (index:number)=>Promise<TransactionInstruction>,
  finalize: (index:number)=>Promise<TransactionInstruction>,
): Promise<Transaction> {
  if (!Number.isSafeInteger(start) || start<0 || !Number.isInteger(count) || count<1
    || count>EPOCHS_PER_TRANSACTION || existingNext.length!==count) throw new Error('Invalid epoch batch');
  const tx=new Transaction();
  for(let i=0;i<count;i++) {
    if(!existingNext[i]) tx.add(await create(start+i+1));
    tx.add(await finalize(start+i));
  }
  return tx;
}
