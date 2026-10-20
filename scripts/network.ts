import path from "node:path";
export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export type Cluster = "localnet" | "devnet";
export function network(env: NodeJS.ProcessEnv = process.env) {
  const cluster = env.VESTRA_CLUSTER || "localnet";
  if (cluster !== "localnet" && cluster !== "devnet") throw new Error("VESTRA_CLUSTER must be localnet or devnet");
  const rpc = env.ANCHOR_PROVIDER_URL || (cluster === "devnet" ? "https://api.devnet.solana.com" : "http://127.0.0.1:8899");
  const url = new URL(rpc);
  if (cluster === "localnet" && !["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("Localnet requires a localhost RPC");
  if (cluster === "devnet" && url.protocol !== "https:") throw new Error("Devnet requires an HTTPS RPC");
  // Browser-visible RPC must not contain a private server credential.
  const browserRpc = env.VESTRA_BROWSER_RPC || (cluster === "devnet" ? "https://api.devnet.solana.com" : rpc);
  const browserUrl = new URL(browserRpc);
  if (browserUrl.username || browserUrl.password || browserUrl.search || browserUrl.hash) throw new Error("Browser RPC must be public and credential-free");
  if (cluster === "devnet" && browserUrl.protocol !== "https:") throw new Error("Browser devnet RPC requires HTTPS");
  return { cluster: cluster as Cluster, rpc, browserRpc, stateDir: path.resolve(env.VESTRA_STATE_DIR || (cluster === "devnet" ? ".vestra/devnet" : ".vestra")) };
}
export function assertGenesis(cluster: Cluster, genesis: string) {
  if (cluster === "devnet" && genesis !== DEVNET_GENESIS) throw new Error("RPC is not Solana devnet; refusing transactions");
  if (cluster === "localnet" && (genesis === DEVNET_GENESIS || genesis === MAINNET_GENESIS)) throw new Error("Localnet RPC resolved to a public cluster");
}
