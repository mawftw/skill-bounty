// JSON transport seam for the LP-safety data sources. Production calls use
// Node's global fetch; tests and the fixture recorder swap the responder so
// analyze() can replay saved RPC/API responses without touching the network.

export type Responder = (url: string, init: RequestInit) => Promise<any>;

const DEFAULT_TIMEOUT_MS = 12_000;

async function withDeadline<T>(
  timeoutMs: number,
  call: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    ctrl.abort(new Error(`source request exceeded ${timeoutMs}ms`));
  }, timeoutMs);
  try {
    return await call(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function readJsonResponse(res: Response, url: string): Promise<any> {
  if (!res.ok) {
    const host = (() => {
      try {
        return new URL(url).host;
      } catch {
        return "source";
      }
    })();
    throw new Error(`${host} HTTP ${res.status}`);
  }
  return res.json();
}

// Default network responder. Kept exported so the fixture recorder can capture
// real source responses through exactly the same path the CLI uses.
export async function liveFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<any> {
  return withDeadline(timeoutMs, async (signal) => {
    const res = await fetch(url, { ...init, signal });
    return readJsonResponse(res, url);
  });
}

const live: Responder = (u, i) => liveFetch(u, i);
let responder: Responder = live;

// Swap the transport (tests / fixture recorder). Pass null to restore live network.
export function setResponder(r: Responder | null): void {
  responder = r ?? live;
}

// Single network entry point for every source client. Delegates to the active
// responder (live by default) — caller signature is unchanged.
export async function getJson(url: string, init: RequestInit = {}): Promise<any> {
  return responder(url, init);
}

// Strip the query string from a URL (which can carry a credential), keeping host+path.
function originPath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.split("?")[0];
  }
}

// A request fingerprint that NEVER contains a secret, used to key fixtures.
// RPC POSTs key on method+params ONLY — so the Helius api-key in the RPC URL never
// enters a fixture, and a fixture replays regardless of which RPC recorded it.
// Keyless REST GETs key on method+url (RugCheck/GoPlus/Meteora carry no key in the
// query — only mints/addresses). A non-JSON-RPC POST (none exist today; defensive)
// keys on host+path ONLY, never its query string, so a credentialed RPC URL can't
// leak through the fallback.
export function requestKey(url: string, init: RequestInit = {}): string {
  const method = (init.method ?? "GET").toUpperCase();
  if (method === "POST") {
    if (typeof init.body === "string") {
      try {
        const b = JSON.parse(init.body);
        if (b?.jsonrpc) return `RPC ${b.method} ${JSON.stringify(b.params)}`;
      } catch {
        /* not JSON-RPC — fall through to the host+path key below */
      }
    }
    return `POST ${originPath(url)}`;
  }
  return `${method} ${url}`;
}

// A pubkey field is "none" if null, missing, the system program, or all-zeros.
const SYSTEM = "11111111111111111111111111111111";
export function isNone(pubkey: unknown): boolean {
  if (pubkey == null) return true;
  if (typeof pubkey !== "string") return true;
  const v = pubkey.trim();
  return v === "" || v === SYSTEM || /^1+$/.test(v) || /^0+$/.test(v);
}

// Three-way classification for an authority/sentinel field, so a SAFETY tool never
// reads MALFORMED data as "safely absent". A non-string-non-null value (schema drift,
// unexpected RPC shape) is "malformed" — it must withhold GO, not pass as renounced.
//   "absent"    = genuinely renounced/none (null, "", system program, all-1s/0s)
//   "live"      = a real, present authority value (a plausible address string)
//   "malformed" = present but the wrong type / undecodable → cannot confirm renounced
export function fieldState(v: unknown): "absent" | "live" | "malformed" {
  if (v == null) return "absent";
  if (typeof v !== "string") return "malformed";
  const s = v.trim();
  if (s === "" || s === SYSTEM || /^1+$/.test(s) || /^0+$/.test(s)) return "absent";
  // A valid Solana address is base58, 32–44 chars. A present-but-implausible string
  // is malformed rather than a trustworthy "live authority" identity.
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s) ? "live" : "malformed";
}
