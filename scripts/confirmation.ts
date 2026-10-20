/** Only confirmed/finalized success resolves an ambiguous client-side failure. */
export async function recoverConfirmation(
  signature: string,
  lookup: (signature:string)=>Promise<{err:unknown;confirmationStatus?:string|null}|null>,
): Promise<boolean> {
  try {
    const status=await lookup(signature);
    return !!status && !status.err && (status.confirmationStatus==='confirmed' || status.confirmationStatus==='finalized');
  } catch {return false;}
}
