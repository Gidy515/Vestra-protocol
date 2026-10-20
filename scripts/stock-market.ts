import {stockJson} from './stock-http';
export type StockRow = {symbol:string;name:string;mint:string;logo:string;price:number|null;pairable:false};
export type StockMarket = {assets:StockRow[];source:string;observedAt:number;stale:boolean;error:string;hasMore:boolean;pricing?:boolean};
const base = 'https://api.xstocks.fi/api/v2';
export function parseStockAssets(value: unknown): Omit<StockRow,'price'>[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as any).nodes)) throw new Error('Invalid stock provider response');
  return (value as any).nodes.flatMap((item:any) => {
    const deployment = Array.isArray(item.deployments) ? item.deployments.find((d:any) => d.network === 'Solana') : null;
    if (!deployment || typeof deployment.address !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(deployment.address)
      || typeof item.symbol !== 'string' || !/^[A-Za-z0-9.-]{1,24}$/.test(item.symbol) || typeof item.name !== 'string') return [];
    return [{symbol:item.symbol, name:item.name.slice(0,160), mint:deployment.address,
      logo: typeof item.logo === 'string' && item.logo.startsWith('https://') ? item.logo : '', pairable:false as const}];
  });
}
export function stockMarket(fetcher?: typeof fetch) {
  let cache: StockMarket | undefined;
  let inFlight: Promise<StockMarket> | undefined;
  let attemptedAt = 0;
  async function json(url:string) {
    if (!fetcher) return stockJson(url);
    const response = await fetcher(url, {signal:AbortSignal.timeout(8000), redirect:'error', headers:{Accept:'application/json'}});
    if (!response.ok) throw new Error(`Stock provider returned HTTP ${response.status}`);
    return response.json();
  }
  return async (): Promise<StockMarket> => {
    if (cache && Date.now() - attemptedAt < 120_000) return cache;
    if (inFlight) return inFlight;
    attemptedAt = Date.now();
    inFlight = (async () => {
      try {
        const payload = await json(base + '/public/assets?network=Solana&pageSize=24');
        const assets = parseStockAssets(payload).slice(0,24);
        const snapshot: StockMarket = {assets:assets.map(asset=>({...asset,price:null})),source:'xStocks public API · Solana mainnet reference',observedAt:Date.now(),stale:false,error:'',hasMore:payload.page?.hasNextPage === true,pricing:assets.length>0};
        cache=snapshot;
        // Send the catalogue immediately. Hydrate quotes without blocking listing visibility.
        void (async()=>{
          try {
            for(let start=0;start<assets.length;start+=4) {
              const quotes=await Promise.all(assets.slice(start,start+4).map(async asset=>{
                try {
                  const data=await json(base+'/public/assets/'+encodeURIComponent(asset.symbol)+'/price-data');
                  return {...asset,price:typeof data.quote==='number' && Number.isFinite(data.quote) && data.quote>0 ? data.quote:null};
                } catch {return {...asset,price:null};}
              }));
              const byMint=new Map(quotes.map(row=>[row.mint,row]));
              snapshot.assets=snapshot.assets.map(row=>byMint.get(row.mint)||row);
            }
          } finally {snapshot.pricing=false;}
        })();
      } catch (error) {
        cache = {...(cache || {assets:[],source:'xStocks public API · Solana mainnet reference',observedAt:0,hasMore:false}),stale:true,error:error instanceof Error ? error.message : String(error)};
      }
      return cache!;
    })().finally(() => {inFlight = undefined;});
    return inFlight;
  };
}
