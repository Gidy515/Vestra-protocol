const hosts = new Set([
  "127.0.0.1:8787",
  "localhost:8787",
  "127.0.0.1:5173",
  "localhost:5173",
]);
const origins = new Set(["http://127.0.0.1:5173", "http://localhost:5173"]);
export function allowedLocalRequest(
  host: string,
  origin: string | undefined,
  method: string,
  token: string | undefined,
  session: string,
): boolean {
  return (
    hosts.has(host) &&
    (!origin || origins.has(origin)) &&
    (method !== "POST" || token === session)
  );
}
