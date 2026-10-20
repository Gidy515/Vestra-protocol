import { friendlyError, rateLimited } from "./network-errors";
import { Stocks } from "./Stocks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownUp,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  ExternalLink,
  Flame,
  Gift,
  Layers3,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Wallet as WalletIcon,
  X,
} from "lucide-react";
import {
  api,
  Chain,
  injectedWallet,
  localWallet,
  price,
  progress,
  units,
  type Bootstrap,
  type Launch,
  type Position,
  type Wallet,
} from "./chain";

const short = (s: string) => s.slice(0, 4) + "…" + s.slice(-4);
const number = (n: number, digits = 4) =>
  new Intl.NumberFormat("en", { maximumFractionDigits: digits }).format(n);
const prettyError = friendlyError;
import { localTokenLogo } from "./token-logo";

function TokenLogo({value}: {value: string}) {
  return /^data:image\/(png|jpeg|webp);base64,/.test(value) ? <img src={value} alt="" className="uploaded-token-logo" /> : <>{value}</>;
}
const avatars = ["✦", "◈", "◎", "✳", "↗"];
type Activity = { signature: string; time: number };
type Data = {
  launches: Launch[];
  keeper: { busy: boolean; error: string; lastRun: number; pendingEpochs?: number };
};
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2)
    return (
      <div className="chart-empty">
        <Layers3 size={24} />
        <span>Live price samples appear as this page refreshes.</span>
      </div>
    );
  const lo = Math.min(...values),
    hi = Math.max(...values),
    range = hi - lo || Math.max(hi * 0.01, 1e-9);
  const points = values
    .map(
      (n, i) =>
        `${(i / (values.length - 1)) * 760},${140 - ((n - lo) / range) * 110}`,
    )
    .join(" ");
  return (
    <svg
      className="price-chart"
      viewBox="0 0 760 170"
      role="img"
      aria-label="Live price observations from this session"
    >
      <defs>
        <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#A896FF" stopOpacity=".2" />
          <stop offset="1" stopColor="#A896FF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d={`M0 170 L${points.split(" ").join(" L")} L760 170Z`}
        fill="url(#chart-fill)"
      />
      <polyline
        points={points}
        stroke="#A896FF"
        strokeWidth="3"
        fill="none"
        strokeLinejoin="round"
      />
      <path
        d="M0 150H760 M0 90H760 M0 30H760"
        stroke="#9CA3BC"
        strokeOpacity=".08"
      />
    </svg>
  );
}
export default function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null),
    [data, setData] = useState<Data>({
      launches: [],
      keeper: { busy: false, error: "", lastRun: 0 },
    });
  const [loadError, setLoadError] = useState(""),
    [loading, setLoading] = useState(true),
    [wallet, setWallet] = useState<Wallet | null>(null);
  const [view, setView] = useState<"explore" | "positions" | "stocks">("explore"),
    [selected, setSelected] = useState(
      new URLSearchParams(location.search).get("launch") || "",
    );
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [sort, setSort] = useState("newest");
  const [modal, setModal] = useState<"wallet" | "launch" | null>(null),
    [busy, setBusy] = useState(""),
    [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const [tab, setTab] = useState<"trade" | "lock">("trade"),
    [buy, setBuy] = useState(true),
    [amount, setAmount] = useState(""),
    [slippage, setSlippage] = useState("1"),
    [tier, setTier] = useState(1);
  const [quote, setQuote] = useState<{ out: string; venue: string } | null>(
      null,
    ),
    [quoteError, setQuoteError] = useState(""),
    [quoteBusy, setQuoteBusy] = useState(false);
  const [balances, setBalances] = useState({ base: "0", quote: "0", sol: 0 }),
    [positions, setPositions] = useState<Record<string, Position[]>>({});
  const [positionsSnapshot, setPositionsSnapshot] = useState<Chain | null>(null);
  const [positionsFailure, setPositionsFailure] = useState<{ chain: Chain; message: string } | null>(null);
  const [name, setName] = useState(""),
    [symbol, setSymbol] = useState(""),
    [avatar, setAvatar] = useState("✦"),
    [launchStep, setLaunchStep] = useState("");
  const [logoBusy, setLogoBusy] = useState(false);
  const [activity, setActivity] = useState<Activity[]>([]),
    [history, setHistory] = useState<Record<string, number[]>>({}),
    [now, setNow] = useState(Date.now() / 1000);
  const refreshBackoff = useRef({ until: 0, attempts: 0 });
  const walletIntent = useRef(0);
  const clockOffset = useRef(0),
    refreshing = useRef(false);
  const show = (text: string, error = false) => setToast({ text, error });
  const confirmed = useCallback((signature: string) => {
    setActivity((a) => [{ signature, time: Date.now() }, ...a].slice(0, 12));
  }, []);
  const chain = useMemo(
    () => (boot && wallet ? new Chain(boot, wallet, confirmed) : null),
    [boot, wallet, confirmed],
  );
  const chainRef = useRef(chain);
  chainRef.current = chain;
  const positionsReady = !!chain && positionsSnapshot === chain;
  const positionsError = positionsFailure?.chain === chain ? positionsFailure.message : "";
  const current = data.launches.find((l) => l.address === selected) || null;
  const refresh = useCallback(async () => {
    if (refreshing.current || Date.now() < refreshBackoff.current.until) return;
    refreshing.current = true;
    try {
      const result = await api<Data>("launches");
      setData(result);
      setLoadError("");
      setHistory((h) => {
        const next = { ...h };
        for (const l of result.launches)
          next[l.address] = [...(h[l.address] || []), price(l)].slice(-60);
        return next;
      });
      if (chain) {
        const time = await chain.time();
        clockOffset.current = time - Date.now() / 1000;
        const list: Record<string, Position[]> = {};
        for (const l of result.launches)
          list[l.address] = await chain.positions(l);
        if (chainRef.current !== chain) return;
        setPositions(list);
        setPositionsSnapshot(chain);
        setPositionsFailure(null);
        const chosen =
          result.launches.find((l) => l.address === selected) ||
          result.launches[0];
        if (chosen) setBalances(await chain.balances(chosen));
      }
      refreshBackoff.current = { until: 0, attempts: 0 };
    } catch (e) {
      if (rateLimited(e)) {
        const attempts = refreshBackoff.current.attempts + 1;
        refreshBackoff.current = { attempts, until: Date.now() + Math.min(60_000, 5000 * 2 ** Math.min(attempts, 4)) };
      }
      if (chain && chainRef.current === chain) setPositionsFailure({ chain, message: prettyError(e) });
      setLoadError(prettyError(e));
    } finally {
      setLoading(false);
      refreshing.current = false;
    }
  }, [chain, selected]);
  useEffect(() => {
    api<Bootstrap>("bootstrap")
      .then(setBoot)
      .catch((e) => {
        setLoadError(prettyError(e));
        setLoading(false);
      });
  }, []);
  useEffect(() => {
    if (!boot) return;
    let cancelled = false;
    const intent = walletIntent.current;
    const kind = localStorage.getItem("vestra-wallet-choice");
    const restore = kind === "Phantom" || kind === "Solflare"
      ? injectedWallet(kind, true)
      : kind === "Local test" && boot.cluster === "localnet"
        ? Promise.resolve(localWallet()) : null;
    restore?.then(value => {if (!cancelled && walletIntent.current === intent) setWallet(value);}).catch(() => {
      // Locked/revoked wallets require an explicit user connection; never prompt on refresh.
    });
    return () => {cancelled = true;};
  }, [boot]);
  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), boot?.cluster === "devnet" ? 15000 : 8000);
    return () => clearInterval(id);
  }, [refresh, boot?.cluster]);
  useEffect(() => {
    const id = setInterval(
      () => setNow(Date.now() / 1000 + clockOffset.current),
      1000,
    );
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 9000);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    if (!chain || !current) return;
    let active = true;
    chain
      .balances(current)
      .then((b) => {
        if (active) setBalances(b);
      })
      .catch((e) => show(prettyError(e), true));
    return () => {
      active = false;
    };
  }, [chain, current?.address]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector(".modal") as HTMLElement | null;
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input,a[href],select",
        ) || [],
      );
    focusable()[0]?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setModal(null);
      if (event.key === "Tab") {
        const list = focusable(),
          first = list[0],
          last = list.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, [modal, busy]);
  useEffect(() => {
    const handler = () =>
      setSelected(new URLSearchParams(location.search).get("launch") || "");
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);
  useEffect(
    () =>
      wallet?.subscribe?.((key) =>
        (() => {
          if (!key) {walletIntent.current++;localStorage.removeItem("vestra-wallet-choice");}
          setWallet(key ? { ...wallet, publicKey: key } : null);
        })(),
      ),
    [wallet],
  );
  useEffect(() => {
    if (!wallet) {
      setPositions({});
      setBalances({ base: "0", quote: "0", sol: 0 });
    }
  }, [wallet]);
  useEffect(() => {
    let cancelled = false;
    setQuote(null);
    setQuoteError("");
    setQuoteBusy(false);
    if (!current || !chain || tab !== "trade" || !amount) return;
    setQuoteBusy(true);
    const id = setTimeout(() => {
      chain
        .quote(current, buy, amount, Math.round(Number(slippage) * 100))
        .then((q) => {
          if (!cancelled) setQuote({ out: q.out, venue: q.venue });
        })
        .catch((e) => {
          if (!cancelled) setQuoteError(prettyError(e));
        })
        .finally(() => {
          if (!cancelled) setQuoteBusy(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [chain, current?.address, current?.migrated, buy, amount, slippage, tab]);
  function select(l: Launch | null) {
    const next = l?.address || "";
    setSelected(next);
    setView("explore");
    setAmount("");
    setQuote(null);
    historyPush(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function historyPush(address: string) {
    window.history.pushState(
      {},
      "",
      address ? "?launch=" + address : location.pathname,
    );
  }
  async function action(label: string, fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(label);
    try {
      await fn();
      show(label + " confirmed");
      await refresh();
    } catch (e) {
      show(prettyError(e), true);
      await refresh();
    } finally {
      setBusy("");
    }
  }
  async function connect(kind: "Phantom" | "Solflare" | "Local test") {
    if (kind === "Local test" && boot?.cluster === "devnet") { show("Use Phantom or Solflare on devnet"); return; }
    walletIntent.current++;
    await action("Wallet connection", async () => {
      setWallet(
        kind === "Local test" ? localWallet() : await injectedWallet(kind),
      );
      localStorage.setItem("vestra-wallet-choice", kind);
      setModal(null);
    });
  }
  const totals = data.launches.reduce(
    (a, l) => ({
      funded: a.funded + BigInt(l.funded),
      paid: a.paid + BigInt(l.lockerPaid),
      locked: a.locked + BigInt(l.locked),
    }),
    { funded: 0n, paid: 0n, locked: 0n },
  );
  const list = data.launches
    .filter(
      (l) =>
        (filter === "all" ||
          (filter === "curve" && !l.migrated) ||
          (filter === "graduated" && l.migrated)) &&
        `${l.name} ${l.symbol} ${l.base}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "fees"
        ? Number(BigInt(b.funded) - BigInt(a.funded))
        : sort === "locked"
          ? Number(BigInt(b.locked) - BigInt(a.locked))
          : b.origin - a.origin,
    );
  const portfolio = data.launches.flatMap((l) =>
    (positions[l.address] || []).map((p) => ({ l, p })),
  );
  const claimable = portfolio.reduce(
    (sum, { p }) => sum + BigInt(p.reward),
    0n,
  );
  function positionCard(l: Launch, p: Position) {
    const unlocked = now >= p.unlockAt,
      claimEnd = Math.min(l.currentEpoch, p.end),
      hasEpochs = p.next < claimEnd;
    return (
      <article className="position-card" key={p.address}>
        <div className="position-head">
          <div className="token-icon small"><TokenLogo value={l.avatar} /></div>
          <div>
            <strong>{l.name}</strong>
            <span>
              {l.symbol} · {short(p.address)}
            </span>
          </div>
          <span
            className={`badge ${p.withdrawn ? "neutral" : unlocked ? "mint" : "purple"}`}
          >
            {p.withdrawn ? "Withdrawn" : unlocked ? "Unlocked" : "Locked"}
          </span>
        </div>
        <div className="position-numbers">
          <div>
            <small>Principal</small>
            <strong>
              {units(p.amount)} <em>{l.symbol}</em>
            </strong>
          </div>
          <div>
            <small>Weight</small>
            <strong>{number(Number(p.weight) / Number(p.amount), 1)}×</strong>
          </div>
          <div>
            <small>Claimable rewards</small>
            <strong className="mint-text">
              {units(p.reward)} <em>mSTOCK</em>
            </strong>
          </div>
        </div>
        <div className="position-footer">
          <span>
            {p.withdrawn
              ? "Historical rewards remain claimable"
              : unlocked
                ? "Principal is ready to withdraw"
                : `Unlocks ${new Date(p.unlockAt * 1000).toLocaleString()}`}
          </span>
          <div>
            <button
              className="button secondary compact"
              disabled={!!busy || !hasEpochs}
              onClick={() =>
                void action("Reward claim", () => chain!.claim(l, p))
              }
            >
              {BigInt(p.reward) > 0n ? "Claim rewards" : "Settle epochs"}
            </button>
            <button
              className="button compact"
              disabled={!!busy || !unlocked || p.withdrawn}
              onClick={() =>
                void action("Principal withdrawal", () => chain!.withdraw(l, p))
              }
            >
              Withdraw
            </button>
          </div>
        </div>
        {hasEpochs && claimEnd - p.next > 10 && (
          <p className="micro">
            Up to 10 epochs per click, grouped into at most two transactions. Repeat to settle the remaining{" "}
            {claimEnd - p.next} epochs.
          </p>
        )}
      </article>
    );
  }
  return (
    <>
      <header className="header">
        <div className="header-inner">
          <button
            className="brand"
            onClick={() => select(null)}
            aria-label="Vestra home"
          >
            <img src="/brand/vestra-mark.svg" alt="" />
            <span>vestra</span>
          </button>
          <nav>
            <button
              className={view === "explore" ? "active" : ""}
              onClick={() => select(null)}
            >
              Explore
            </button>
            <button
              className={view === "positions" ? "active" : ""}
              onClick={() => {
                setView("positions");
                setSelected("");
                historyPush("");
              }}
            >
              My locks
            </button>
            <button className={view === "stocks" ? "active" : ""} onClick={() => {setView("stocks");setSelected("");historyPush("");}}>Stocks</button>
            <a href="#how-it-works" onClick={() => select(null)}>
              How it works
            </a>
          </nav>
          <div className="header-actions">
            <span className="network">
              <i />
              {boot?.cluster === "devnet" ? "Devnet" : "Localnet"}
            </span>
            <button
              className="button secondary launch-nav"
              disabled={!boot || !!busy}
              onClick={() => (wallet ? setModal("launch") : setModal("wallet"))}
            >
              <Plus size={16} />
              Launch token
            </button>
            <button
              className="button wallet-button"
              onClick={() => setModal("wallet")}
            >
              <WalletIcon size={16} />
              {wallet ? short(wallet.publicKey.toBase58()) : "Connect wallet"}
            </button>
          </div>
        </div>
      </header>
      <div className="demo-strip">
        <span>
          <ShieldCheck size={13} /> {boot?.cluster === "devnet" ? "DEVNET" : "LOCALNET"}
        </span>
        <p>
          mSTOCK is a mock quote asset. Rewards come from actual collected
          trading fees.
        </p>
        {wallet && boot && (
          <button
            disabled={!!busy}
            onClick={() =>
              void action("Test token funding", () =>
                api("faucet", boot, { wallet: wallet.publicKey.toBase58() }),
              )
            }
          >
            <Gift size={13} />
            Get test tokens
          </button>
        )}
      </div>
      <main className="main">
        {loadError && (
          <div className="notice error">
            <strong>
              {boot
                ? "Live data unavailable"
                : "Start the local service to connect Vestra"}
            </strong>
            <p>{loadError}</p>
            <small>
              Keep the API service running. For localnet also start the validator, then run{" "}
              <code>{boot?.cluster === "devnet" ? "npm run devnet:service" : "npm run app:service"}</code> in the repository root.
            </small>
            <button onClick={() => (boot ? void refresh() : location.reload())}>
              <RefreshCw size={14} />
              Retry
            </button>
          </div>
        )}
        {(!!data.keeper.pendingEpochs || !!data.keeper.error) && (() => {
          const sync = data.keeper.pendingEpochs
            ? `${data.keeper.pendingEpochs} reward ${data.keeper.pendingEpochs === 1 ? "epoch" : "epochs"} syncing automatically`
            : "Reward epochs are up to date";
          const messages = data.keeper.error
            ? [`Keeper: ${prettyError(data.keeper.error)}`, sync,
              "Keeper will retry automatically · Check service logs if the issue persists"]
            : [sync, "Finalized rewards remain claimable",
              "New locks become available when their launch is synced"];
          return (
            <div className="epoch-ticker" role="status">
              <span className="epoch-ticker-label"><span className={`epoch-ticker-dot${data.keeper.error ? " needs-attention" : ""}`} />Reward sync</span>
              <span className="epoch-ticker-accessible">{messages.join(". ")}</span>
              <div className="epoch-ticker-window" aria-hidden="true">
                <div className="epoch-ticker-track">
                  {[...messages, messages[0]].map((message, index) => (
                    <span key={index} title={message} className={data.keeper.error && (index === 0 || index === 3) ? "epoch-ticker-error" : undefined}>{message}</span>
                  ))}
                </div>
              </div>
              {data.keeper.error && <details className="epoch-ticker-details"><summary>Details</summary><p>{data.keeper.error}</p><small>The keeper retries automatically. Trading and principal withdrawals have separate on-chain checks.</small></details>}
            </div>
          );
        })()}
        {view === "stocks" ? <Stocks /> : view === "positions" ? (
          <>
            <div className="page-heading">
              <div>
                <span className="eyebrow">YOUR CONVICTION, ON CHAIN</span>
                <h1>My locks</h1>
                <p>Keep your position. Collect your share.</p>
              </div>
              <div className="reward-summary">
                <small>Claimable across your positions</small>
                <strong>
                  {positionsReady ? units(claimable) : "—"} <span>mSTOCK</span>
                </strong>
              </div>
            </div>
            {!wallet ? (
              <div className="empty">
                <WalletIcon size={34} />
                <h2>Your positions live here.</h2>
                <p>
                  Connect a wallet to see locked tokens and claimable rewards.
                </p>
                <button className="button" onClick={() => setModal("wallet")}>
                  Connect wallet
                </button>
              </div>
            ) : !positionsReady ? (
              <div className="empty" role="status" aria-busy={!positionsError}>
                {positionsError ? <>
                  <h2>Couldn’t load your locks.</h2>
                  <p>{positionsError}</p>
                  <button className="button" onClick={() => void refresh()}>Retry</button>
                </> : <>
                  <span className="positions-spinner" aria-hidden="true" />
                  <h2>Loading your locks</h2>
                  <p>Checking your positions and claimable rewards.</p>
                </>}
              </div>
            ) : portfolio.length ? (
              <div className="positions">
                {portfolio.map(({ l, p }) => positionCard(l, p))}
              </div>
            ) : (
              <div className="empty">
                <LockKeyhole size={34} />
                <h2>Make your first commitment.</h2>
                <p>
                  Buy a community token, choose a lock duration, and share in
                  funded fees.
                </p>
                <button className="button" onClick={() => select(null)}>
                  Explore launches
                  <ArrowRight size={16} />
                </button>
              </div>
            )}
            <p className="micro">
              Rewards shown cover finalized, unclaimed epochs. Zero-reward
              epochs can still need settlement. Transaction fees apply.
            </p>
          </>
        ) : current ? (
          <>
            <button className="back" onClick={() => select(null)}>
              <ArrowLeft size={16} />
              All launches
            </button>
            <div className="detail-heading">
              <div className="token-icon large"><TokenLogo value={current.avatar} /></div>
              <div>
                <h1>
                  {current.name}
                  <span>${current.symbol}</span>
                </h1>
                <div className="token-meta">
                  <span
                    className={`badge ${current.migrated ? "mint" : "purple"}`}
                  >
                    {current.migrated
                      ? "Graduated · DAMM v2"
                      : "Bonding curve · DBC"}
                  </span>
                  <button
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(current.base)
                        .then(() => show("Mint address copied"))
                    }
                  >
                    {short(current.base)}
                    <Copy size={12} />
                  </button>
                  <span>Paired with mSTOCK</span>
                </div>
              </div>
            </div>
            <div className="detail-grid">
              <section>
                <div className="panel chart-panel">
                  <div className="chart-heading">
                    <div>
                      <small>Spot price · mSTOCK</small>
                      <h2>{number(price(current), 8)}</h2>
                    </div>
                    <span className="live">
                      <i />
                      Live session
                    </span>
                  </div>
                  <Sparkline values={history[current.address] || []} />
                  <div className="chart-caption">
                    <span>Current on-chain pool price</span>
                    <span>
                      {current.migrated ? "DAMM v2" : "Meteora DBC"} · refreshes
                      every 8s
                    </span>
                  </div>
                </div>
                <div className="detail-stats">
                  <div>
                    <small>Funded fees</small>
                    <strong>
                      {units(current.funded)} <em>mSTOCK</em>
                    </strong>
                  </div>
                  <div>
                    <small>Paid to lockers</small>
                    <strong className="mint-text">
                      {units(current.lockerPaid)} <em>mSTOCK</em>
                    </strong>
                  </div>
                  <div>
                    <small>Tokens locked</small>
                    <strong>
                      {units(current.locked, 6, 2)} <em>{current.symbol}</em>
                    </strong>
                  </div>
                </div>
                <div className="panel curve-panel">
                  <div className="row-between">
                    <h3>
                      {current.migrated
                        ? "Liquidity graduated"
                        : "Graduation progress"}
                    </h3>
                    <span
                      className={current.migrated ? "mint-text" : "purple-text"}
                    >
                      {current.migrated ? (
                        <CheckCircle2 size={18} />
                      ) : (
                        number(progress(current), 1) + "%"
                      )}
                    </span>
                  </div>
                  <div className="progress">
                    <span style={{ width: progress(current) + "%" }} />
                  </div>
                  <p>
                    {current.migrated
                      ? "Trading continues on DAMM v2. Partner position fees continue funding locked holders."
                      : `${units(current.reserve)} / ${units(current.threshold)} mSTOCK on the curve. Graduation moves liquidity to DAMM v2.`}
                  </p>
                  {!current.migrated && progress(current) >= 100 && (
                    <button
                      className="button"
                      disabled={!chain || !!busy}
                      onClick={() =>
                        void action("Graduation", () =>
                          chain!.graduate(current),
                        )
                      }
                    >
                      Graduate to DAMM v2
                      <ArrowRight size={16} />
                    </button>
                  )}
                  {wallet?.publicKey.toBase58() === current.creator && (
                    <button
                      className="button secondary"
                      disabled={!!busy}
                      onClick={() =>
                        void action("Creator fee claim", () =>
                          chain!.creatorFees(current),
                        )
                      }
                    >
                      Claim creator fees
                      <Gift size={15} />
                    </button>
                  )}
                </div>
                <div className="section-heading">
                  <h2>Your positions</h2>
                  <span>
                    {positionsReady ? `${(positions[current.address] || []).length} positions` : "Loading…"}
                  </span>
                </div>
                {wallet ? (
                  !positionsReady ? (
                    <div className="empty small-empty" role="status" aria-busy={!positionsError}>
                      {positionsError ? <>
                        <p>Couldn’t load your locks.</p>
                        <button className="text-button" onClick={() => void refresh()}>Retry</button>
                      </> : <>
                        <span className="positions-spinner" aria-hidden="true" />
                        <p>Loading your locks…</p>
                      </>}
                    </div>
                  ) : (positions[current.address] || []).length ? (
                    <div className="positions">
                      {(positions[current.address] || []).map((p) =>
                        positionCard(current, p),
                      )}
                    </div>
                  ) : (
                    <div className="empty small-empty">
                      <LockKeyhole size={24} />
                      <p>No positions for this token yet.</p>
                      <button
                        className="text-button"
                        onClick={() => setTab("lock")}
                      >
                        Choose a lock duration
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  )
                ) : (
                  <div className="empty small-empty">
                    <p>Connect your wallet to view positions.</p>
                    <button
                      className="text-button"
                      onClick={() => setModal("wallet")}
                    >
                      Connect wallet
                      <ArrowRight size={14} />
                    </button>
                  </div>
                )}
              </section>
              <aside>
                <div className="panel action-panel">
                  <div className="tab-switch">
                    <button
                      className={tab === "trade" ? "active" : ""}
                      onClick={() => {
                        setTab("trade");
                        setAmount("");
                      }}
                    >
                      <ArrowDownUp size={15} />
                      Trade
                    </button>
                    <button
                      className={tab === "lock" ? "active" : ""}
                      onClick={() => {
                        setTab("lock");
                        setAmount("");
                      }}
                    >
                      <LockKeyhole size={15} />
                      Lock & earn
                    </button>
                  </div>
                  {tab === "trade" ? (
                    <>
                      <div className="buy-sell">
                        <button
                          className={buy ? "buy active" : ""}
                          onClick={() => {
                            setBuy(true);
                            setAmount("");
                          }}
                        >
                          Buy
                        </button>
                        <button
                          className={!buy ? "sell active" : ""}
                          onClick={() => {
                            setBuy(false);
                            setAmount("");
                          }}
                        >
                          Sell
                        </button>
                      </div>
                      <div className="input-box">
                        <div className="row-between">
                          <label htmlFor="trade-amount">You pay</label>
                          <button
                            className="balance"
                            onClick={() =>
                              setAmount(
                                units(buy ? balances.quote : balances.base),
                              )
                            }
                          >
                            Balance:{" "}
                            {units(buy ? balances.quote : balances.base, 6, 3)}
                          </button>
                        </div>
                        <div className="amount-row">
                          <input
                            id="trade-amount"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                          />
                          <span>{buy ? "mSTOCK" : current.symbol}</span>
                        </div>
                      </div>
                      <div className="swap-divider">
                        <ArrowDownUp size={15} />
                      </div>
                      <div className="input-box receive">
                        <small>Estimated receive</small>
                        <div className="amount-row">
                          <strong>
                            {quoteBusy
                              ? "…"
                              : quote
                                ? units(quote.out, 6, 4)
                                : "—"}
                          </strong>
                          <span>{buy ? current.symbol : "mSTOCK"}</span>
                        </div>
                      </div>
                      <div className="slippage">
                        <label htmlFor="slippage">Slippage tolerance</label>
                        <div>
                          <input
                            id="slippage"
                            type="number"
                            min="0.1"
                            max="5"
                            step="0.1"
                            value={slippage}
                            onChange={(e) => setSlippage(e.target.value)}
                          />
                          <span>%</span>
                        </div>
                      </div>
                      {quoteError && <p className="form-error">{quoteError}</p>}
                      <button
                        className={`button full ${buy ? "" : "sell-button"}`}
                        disabled={!!busy || (!!wallet && (!quote || quoteBusy))}
                        onClick={() =>
                          wallet
                            ? void action(
                                buy ? "Token purchase" : "Token sale",
                                () =>
                                  chain!.trade(
                                    current,
                                    buy,
                                    amount,
                                    Math.round(Number(slippage) * 100),
                                  ),
                              )
                            : setModal("wallet")
                        }
                      >
                        {busy ||
                          (!wallet
                            ? "Connect wallet"
                            : `${buy ? "Buy" : "Sell"} ${current.symbol}`)}
                        <ArrowRight size={16} />
                      </button>
                      <p className="micro">
                        Quotes refresh on input and again before signing. DBC
                        trades can partially fill at graduation. No leverage.
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="lock-intro">
                        <span className="pill">
                          <Sparkles size={12} />
                          Commit longer, earn more weight
                        </span>
                        <h3>Put conviction to work.</h3>
                        <p>Lock your tokens to share in funded trading fees.</p>
                      </div>
                      <div className="tier-options">
                        {[7, 30, 90].map((days, i) => (
                          <button
                            key={days}
                            className={tier === i ? "selected" : ""}
                            onClick={() => setTier(i)}
                          >
                            <strong>
                              {current.epochSeconds === 10
                                ? days * 10 + "s"
                                : current.epochSeconds === 60 ? days + " min" : days + " days"}
                            </strong>
                            <span>{[1, 1.5, 2][i]}× weight</span>
                            {tier === i && <Check size={12} />}
                          </button>
                        ))}
                      </div>
                      <div className="input-box">
                        <div className="row-between">
                          <label htmlFor="lock-amount">Tokens to lock</label>
                          <button
                            className="balance"
                            onClick={() => setAmount(units(balances.base))}
                          >
                            Balance: {units(balances.base, 6, 2)}
                          </button>
                        </div>
                        <div className="amount-row">
                          <input
                            id="lock-amount"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                          />
                          <span>{current.symbol}</span>
                        </div>
                      </div>
                      <div className="lock-terms">
                        <div>
                          <span>Reward asset</span>
                          <strong>mSTOCK</strong>
                        </div>
                        <div>
                          <span>Eligible from</span>
                          <strong>Next epoch</strong>
                        </div>
                        <div>
                          <span>Locker share of partner receipts</span>
                          <strong>75%</strong>
                        </div>
                        <div>
                          <span>Early withdrawal</span>
                          <strong>Unavailable</strong>
                        </div>
                      </div>
                      <button
                        className="button full"
                        disabled={!!busy || (!!wallet && !amount)}
                        onClick={() =>
                          wallet
                            ? void action("Token lock", () =>
                                chain!.lock(current, amount, tier),
                              )
                            : setModal("wallet")
                        }
                      >
                        {busy || (!wallet ? "Connect wallet" : "Lock tokens")}
                        <LockKeyhole size={16} />
                      </button>
                      <p className="micro">
                        Locks cannot be cancelled.{" "}
                        {current.epochSeconds === 10
                          ? "Localnet uses 10-second epochs."
                          : current.epochSeconds === 60 ? "Devnet uses 60-second epochs." : "Production uses daily epochs."}{" "}
                        Rewards vary with funded fees; no guaranteed yield.
                      </p>
                    </>
                  )}
                  {wallet && (
                    <div className="wallet-foot">
                      <WalletIcon size={13} />
                      {wallet.kind}
                      <span>{number(balances.sol / 1e9, 3)} {boot?.cluster === "devnet" ? "devnet" : "local"} SOL</span>
                    </div>
                  )}
                </div>
                <div className="panel note-panel">
                  <ShieldCheck size={20} />
                  <div>
                    <strong>Commitment, rewarded.</strong>
                    <p>
                      Your principal sits in Vestra’s token vault. Fee rewards
                      are funded separately and remain claimable after
                      withdrawal.
                    </p>
                  </div>
                </div>
              </aside>
            </div>
          </>
        ) : (
          <>
            <section className="hero">
              <div className="hero-copy">
                <span className="eyebrow">
                  <span className="little-star">✦</span> THE LAUNCHPAD FOR
                  CONVICTION
                </span>
                <h1>
                  Launch a token.
                  <br />
                  <span>Give holders a reason to stay.</span>
                </h1>
                <p>
                  Pair with a quote asset. Let holders lock their tokens
                  <br className="desktop-break" /> and share in the trading fees
                  they help create.
                </p>
                <div className="hero-actions">
                  <button
                    className="button"
                    disabled={!boot || !!busy}
                    onClick={() =>
                      wallet ? setModal("launch") : setModal("wallet")
                    }
                  >
                    Launch a token
                    <ArrowRight size={17} />
                  </button>
                  <a href="#markets" className="text-button">
                    Explore launches
                    <ChevronDown size={15} />
                  </a>
                </div>
                <div className="hero-proof">
                  <span>
                    <LockKeyhole size={13} />
                    Duration-weighted locks
                  </span>
                  <span>
                    <Layers3 size={13} />
                    Powered by Meteora
                  </span>
                </div>
              </div>
              <div className="hero-art" aria-hidden="true">
                <div className="orbit orbit-one" />
                <div className="orbit orbit-two" />
                <div className="hero-logo">
                  <img src="/brand/vestra-mark.svg" alt="" />
                </div>
                <div className="art-chip chip-one">
                  <LockKeyhole size={14} />
                  2× conviction
                </div>
                <div className="art-chip chip-two">
                  <Gift size={14} />
                  Share in fees
                </div>
                <div className="orbit-dot dot-one" />
                <div className="orbit-dot dot-two" />
                <div className="art-grid" />
              </div>
            </section>
            <section className="platform-stats">
              <div>
                <small>Launches</small>
                <strong>
                  {data.launches.length}
                  <span>on Vestra</span>
                </strong>
              </div>
              <div>
                <small>Fees funded</small>
                <strong>
                  {units(totals.funded, 6, 4)}
                  <span>mSTOCK</span>
                </strong>
              </div>
              <div>
                <small>Paid to lockers</small>
                <strong className="mint-text">
                  {units(totals.paid, 6, 4)}
                  <span>mSTOCK</span>
                </strong>
              </div>
              <div>
                <small>Graduated launches</small>
                <strong>
                  {data.launches.filter((l) => l.migrated).length}
                  <span>DAMM v2 pools</span>
                </strong>
              </div>
            </section>
            <section id="markets" className="markets">
              <div className="section-heading">
                <div>
                  <h2>
                    Find your conviction
                    <span className="count">{list.length}</span>
                  </h2>
                  <p>Community tokens. Real locks. Funded rewards.</p>
                </div>
                <button
                  className="icon-button"
                  disabled={loading}
                  onClick={() => void refresh()}
                  aria-label="Refresh launches"
                >
                  <RefreshCw size={16} />
                </button>
              </div>
              <div className="market-toolbar">
                <div className="filters">
                  {[
                    ["all", "All launches"],
                    ["curve", "On the curve"],
                    ["graduated", "Graduated"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      className={filter === id ? "active" : ""}
                      onClick={() => setFilter(id)}
                    >
                      {id === "curve" && <Flame size={13} />} {label}
                    </button>
                  ))}
                </div>
                <div className="search-sort">
                  <label className="search">
                    <Search size={16} />
                    <input
                      aria-label="Search launches"
                      placeholder="Search tokens or mint…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  <select
                    aria-label="Sort launches"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="newest">Newest</option>
                    <option value="fees">Funded fees</option>
                    <option value="locked">Locked supply</option>
                  </select>
                </div>
              </div>
              {loading ? (
                <div className="empty">
                  <RefreshCw className="spin" size={28} />
                  <p>Reading launches from the validator…</p>
                </div>
              ) : list.length ? (
                <div className="token-grid">
                  {list.map((l, i) => (
                    <button
                      className="token-card"
                      key={l.address}
                      onClick={() => select(l)}
                    >
                      <div className="card-top">
                        <div className={`token-icon color-${i % 4}`}>
                          <TokenLogo value={l.avatar} />
                        </div>
                        <span
                          className={`badge ${l.migrated ? "mint" : "purple"}`}
                        >
                          {l.migrated ? "Graduated" : "On the curve"}
                        </span>
                      </div>
                      <div className="card-title">
                        <h3>{l.name}</h3>
                        <span>${l.symbol}</span>
                      </div>
                      <div className="pair">
                        <span className="quote-dot">m</span>Paired with mSTOCK
                        <ArrowRight size={13} />
                      </div>
                      <div className="card-numbers">
                        <div>
                          <small>Funded fees</small>
                          <strong>
                            {units(l.funded, 6, 4)}
                            <em>mSTOCK</em>
                          </strong>
                        </div>
                        <div>
                          <small>Locked supply</small>
                          <strong>
                            {number(
                              (Number(l.locked) / Number(l.supply)) * 100,
                              2,
                            )}
                            <em>%</em>
                          </strong>
                        </div>
                      </div>
                      <div className="card-progress">
                        <div className="row-between">
                          <span>
                            {l.migrated ? "DAMM v2 liquidity" : "Bonding curve"}
                          </span>
                          <strong>
                            {l.migrated ? (
                              <Check size={12} />
                            ) : (
                              number(progress(l), 1) + "%"
                            )}
                          </strong>
                        </div>
                        <div className="progress">
                          <span style={{ width: progress(l) + "%" }} />
                        </div>
                      </div>
                      <div className="card-footer">
                        <span>{short(l.creator)}</span>
                        <span>
                          View launch
                          <ArrowRight size={13} />
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="empty">
                  <Search size={30} />
                  <h3>
                    {search || filter !== "all"
                      ? "No matching launches"
                      : "Your first launch starts here."}
                  </h3>
                  <p>
                    {search || filter !== "all"
                      ? "Try another search or category."
                      : "Connect your wallet and create a community token."}
                  </p>
                  <button
                    className="button secondary"
                    disabled={!boot}
                    onClick={() =>
                      wallet ? setModal("launch") : setModal("wallet")
                    }
                  >
                    Launch a token
                    <Plus size={15} />
                  </button>
                </div>
              )}
            </section>
            <section id="how-it-works" className="how">
              <div>
                <span className="eyebrow">BUILT FOR HOLDERS WHO STAY</span>
                <h2>A launch is just the beginning.</h2>
              </div>
              <div className="how-grid">
                {[
                  [
                    "01",
                    "Launch a community",
                    "Create a token on Meteora’s bonding curve, paired with our mock quote asset.",
                    Plus,
                  ],
                  [
                    "02",
                    "Lock your conviction",
                    "Choose a duration. Longer locks carry more weight in the funded reward pool.",
                    LockKeyhole,
                  ],
                  [
                    "03",
                    "Share in trading fees",
                    "Claim your share of finalized rewards. Fee funding continues after graduation.",
                    Gift,
                  ],
                ].map(([n, title, text, Icon]) => {
                  const Component = Icon as typeof Plus;
                  return (
                    <article key={n as string}>
                      <div>
                        <Component size={22} />
                        <span>{n as string}</span>
                      </div>
                      <h3>{title as string}</h3>
                      <p>{text as string}</p>
                    </article>
                  );
                })}
              </div>
            </section>
          </>
        )}
        {activity.length > 0 && (
          <section className="activity">
            <div className="section-heading">
              <h3>Confirmed in this session</h3>
              <span>{activity.length} transactions</span>
            </div>
            {activity.slice(0, 4).map((a) => (
              <div key={a.signature}>
                <CheckCircle2 size={14} />
                {boot?.cluster === "devnet" ? <a href={`https://explorer.solana.com/tx/${a.signature}?cluster=devnet`} target="_blank" rel="noreferrer"><code>{short(a.signature)}</code></a> : <code>{short(a.signature)}</code>}
                <span>{new Date(a.time).toLocaleTimeString()}</span>
                <button
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(a.signature)
                      .then(() => show("Transaction signature copied"))
                  }
                  aria-label="Copy transaction signature"
                >
                  <Copy size={13} />
                </button>
              </div>
            ))}
          </section>
        )}
      </main>
      <footer>
        <div className="brand">
          <img src="/brand/vestra-mark.svg" alt="" />
          <span>vestra</span>
        </div>
        <span>Launch with conviction.</span>
        <a
          href="https://github.com/Gidy515/Vestra-protocol"
          target="_blank"
          rel="noreferrer"
        >
          Source code
          <ExternalLink size={13} />
        </a>
      </footer>
      {toast && (
        <div
          role={toast.error ? "alert" : "status"}
          className={`toast ${toast.error ? "error" : ""}`}
        >
          {toast.error ? <X size={18} /> : <CheckCircle2 size={18} />}
          <span>{toast.text}</span>
          <button
            onClick={() => setToast(null)}
            aria-label="Dismiss notification"
          >
            <X size={15} />
          </button>
        </div>
      )}
      {busy && (
        <div className="pending">
          <RefreshCw size={14} className="spin" />
          {busy}…{" "}
          {launchStep && modal === "launch"
            ? launchStep
            : "Confirm any wallet prompts."}
        </div>
      )}
      {modal && (
        <div className="modal-backdrop" onClick={() => !busy && setModal(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              aria-label="Close dialog"
              disabled={!!busy}
              onClick={() => setModal(null)}
            >
              <X size={20} />
            </button>
            {modal === "wallet" ? (
              <>
                <div className="modal-icon">
                  <WalletIcon size={25} />
                </div>
                <h2 id="dialog-title">
                  {wallet ? "Your wallet" : "Connect to Vestra"}
                </h2>
                <p>
                  Test-network transactions. Your wallet signs your trades
                  and locks.
                </p>
                {wallet ? (
                  <>
                    <div className="connected-wallet">
                      <strong>{wallet.kind}</strong>
                      <code>{wallet.publicKey.toBase58()}</code>
                    </div>
                    <button
                      className="button secondary full"
                      disabled={!!busy}
                      onClick={() =>
                        void action("Wallet disconnection", async () => {
                          walletIntent.current++;
                          localStorage.removeItem("vestra-wallet-choice");
                          await wallet.disconnect?.();
                          setWallet(null);
                          setModal(null);
                        })
                      }
                    >
                      Disconnect
                    </button>
                  </>
                ) : (
                  <div className="wallet-options">
                    <button
                      disabled={!!busy}
                      onClick={() => void connect("Phantom")}
                    >
                      <span className="wallet-symbol phantom">◉</span>
                      <strong>Phantom</strong>
                      <ArrowRight size={16} />
                    </button>
                    <button
                      disabled={!!busy}
                      onClick={() => void connect("Solflare")}
                    >
                      <span className="wallet-symbol solflare">✳</span>
                      <strong>Solflare</strong>
                      <ArrowRight size={16} />
                    </button>
                    <button
                      disabled={!!busy || !boot || boot.cluster === "devnet"}
                      onClick={() => void connect("Local test")}
                    >
                      <span className="wallet-symbol local">
                        <Layers3 size={20} />
                      </span>
                      <div>
                        <strong>Local test wallet</strong>
                        <small>{boot?.cluster === "devnet" ? "Localnet only — use Phantom or Solflare" : "No extension needed"}</small>
                      </div>
                      <ArrowRight size={16} />
                    </button>
                  </div>
                )}
                <p className="micro">
                  The local test wallet is generated in this browser and retained for
                  this tab’s session. Never send real assets to it. Extensions
                  must support the selected network. For devnet, select Devnet in your wallet settings.
                </p>
              </>
            ) : (
              <>
                <div className="modal-icon">
                  <Plus size={25} />
                </div>
                <h2 id="dialog-title">Launch with conviction.</h2>
                <p>
                  Create your community token. Locks and funded rewards are
                  built in.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action("Launch creation", async () => {
                      const address = await chain!.create(
                        name.trim(),
                        symbol.trim(),
                        avatar,
                        setLaunchStep,
                      );
                      setModal(null);
                      setSelected(address);
                      historyPush(address);
                      setName("");
                      setSymbol("");
                      setLaunchStep("");
                    });
                  }}
                >
                  <label className="field">
                    Token name
                    <input
                      required
                      minLength={2}
                      maxLength={32}
                      value={name}
                      placeholder="Your next big idea"
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    Ticker
                    <input
                      required
                      pattern="[A-Z0-9]{2,10}"
                      minLength={2}
                      maxLength={10}
                      value={symbol}
                      placeholder="VEST"
                      onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                    />
                  </label>
                  <label className="field">
                    Token icon
                    <input type="file" accept="image/png,image/jpeg,image/webp" disabled={!!busy || logoBusy}
                      onChange={async event => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (!file) return;
                        setLogoBusy(true);
                        try {setAvatar(await localTokenLogo(file));} catch (error) {show(prettyError(error), true);} finally {setLogoBusy(false);}
                      }} />
                    <span className="micro">Upload PNG, JPEG or WebP (up to 5 MB). Images are cropped to a square.</span>
                    <div className="token-icon large"><TokenLogo value={avatar} /></div>
                    <div className="avatar-options">
                      {avatars.map((a) => (
                        <button
                          type="button"
                          key={a}
                          className={a === avatar ? "selected" : ""}
                          onClick={() => setAvatar(a)}
                        >
                          {a}
                        </button>
                      ))}
                    </div>
                  </label>
                  <div className="launch-config">
                    <div>
                      <span>Quote asset</span>
                      <strong>mSTOCK · test asset</strong>
                      <small>Stock pairs require a verified compatible devnet mint and a matching launch config. None is configured yet.</small>
                    </div>
                    <div>
                      <span>Token supply</span>
                      <strong>1,000,000</strong>
                    </div>
                    <div>
                      <span>Trading fee</span>
                      <strong>1%</strong>
                    </div>
                    <div>
                      <span>Creator fee allocation</span>
                      <strong>20% of distributable DBC fees</strong>
                    </div>
                    <div>
                      <span>Graduation threshold</span>
                      <strong>100 mSTOCK</strong>
                    </div>
                  </div>
                  <p className="micro">
                    The shared launch config uses immutable base mints and
                    permanently locked DAMM liquidity. Platform and collector
                    addresses are fixed at registration.
                  </p>
                  <button
                    type="submit"
                    className="button full"
                    disabled={!!busy || !chain || logoBusy}
                  >
                    {busy ? launchStep || busy : "Create launch"}
                    <ArrowRight size={16} />
                  </button>
                  {sessionStorage.getItem("vestra-launch-draft") && (
                    <div className="draft-note">
                      <p>
                        An unfinished launch is saved. Retrying resumes its
                        original name and ticker.
                      </p>
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => {
                          sessionStorage.removeItem("vestra-launch-draft");
                          show(
                            "Draft cleared. Any confirmed pool remains on chain.",
                          );
                          setLaunchStep("");
                        }}
                      >
                        Discard draft
                      </button>
                    </div>
                  )}
                </form>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
