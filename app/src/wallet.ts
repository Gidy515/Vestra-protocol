import { PublicKey, Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";

export type Wallet = {
  publicKey: PublicKey;
  signTransaction: <T extends Transaction | VersionedTransaction>(
    tx: T,
  ) => Promise<T>;
  signAllTransactions: <T extends Transaction | VersionedTransaction>(
    txs: T[],
  ) => Promise<T[]>;
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
  disconnect?: () => Promise<void>;
  subscribe?: (fn: (key: PublicKey | null) => void) => () => void;
  kind: string;
};
export function localWallet(): Wallet {
  const stored = sessionStorage.getItem("vestra-local-wallet");
  const key = stored
    ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(stored)))
    : Keypair.generate();
  sessionStorage.setItem(
    "vestra-local-wallet",
    JSON.stringify(Array.from(key.secretKey)),
  );
  async function sign<T extends Transaction | VersionedTransaction>(
    tx: T,
  ): Promise<T> {
    if (tx instanceof Transaction) tx.partialSign(key);
    else tx.sign([key]);
    return tx;
  }
  return {
    publicKey: key.publicKey,
    kind: "Local test",
    signTransaction: sign,
    signAllTransactions: async (txs) => Promise.all(txs.map(sign)),
  };
}
export async function injectedWallet(
  kind: "Phantom" | "Solflare",
  onlyIfTrusted = false,
): Promise<Wallet> {
  const win = window as unknown as {
    phantom?: { solana?: any };
    solflare?: any;
  };
  const injected = kind === "Phantom" ? win.phantom?.solana : win.solflare;
  if (!injected)
    throw new Error(
      `${kind} extension not found. Install it or use the local test wallet.`,
    );
  await injected.connect(onlyIfTrusted ? { onlyIfTrusted: true } : undefined);
  return {
    publicKey: new PublicKey(injected.publicKey.toString()),
    kind,
    signTransaction: (tx) => injected.signTransaction(tx),
    signMessage: injected.signMessage ? async message => {
      const result = await injected.signMessage(message);
      return result.signature || result;
    } : undefined,
    signAllTransactions: async (txs) => {
      if (injected.signAllTransactions)
        return injected.signAllTransactions(txs);
      const signed = [];
      for (const tx of txs) signed.push(await injected.signTransaction(tx));
      return signed;
    },
    disconnect: () => injected.disconnect(),
    subscribe: (fn) => {
      const changed = (key: PublicKey | null) =>
        fn(key ? new PublicKey(key.toString()) : null);
      const disconnected = () => fn(null);
      injected.on?.("accountChanged", changed);
      injected.on?.("disconnect", disconnected);
      return () => {
        injected.removeListener?.("accountChanged", changed);
        injected.removeListener?.("disconnect", disconnected);
      };
    },
  };
}
