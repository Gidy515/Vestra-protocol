import http from "node:http";
import { allowedLocalRequest } from "./frontend-policy";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  getAccount,
  getMint,
  getOrCreateAssociatedTokenAccount,
  transfer,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  DynamicBondingCurveClient,
  deriveDbcPoolAddress,
  deriveDammV2PoolAddress,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { CpAmm, getUnClaimLpFee } from "@meteora-ag/cp-amm-sdk";
import {
  context,
  load,
  pk,
  bn,
  ata,
  catchUp,
  send,
  chainTime,
  Manifest,
} from "./meteora/runtime";

async function main() {
  const c = context(),
    dbc = new DynamicBondingCurveClient(c.connection, "confirmed"),
    amm = new CpAmm(c.connection);
  const original = await load(c);
  const session = randomBytes(32).toString("hex");
  const catalogFile = path.resolve(".vestra/catalog.json");
  type Metadata = { name: string; symbol: string; avatar: string };
  const catalog: Record<string, Metadata> = fs.existsSync(catalogFile)
    ? JSON.parse(fs.readFileSync(catalogFile, "utf8"))
    : {};
  catalog[original.launch] ??= {
    name: "Vestra Demo",
    symbol: "VESTDEMO",
    avatar: "✦",
  };
  const MAX = bn("18446744073709551615");
  const collector = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(original.collectorKey, "utf8"))),
  );
  if (!collector.publicKey.equals(pk(original.collector)))
    throw new Error("Collector key mismatch");
  let keeperBusy = false,
    keeperError = "",
    lastKeeper = 0;
  const faucetCounts = new Map<string, number>();
  const validHosts = new Set([
    "127.0.0.1:8787",
    "localhost:8787",
    "127.0.0.1:5173",
    "localhost:5173",
  ]);
  function json(res: http.ServerResponse, value: unknown, status = 200) {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(value));
  }
  async function body(req: http.IncomingMessage): Promise<any> {
    let text = "";
    for await (const chunk of req) {
      text += chunk;
      if (text.length > 8192) throw new Error("Request too large");
    }
    return JSON.parse(text || "{}");
  }
  async function discover() {
    const rows = await (c.program.account as any).launch.all();
    const result = [];
    for (const row of rows) {
      const s = row.account;
      if (
        !s.collector.equals(collector.publicKey) ||
        !s.quoteMint.equals(pk(original.quote)) ||
        !s.treasury.equals(pk(original.treasury))
      )
        continue;
      const base = s.baseMint.toBase58(),
        poolAddress = deriveDbcPoolAddress(
          pk(original.quote),
          s.baseMint,
          pk(original.config),
        );
      const pool = await dbc.state.getPool(poolAddress);
      if (!pool || !pool.poolState.config.equals(pk(original.config))) continue;
      const config = await dbc.state.getPoolConfig(pk(original.config));
      if (!config || !config.feeClaimer.equals(collector.publicKey))
        throw new Error("Unexpected fee collector");
      const address = row.publicKey.toBase58();
      const m: Manifest = {
        ...original,
        base,
        launch: address,
        authority: s.authority.toBase58(),
        creator: pool.poolState.creator.toBase58(),
        dbcPool: poolAddress.toBase58(),
        dammPool: deriveDammV2PoolAddress(
          pk(original.dammConfig),
          s.baseMint,
          pk(original.quote),
        ).toBase58(),
      };
      let sqrtPrice = pool.poolState.sqrtPrice.toString();
      if (pool.poolState.isMigrated)
        sqrtPrice = (
          await amm.fetchPoolState(pk(m.dammPool!))
        ).sqrtPrice.toString();
      const mint = await getMint(c.connection, s.baseMint);
      result.push({
        m,
        public: {
          ...(catalog[address] || {
            name: "Community launch",
            symbol: "TOKEN",
            avatar: "✦",
          }),
          address,
          base,
          pool: m.dbcPool,
          dammPool: m.dammPool,
          creator: m.creator,
          authority: m.authority,
          quote: m.quote,
          config: m.config,
          treasury: m.treasury,
          collector: m.collector,
          dammConfig: m.dammConfig,
          migrated: Boolean(pool.poolState.isMigrated),
          reserve: pool.poolState.quoteReserve.toString(),
          threshold: config.migrationQuoteThreshold.toString(),
          funded: s.totalReceived.toString(),
          platformPaid: s.totalPlatformPaid.toString(),
          lockerPaid: s.totalLockerPaid.toString(),
          locked: s.outstandingPrincipal.toString(),
          currentEpoch: s.currentEpoch.toNumber(),
          epochSeconds: s.epochSeconds.toNumber(),
          origin: s.origin.toNumber(),
          sqrtPrice,
          supply: mint.supply.toString(),
        },
      });
    }
    return result;
  }
  async function collect(m: Manifest) {
    const source = await ata(c, pk(m.quote), collector.publicKey);
    if ((await getAccount(c.connection, source)).amount !== 0n)
      throw new Error(
        "Collector ATA has unrelated tokens; inspect it before collection",
      );
    async function ingest(tx: Transaction) {
      const index = await catchUp(c, m);
      tx.add(
        await c.program.methods
          .fundCollectedBalance()
          .accountsStrict({
            collector: collector.publicKey,
            launch: pk(m.launch),
            quoteMint: pk(m.quote),
            source,
            rewardVault: c.client.rewards(pk(m.launch)),
            epoch: c.client.epoch(pk(m.launch), index),
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .instruction(),
      );
      await send(c, tx, [collector]);
    }
    await catchUp(c, m);
    const fees = await dbc.state.getPoolFeeMetrics(pk(m.dbcPool));
    if (!fees.current.partnerQuoteFee.isZero())
      await ingest(
        await dbc.partner.claimPartnerTradingFee({
          feeClaimer: collector.publicKey,
          payer: c.payer.publicKey,
          pool: pk(m.dbcPool),
          maxBaseAmount: bn(0),
          maxQuoteAmount: MAX,
          receiver: collector.publicKey,
        }),
      );
    const pool = await dbc.state.getPool(pk(m.dbcPool));
    if (pool?.poolState.isMigrated) {
      const address = pk(m.dammPool!),
        state = await amm.fetchPoolState(address);
      if (!state.tokenBMint.equals(pk(m.quote)) || state.collectFeeMode !== 1)
        throw new Error("DAMM quote fee policy mismatch");
      for (const p of await amm.getUserPositionByPool(
        address,
        collector.publicKey,
      )) {
        if (
          getUnClaimLpFee(
            state,
            p.positionState,
            bn(await chainTime(c)),
          ).feeTokenB.isZero()
        )
          continue;
        await ingest(
          await amm.claimPositionFee({
            owner: collector.publicKey,
            position: p.position,
            positionNftAccount: p.positionNftAccount,
            pool: address,
            tokenAMint: state.tokenAMint,
            tokenBMint: state.tokenBMint,
            tokenAVault: state.tokenAVault,
            tokenBVault: state.tokenBVault,
            tokenAProgram: TOKEN_PROGRAM_ID,
            tokenBProgram: TOKEN_PROGRAM_ID,
            receiver: collector.publicKey,
            feePayer: c.payer.publicKey,
          }),
        );
      }
    }
  }
  async function keeper() {
    if (keeperBusy) return;
    keeperBusy = true;
    try {
      for (const item of await discover()) await collect(item.m);
      keeperError = "";
      lastKeeper = Date.now();
    } catch (e) {
      keeperError = e instanceof Error ? e.message : String(e);
      console.error("Keeper:", keeperError);
    } finally {
      keeperBusy = false;
    }
  }
  const server = http.createServer(async (req, res) => {
    try {
      if (
        !allowedLocalRequest(
          req.headers.host || "",
          req.headers.origin,
          req.method || "GET",
          typeof req.headers["x-vestra-session"] === "string"
            ? req.headers["x-vestra-session"]
            : undefined,
          session,
        )
      )
        return json(
          res,
          { error: "Unrecognized local request or session" },
          403,
        );
      const url = new URL(req.url || "/", "http://127.0.0.1:8787");
      if (req.method === "POST" && req.headers["x-vestra-session"] !== session)
        return json(res, { error: "Invalid session" }, 403);
      if (req.method === "GET" && url.pathname === "/api/bootstrap")
        return json(res, {
          session,
          genesis: original.genesis,
          program: original.program,
          quote: original.quote,
          quoteDecimals: original.quoteDecimals,
          config: original.config,
          collector: original.collector,
          treasury: original.treasury,
          dammConfig: original.dammConfig,
          idl: JSON.parse(fs.readFileSync("target/idl/vestra.json", "utf8")),
          rpc: "http://127.0.0.1:8899",
          mockQuote: true,
        });
      if (req.method === "GET" && url.pathname === "/api/launches")
        return json(res, {
          launches: (await discover()).map((x) => x.public),
          keeper: { busy: keeperBusy, error: keeperError, lastRun: lastKeeper },
        });
      if (req.method === "POST" && url.pathname === "/api/catalog") {
        const b = await body(req);
        const item = (await discover()).find(
          (x) => x.public.address === b.launch,
        );
        if (!item) throw new Error("Launch not registered with this collector");
        if (catalog[b.launch]) {
          if (
            catalog[b.launch].name === b.name &&
            catalog[b.launch].symbol === b.symbol
          )
            return json(res, { ok: true });
          throw new Error("Metadata already exists");
        }
        if (
          typeof b.name !== "string" ||
          b.name.length < 2 ||
          b.name.length > 32 ||
          typeof b.symbol !== "string" ||
          !/^[A-Z0-9]{2,10}$/.test(b.symbol)
        )
          throw new Error("Invalid token metadata");
        catalog[b.launch] = {
          name: b.name,
          symbol: b.symbol,
          avatar: ["✦", "◈", "◎", "✳", "↗"].includes(b.avatar)
            ? b.avatar
            : "✦",
        };
        fs.writeFileSync(catalogFile, JSON.stringify(catalog, null, 2), {
          mode: 0o600,
        });
        return json(res, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/api/faucet") {
        const b = await body(req),
          owner = new PublicKey(b.wallet),
          key = owner.toBase58();
        if (!PublicKey.isOnCurve(owner.toBytes()))
          throw new Error("Wallet must be on curve");
        if ((faucetCounts.get(key) || 0) >= 3)
          throw new Error(
            "Local faucet limit reached for this wallet; restart the service to reset",
          );
        faucetCounts.set(key, (faucetCounts.get(key) || 0) + 1);
        const sol = await c.connection.requestAirdrop(owner, 2_000_000_000);
        const block = await c.connection.getLatestBlockhash();
        await c.connection.confirmTransaction(
          { ...block, signature: sol },
          "confirmed",
        );
        const destination = await getOrCreateAssociatedTokenAccount(
          c.connection,
          c.payer,
          pk(original.quote),
          owner,
        );
        const source = await ata(c, pk(original.quote), c.payer.publicKey);
        const signature = await transfer(
          c.connection,
          c.payer,
          source,
          destination.address,
          c.payer,
          100_000_000n,
        );
        return json(res, {
          signature,
          sol,
          quote: "100",
          label: "Local mock assets only",
        });
      }
      if (req.method === "POST" && url.pathname === "/api/keeper") {
        void keeper();
        return json(res, { ok: true, busy: keeperBusy });
      }
      return json(res, { error: "Not found" }, 404);
    } catch (e) {
      json(res, { error: e instanceof Error ? e.message : String(e) }, 400);
    }
  });
  server.listen(8787, "127.0.0.1", () => {
    console.log(
      "Vestra local service: http://127.0.0.1:8787 (collector keys remain on disk)",
    );
    void keeper();
  });
  const timer = setInterval(() => void keeper(), 5000);
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      clearInterval(timer);
      server.close();
      process.exit(0);
    });
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
