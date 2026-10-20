import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EpochBacklogError,reconcileEpochs,pendingEpochs} from '../scripts/epoch-catchup';
import {validAvatar} from '../scripts/catalog-logo';
import {parseStockAssets,stockMarket} from '../scripts/stock-market';
test('epoch catch-up respects boundaries and resumes a long offline backlog without skipping epochs',async()=>{
  let current=0;const finalized:number[]=[];
  const state=async()=>({origin:0,seconds:60,current});
  const time=async()=>60*205;
  const finalize=async(index:number)=>{assert.equal(index,current);finalized.push(index);current++;};
  await assert.rejects(reconcileEpochs(state,time,finalize,8),error=>error instanceof EpochBacklogError && error.remaining===197);
  while(current<205){try{await reconcileEpochs(state,time,finalize,8);}catch(error){assert.ok(error instanceof EpochBacklogError);}}
  assert.equal(await reconcileEpochs(state,time,finalize,8),205);
  assert.deepEqual(finalized,Array.from({length:205},(_,i)=>i));
  assert.equal(pendingEpochs(0,60,1,119),0);
  assert.equal(pendingEpochs(0,60,1,120),1);
});
test('logo validation rejects executable markup, external URLs and excessive dimensions',()=>{
  assert.equal(validAvatar('✦'),true);
  assert.equal(validAvatar('data:image/svg+xml,<svg onload="alert(1)"/>'),false);
  assert.equal(validAvatar('https://example.com/logo.png'),false);
  const header=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(header);header.write('IHDR',12);header.writeUInt32BE(128,16);header.writeUInt32BE(128,20);
  assert.equal(validAvatar('data:image/png;base64,'+header.toString('base64')),true);
  header.writeUInt32BE(5000,16);
  assert.equal(validAvatar('data:image/png;base64,'+header.toString('base64')),false);
});
test('stock catalog keeps external-network reference data unpairable and rejects malformed mints',()=>{
  const nodes=[{symbol:'SPYx',name:'SPY',logo:'https://example.com/logo.png',deployments:[{network:'Solana',address:'11111111111111111111111111111111'}]},
    {symbol:'BAD',name:'Wrong',deployments:[{network:'Solana',address:'bad'}]},
    {symbol:'ETH',name:'Other network',deployments:[{network:'Ethereum',address:'0x123'}]}];
  const rows=parseStockAssets({nodes});assert.equal(rows.length,1);assert.equal(rows[0].pairable,false);
});
test('provider failures are explicit; no fictional price is substituted and requests are cached',async()=>{
  let calls=0;
  const market=stockMarket((async()=>{calls++;return new Response('{}',{status:403});}) as typeof fetch);
  const first=await market();assert.equal(first.stale,true);assert.equal(first.assets.length,0);assert.match(first.error,/403/);
  await market();assert.equal(calls,1);
});
test('stock quote zero and failed quotes remain unavailable rather than fabricated',async()=>{
  const asset={symbol:'SPYx',name:'SPY',deployments:[{network:'Solana',address:'11111111111111111111111111111111'}]};
  const market=stockMarket((async(url:any)=>new Response(JSON.stringify(String(url).includes('price-data')?{quote:0}:{nodes:[asset],page:{hasNextPage:false}}))) as typeof fetch);
  const data=await market();assert.equal(data.assets[0].price,null);assert.equal(data.stale,false);
});
test('wallet restoration requests trusted access only and disconnect subscriptions clean up',async()=>{
  const {injectedWallet} = await import('../app/src/wallet');
  const original = (globalThis as any).window;
  const options:unknown[]=[];const handlers=new Map<string,Function>();
  const provider={publicKey:{toString:()=> '11111111111111111111111111111111'},
    connect:async(option:unknown)=>{options.push(option);},
    on:(name:string,fn:Function)=>handlers.set(name,fn),
    removeListener:(name:string)=>handlers.delete(name),
  };
  (globalThis as any).window={phantom:{solana:provider}};
  try {
    const wallet=await injectedWallet('Phantom',true);
    assert.deepEqual(options,[{onlyIfTrusted:true}]);
    let disconnected=false;
    const cleanup=wallet.subscribe!(key=>{disconnected=key===null;});
    handlers.get('disconnect')!();assert.equal(disconnected,true);
    cleanup();assert.equal(handlers.size,0);
  }finally{(globalThis as any).window=original;}
});
test('stock catalogue renders before slower quotes complete',async()=>{
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const asset={symbol:'SPYx',name:'SPY',deployments:[{network:'Solana',address:'11111111111111111111111111111111'}]};
  const market=stockMarket((async(url:any)=>{
    if(String(url).includes('price-data')){await gate;return new Response(JSON.stringify({quote:12.5}));}
    return new Response(JSON.stringify({nodes:[asset],page:{hasNextPage:false}}));
  }) as typeof fetch);
  const initial=await market();
  assert.equal(initial.assets.length,1);assert.equal(initial.assets[0].price,null);assert.equal(initial.pricing,true);
  release();await new Promise(resolve=>setImmediate(resolve));
  const updated=await market();assert.equal(updated.assets[0].price,12.5);assert.equal(updated.pricing,false);
});
test('IPv4 stock transport fixes the public host and uses bounded shell-free arguments',async()=>{
  const {stockRequestArguments}=await import('../scripts/stock-http');
  const args=stockRequestArguments('https://api.xstocks.fi/api/v2/public/assets?network=Solana&pageSize=24');
  assert.equal(args[0],'-4');assert.ok(args.includes('--max-time'));assert.ok(args.includes('--max-filesize'));
  for(const url of ['http://api.xstocks.fi/api/v2/public/assets','https://evil.example/api/v2/public/assets','https://api.xstocks.fi/api/v2/client/wallets','https://user:pass@api.xstocks.fi/api/v2/public/assets'])
    assert.throws(()=>stockRequestArguments(url));
});
