import {useEffect,useState,useRef} from 'react';
import {api} from './chain';
import type {StockMarket} from '../../scripts/stock-market';

export function Stocks() {
  const [data,setData] = useState<StockMarket|null>(null);
  const [search,setSearch] = useState('');
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(false);
  const fetching=useRef(false);
  async function refresh() {
    if(fetching.current) return;
    fetching.current=true;
    setLoading(true);
    try {setData(await api<StockMarket>('stocks'));setError('');}
    catch(e){setError(e instanceof Error ? e.message : String(e));}
    finally {fetching.current=false;setLoading(false);}
  }
  useEffect(() => {void refresh();const timer=setInterval(()=>void refresh(),5000);return()=>clearInterval(timer);},[]);
  const assets = (data?.assets || []).filter(a => (a.name+' '+a.symbol).toLowerCase().includes(search.toLowerCase()));
  return <section className="stocks-page">
    <div className="section-head"><div><p className="eyebrow">MARKET DIRECTORY</p><h1>Stocks</h1></div><button className="button secondary" disabled={loading} onClick={() => void refresh()}>{loading?'Loading…':'Refresh'}</button></div>
    <p className="stocks-explanation">Explore issuer-provided stock-token listings. These are <strong>Solana mainnet reference assets</strong>, not devnet balances or executable Vestra prices. No compatible issuer devnet mints have been enabled for pairing.</p>
    <input className="stocks-search" aria-label="Search stocks" placeholder="Search stocks by name or ticker" value={search} onChange={e=>setSearch(e.target.value)} />
    {(error || data?.error) && <div className="notice"><strong>Stock data unavailable</strong><p>{error || data?.error}</p><small>{data?.assets.length ? 'Showing the last successful response, marked stale.' : 'No placeholder prices or invented stocks are shown. The provider may require access from your network.'}</small></div>}
    <div className="stocks-table-wrap"><table className="stocks-table"><thead><tr><th>Token name</th><th>Indicative quote</th><th>1D change</th><th>Last 24h</th><th>24h volume</th><th>Market cap</th><th>Devnet pairing</th></tr></thead><tbody>
    {assets.map(asset=><tr key={asset.mint}><td><div className="stock-identity">{asset.logo ? <img src={asset.logo} alt="" referrerPolicy="no-referrer" onError={e=>{e.currentTarget.style.visibility='hidden';}}/>:<span className="stock-initial">{asset.symbol[0]}</span>}<div><strong>{asset.name}</strong><small>{asset.symbol} · <a href={'https://explorer.solana.com/address/'+asset.mint} target="_blank" rel="noreferrer">{asset.mint.slice(0,4)}…{asset.mint.slice(-4)} ↗</a></small></div></div></td><td>{asset.price===null?(data?.pricing?'Loading…':'Unavailable'):new Intl.NumberFormat('en',{maximumFractionDigits:4}).format(asset.price)}{data?.stale && <small>Stale</small>}</td><td>—</td><td>—</td><td>—</td><td>—</td><td><span className="stock-unavailable">Unavailable</span></td></tr>)}
    </tbody></table>{!loading && !assets.length && <p className="stocks-empty">{search?'No matching stocks.':error || data?.error?'Listings could not be loaded.':'The provider returned no matching Solana listings.'}</p>}</div>
    <p className="micro">{data?.source || 'xStocks public API'} · {data?.observedAt ? 'Fetched '+new Date(data.observedAt).toLocaleString() : 'Waiting for provider data'}. {data?.hasMore ? 'Showing up to 24 assets from the first provider page. ':''}The provider endpoints used here do not supply 24-hour change, charts, volume or market cap; these fields remain blank.</p>
  </section>;
}
