// Serialize HTTP RPC calls and retry only read methods. Never resubmit a transaction here.
export function rpcTransport(base: typeof fetch = globalThis.fetch.bind(globalThis), pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {
  let tail = Promise.resolve();
  let cooldownUntil = 0;
  const pending = new Map<string, Promise<Response>>();
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const body = typeof init?.body === "string" ? init.body : "";
    let method = "";
    try { method = JSON.parse(body).method || ""; } catch {}
    const read = /^(get|isBlockhashValid)/.test(method);
    const key = String(input) + body;
    if (read && pending.has(key)) return (await pending.get(key)!).clone();
    const work = tail.then(async () => {
      if (cooldownUntil > Date.now()) await pause(cooldownUntil - Date.now());
      for (let attempt = 0; ; attempt++) {
        const response = await base(input, init);
        if (response.status !== 429) { await pause(120); return response; }
        const retry = Number(response.headers.get("Retry-After"));
        const delay = Math.min(30_000, Math.max(2000 * 2 ** attempt, Number.isFinite(retry) ? retry * 1000 : 0));
        cooldownUntil = Date.now() + delay;
        if (!read || attempt >= 2) return response;
        await response.text();
        await pause(delay);
      }
    });
    tail = work.then(() => {}, () => {});
    if (read) pending.set(key, work);
    try { return (await work).clone(); }
    finally { if (pending.get(key) === work) pending.delete(key); }
  }) as typeof fetch;
}
