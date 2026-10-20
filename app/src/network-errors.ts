export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export function rateLimited(error: unknown): boolean {
  return /\b429\b|rate.?limit|too many requests/i.test(errorText(error));
}
export function friendlyError(error: unknown): string {
  const text = errorText(error);
  if (rateLimited(error)) return "Network is busy. Requests will retry shortly. Please wait before trying again.";
  if (/keeper.*catch|catch.up limit|epoch.*backlog|epochs.*behind/i.test(text)) return "Rewards are syncing. Please wait for your launch to catch up before locking or claiming.";
  if (/not confirmed|confirmation.*timed out|block height exceeded|blockhash.*expired/i.test(text)) return "Transaction confirmation is unresolved. Check its signature before submitting again.";
  if (/user rejected|user denied|rejected the request/i.test(text)) return "Transaction cancelled in your wallet.";
  if (/insufficient.*(funds|lamports)/i.test(text)) return "Insufficient balance. Check your trading tokens and SOL for network fees.";
  if (/fetch failed|failed to fetch|network request failed/i.test(text)) return "Unable to reach the network. Check your connection and try again shortly.";
  return text;
}
