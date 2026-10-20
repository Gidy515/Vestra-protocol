import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec = promisify(execFile);
export function stockRequestArguments(value:string): string[] {
  const url=new URL(value);
  if(url.origin!=='https://api.xstocks.fi' || url.username || url.password || url.hash
    || !/^\/api\/v2\/public\/assets(?:\/[A-Za-z0-9.%_-]+\/price-data)?$/.test(url.pathname))
    throw new Error('Stock request is outside the allowed public API');
  return ['-4','--fail','--silent','--show-error','--proto','=https','--connect-timeout','10','--max-time','20','--max-filesize','2000000','--header','Accept: application/json',url.href];
}
/** Use the verified IPv4 transport; arguments never pass through a shell. */
export async function stockJson(url:string):Promise<any> {
  try {
    const {stdout}=await exec('curl',stockRequestArguments(url),{timeout:25_000,maxBuffer:2_000_000,encoding:'utf8'});
    return JSON.parse(stdout);
  } catch(error) {
    const e=error as {code?:string|number;stderr?:string;message?:string};
    if(e.code==='ENOENT') throw new Error('Install curl on the API service host to load stock data');
    throw new Error('Stock request failed: '+(e.stderr?.trim() || e.message || 'network unavailable').slice(0,300));
  }
}
