// Data-source clients: Solana RPC, RugCheck, GoPlus, Meteora data API.
// All keyless except where a key env is set. Each returns null on failure so the
// caller can degrade gracefully.

import { getJson } from "./http.js";
import type { MintInfo, PoolInfo, SourceStatus } from "./types.js";

export const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

// On-chain program owners of a real Meteora pool account — used to BIND a resolved
// pool to the requested address: the account at `addr` must itself be owned by one of
// these on-chain, so a stale/compromised REST response can't pass off unrelated
// (safe-looking) mints for a non-pool or a different address.
export const METEORA_PROGRAMS = new Set([
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", // DLMM
  "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG", // DAMM v2 (cp-amm)
]);

// 8-byte Anchor discriminator of a DLMM LbPair account — so a DIFFERENT Meteora-owned
// account type (Position, BinArray, …) at the requested address can't pass as a pool.
export const DLMM_LBPAIR_DISCRIMINATOR = [33, 11, 49, 98, 181, 101, 177, 13];
// Byte offsets of tokenXMint / tokenYMint inside the LbPair account (each a 32-byte
// pubkey) — used to decode the REAL on-chain pair and bind it to the API-reported mints,
// so a compromised REST response can't keep a genuine LbPair address but substitute
// safe-looking mints. (Verified against the recorded SOL-USDC LbPair fixture.)
const DLMM_TOKEN_X_OFFSET = 88;
const DLMM_TOKEN_Y_OFFSET = 120;

// 8-byte Anchor discriminator of a Meteora DAMM v2 (cp-amm) Pool account = sha256("account:Pool")[:8].
// Verified against the cp-amm IDL AND three live mainnet Pool accounts (SOL-USDC, FREE-USD1, FINNBAGS-SOL).
export const DAMM_V2_POOL_DISCRIMINATOR = [241, 154, 109, 4, 17, 177, 109, 188];
// Byte offsets of tokenAMint / tokenBMint inside the cp-amm Pool account (each a 32-byte pubkey):
// 8 (disc) + 160 (PoolFeesStruct) = 168; 168 + 32 = 200. Verified against the same live accounts.
const DAMM_V2_TOKEN_A_OFFSET = 168;
const DAMM_V2_TOKEN_B_OFFSET = 200;

function accountBytes(acc: any): Buffer | null {
  const d = acc?.data;
  const b64 = Array.isArray(d) ? d[0] : typeof d === "string" ? d : null;
  if (typeof b64 !== "string") return null;
  try {
    return Buffer.from(b64, "base64");
  } catch {
    return null;
  }
}

function hasDiscriminator(acc: any, disc: number[]): boolean {
  const bytes = accountBytes(acc);
  return bytes != null && bytes.length >= disc.length && disc.every((x, i) => bytes[i] === x);
}

// Minimal base58 decoder (no deps) — to compare an API-reported mint string against the
// raw 32-byte pubkey decoded from the on-chain account.
const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Decode(s: string): Buffer | null {
  if (typeof s !== "string" || s.length === 0) return null;
  const bytes: number[] = [0];
  for (const ch of s) {
    const val = B58_ALPHABET.indexOf(ch);
    if (val < 0) return null;
    let carry = val;
    for (let j = 0; j < bytes.length; j++) { carry += bytes[j] * 58; bytes[j] = carry & 0xff; carry >>= 8; }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (const ch of s) { if (ch !== "1") break; bytes.push(0); }
  return Buffer.from(bytes.reverse());
}

// The on-chain pool pair must EXACTLY equal the API-reported pair as a set: two DISTINCT
// 32-byte mints that together cover both on-chain sides. `xOff`/`yOff` are the byte offsets
// of the two mint pubkeys inside the pool account — they differ per AMM (DLMM 88/120,
// DAMM v2 168/200), so the binding logic is shared and only the offsets vary. Requiring
// distinctness closes the duplicate-mint bypass — a compromised API can't repeat one safe
// mint (`[USDC, USDC]`) so that only the safe side is analyzed and the other on-chain token
// (potentially malicious) is never checked.
function pairMatchesOnchain(acc: any, apiMints: string[], xOff: number, yOff: number): boolean {
  const bytes = accountBytes(acc);
  if (!bytes || bytes.length < Math.max(xOff, yOff) + 32) return false;
  const onX = bytes.subarray(xOff, xOff + 32);
  const onY = bytes.subarray(yOff, yOff + 32);
  if (apiMints.length !== 2) return false;
  const a0 = base58Decode(apiMints[0]);
  const a1 = base58Decode(apiMints[1]);
  if (!a0 || !a1 || a0.length !== 32 || a1.length !== 32) return false;
  if (a0.equals(a1)) return false; // two distinct mints required (no duplicate bypass)
  const covers = (slice: Buffer) => a0.equals(slice) || a1.equals(slice);
  return covers(onX) && covers(onY); // both on-chain sides must be claimed by the API pair
}

// Known quote assets (so we can pick the "base" / risky side of a pool).
export const QUOTES = new Set([
  "So11111111111111111111111111111111111111112", // wSOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);

function rpcUrl(): string {
  if (process.env.SOLANA_RPC_URL) return process.env.SOLANA_RPC_URL;
  if (process.env.HELIUS_API_KEY)
    return `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
  return "https://api.mainnet-beta.solana.com";
}

async function rpc(method: string, params: any): Promise<any> {
  const r = await getJson(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (r.error) throw new Error(`RPC ${method}: ${r.error.message ?? "error"}`);
  return r.result;
}

export async function getParsedAccount(addr: string): Promise<any> {
  const res = await rpc("getAccountInfo", [addr, { encoding: "jsonParsed" }]);
  return res?.value ?? null;
}

export function parseMint(mint: string, acc: any): MintInfo {
  const owner = acc?.owner;
  const program =
    owner === TOKEN_2022 ? "spl-token-2022" : owner === TOKEN ? "spl-token" : "unknown";
  const info = acc?.data?.parsed?.info ?? {};
  // Distinguish a field that is PRESENT-and-null (genuinely renounced) from one that is
  // ABSENT (schema drift at the RPC parse boundary). A real mint always carries both
  // authority fields (null or a pubkey); a MISSING field must NOT be read as "renounced"
  // → emit a sentinel that fieldState() classifies as malformed, so buildFindings
  // withholds GO. Fail-closed at the parse boundary, not only at the verdict layer.
  const MISSING = "__missing_authority_field__"; // not base58 → fieldState() → "malformed"
  const authField = (key: string) =>
    Object.prototype.hasOwnProperty.call(info, key) ? info[key] : MISSING;
  return {
    mint,
    program,
    mintAuthority: authField("mintAuthority"),
    freezeAuthority: authField("freezeAuthority"),
    decimals: info.decimals ?? null,
    supply: info.supply ?? null,
    extensions: parseExtensions(info, program),
  };
}

// Fail-closed extensions parse. An array is used as-is. A present-but-non-array value
// is malformed. An ABSENT/null extensions field is fine for classic spl-token (it has
// none), but a **Token-2022** mint always carries an extensions array — a missing one
// is schema drift → surface it as a malformed extension so buildFindings withholds GO,
// rather than reading "no extensions field" as "no Token-2022 risks."
function parseExtensions(info: any, program: MintInfo["program"]): any[] {
  if (Array.isArray(info?.extensions)) return info.extensions;
  if (info?.extensions == null)
    return program === "spl-token-2022" ? [{ extension: "__malformed_extensions__" }] : [];
  return [{ extension: "__malformed_extensions__" }];
}

export function isMintAccount(acc: any): boolean {
  return (
    acc &&
    (acc.owner === TOKEN || acc.owner === TOKEN_2022) &&
    acc.data?.parsed?.type === "mint"
  );
}

// ---- Meteora data API -------------------------------------------------------

function extractPool(resp: any): any | null {
  if (!resp) return null;
  if (resp.token_x || resp.address) return resp;
  if (resp.data) return Array.isArray(resp.data) ? resp.data[0] ?? null : resp.data;
  if (resp.pool) return resp.pool;
  return null;
}

function toPoolInfo(p: any, amm: string): PoolInfo {
  const xMint = p.token_x?.address ?? p.token_x_mint ?? p.token_x;
  const yMint = p.token_y?.address ?? p.token_y_mint ?? p.token_y;
  // base = the non-quote side; default to token_x if ambiguous.
  let baseMint = xMint;
  let quoteMint = yMint;
  if (QUOTES.has(xMint) && !QUOTES.has(yMint)) {
    baseMint = yMint;
    quoteMint = xMint;
  }
  const baseTok = baseMint === xMint ? p.token_x : p.token_y;
  const lock = Number(p.permanent_lock_liquidity ?? 0);
  // Keep TVL UNDEFINED when the API omits it (don't coerce a missing field to 0 — that
  // would read "unknown depth" as "thin", and never trip the economics-unavailable gate).
  const tvl = p.tvl != null && Number.isFinite(Number(p.tvl)) ? Number(p.tvl) : undefined;
  const fees24h = p.fees?.["24h"] != null && Number.isFinite(Number(p.fees["24h"])) ? Number(p.fees["24h"]) : undefined;
  // Reserve VALUE split (not token counts): valueX = xAmount × price(x in y), valueY = yAmount.
  // Lets us report how one-sided the pool is — an LP entering a lopsided pool gets mostly the
  // minority asset and faces worse exit slippage.
  const xAmt = Number(p.token_x_amount), yAmt = Number(p.token_y_amount), price = Number(p.current_price);
  let baseValuePct: number | undefined;
  if (Number.isFinite(xAmt) && Number.isFinite(yAmt) && Number.isFinite(price) && price > 0) {
    const valX = xAmt * price, valY = yAmt, total = valX + valY;
    if (total > 0) baseValuePct = ((baseMint === xMint ? valX : valY) / total) * 100;
  }
  return {
    address: p.address ?? "",
    amm,
    baseMint,
    quoteMint,
    tvl,
    volume24h: p.volume?.["24h"] != null ? Number(p.volume["24h"]) : undefined,
    fees24h,
    baseValuePct,
    baseFreezeDisabled: baseTok?.freeze_authority_disabled,
    permanentLockPct:
      amm === "meteora-damm-v2" && tvl != null && tvl > 0 ? Math.min(100, (lock / tvl) * 100) : undefined,
    isBlacklisted: p.is_blacklisted === true,
    raw: p,
  };
}

export async function fetchMeteoraPool(addr: string): Promise<PoolInfo | null> {
  const tries: [string, string][] = [
    [`https://dlmm.datapi.meteora.ag/pools/${addr}`, "meteora-dlmm"],
    [`https://damm-v2.datapi.meteora.ag/pools/${addr}`, "meteora-damm-v2"],
  ];
  for (const [url, amm] of tries) {
    try {
      const p = extractPool(await getJson(url));
      if (p && (p.token_x || p.token_x_mint)) return toPoolInfo(p, amm);
    } catch {
      /* try next */
    }
  }
  return null;
}

// ---- RugCheck ---------------------------------------------------------------

export async function fetchRugcheck(mint: string): Promise<any | null> {
  const url = `https://api.rugcheck.xyz/v1/tokens/${mint}/report`;
  // RugCheck's keyless endpoint is flaky under rapid calls; one light retry with a
  // short backoff keeps a transient failure from spuriously tripping the
  // evidence-completeness gate (untrusted + no RugCheck -> CAUTION).
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await getJson(url);
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
    }
  }
  return null;
}

// ---- GoPlus -----------------------------------------------------------------

export async function fetchGoplus(mint: string): Promise<any | null> {
  try {
    const r = await getJson(
      `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${mint}`,
    );
    return r?.result?.[mint] ?? null;
  } catch {
    return null;
  }
}

// ---- Helius / on-chain holder analysis -------------------------------------

export const INCINERATOR = "1nc1nerator11111111111111111111111111111111";
export const SYSTEM_PROGRAM = "11111111111111111111111111111111";

// Programs that legitimately CUSTODY non-free-floating supply (AMM pool vaults, LP/vesting
// lockers). An authority OWNED BY one of these is excluded from holder concentration.
// Anything else program-owned is UNKNOWN custody — it could be a creator-controlled,
// WITHDRAWABLE escrow/PDA — so it is COUNTED as concentration, never silently dropped.
// (The old "exclude ANY program-owned" rule hid such whales → a false GO.) Burns are handled
// separately: INCINERATOR is a System-owned address, matched by address, not by program.
export const HOLDER_EXCLUDE_PROGRAMS = new Set<string>([
  // Meteora
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", // DLMM
  "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG", // DAMM v2 (cp-amm)
  "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB", // DAMM v1 (dynamic AMM)
  "24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi", // Dynamic Vault (DAMM v1 yield vaults)
  // Raydium
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", // AMM v4
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK", // CLMM
  "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C", // CPMM
  // Orca
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc", // Whirlpools (CLMM)
  // pump.fun
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", // PumpSwap AMM
  // Lockers / vesting
  "strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m", // Streamflow
  "LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn", // Jupiter Lock
]);

export interface HolderStats {
  top1: number;
  top10: number;
  top1Owner?: string; // wallet behind the largest counted holder (for label lookup)
  excludedPct: number; // % of supply in known AMM vaults / lockers / burns (excluded — not free-floating)
  unknownProgramPct?: number; // % owned by an UNRECOGNIZED program — counted as concentration, NOT assumed locked
  labelExcludedMaxPct?: number; // largest SINGLE account excluded SOLELY via an unverified RugCheck label
  source: string;
}

// Authoritative top-holder concentration via getTokenLargestAccounts (top 20
// token accounts) + owner resolution, aggregated by owner. Excludes the burn
// address and any provided pool vault accounts. Works on any RPC; reliable on
// Helius. Percentages are of total supply.
export async function fetchOnchainHolders(
  mint: string,
  decimals: number,
  excludeAccts: Set<string>,
): Promise<HolderStats | null> {
  let largest: any;
  try {
    largest = await rpc("getTokenLargestAccounts", [mint]);
  } catch {
    return null;
  }
  // Largest SINGLE account pre-excluded via a THIRD-PARTY RugCheck LOCKER/AMM/BURN label
  // (excludeAccts). Tracked so the verdict layer can CAP AT CAUTION when a materially
  // concentrated single position was dropped on an unverified label alone: a forged/incorrect
  // label on one ≥threshold account would otherwise hide a top-holder whale and buy a GO.
  let labelExcludedMaxUi = 0;
  const accts = (largest?.value ?? []).filter((a: any) => {
    if (excludeAccts.has(a.address)) {
      const ui = a.uiAmount ?? Number(a.amount) / 10 ** (decimals || 0);
      if (Number.isFinite(ui) && ui > labelExcludedMaxUi) labelExcludedMaxUi = ui;
      return false;
    }
    return true;
  });
  if (!accts.length) return null;

  // 1. Resolve each token account's authority (the wallet/PDA that controls it).
  let tokInfo: any = { value: [] };
  try {
    tokInfo = await rpc("getMultipleAccounts", [
      accts.map((a: any) => a.address),
      { encoding: "jsonParsed" },
    ]);
  } catch {
    return null; // can't identify authorities -> can't exclude vaults -> defer to GoPlus
  }
  const authorities: (string | null)[] = accts.map(
    (_: any, i: number) => tokInfo?.value?.[i]?.data?.parsed?.info?.owner ?? null,
  );

  // 2. Look up who OWNS each authority. A real wallet is owned by the System
  //    Program; an AMM pool vault / Streamflow lock / other contract authority is
  //    owned by a program (PDA) -> exclude it (liquidity or locked supply, not a
  //    free-floating whale that can dump).
  const uniqAuth = [...new Set(authorities.filter((a): a is string => !!a))];
  const authProgram = new Map<string, string | null>();
  try {
    const res = await rpc("getMultipleAccounts", [uniqAuth, { encoding: "jsonParsed" }]);
    uniqAuth.forEach((k, i) => authProgram.set(k, res?.value?.[i]?.owner ?? null));
  } catch {
    /* if this lookup fails we simply won't exclude program-owned accounts */
  }

  let supplyUi: number | null = null;
  try {
    supplyUi = (await rpc("getTokenSupply", [mint]))?.value?.uiAmount ?? null;
  } catch {
    return null;
  }
  if (!supplyUi) return null;

  // 3. Aggregate real wallets; tally excluded (burn / known-AMM-vault / locker) supply.
  //    A program-owned authority is only treated as "locked" when its owning program is on
  //    the AMM/locker allowlist; an UNRECOGNIZED program owner is COUNTED as concentration
  //    (it may be a creator-controlled, withdrawable escrow) — fail-closed, never silently dropped.
  const byOwner = new Map<string, number>();
  let excludedUi = 0;
  let unknownProgramUi = 0;
  accts.forEach((a: any, i: number) => {
    const auth = authorities[i] ?? a.address;
    const ui = a.uiAmount ?? Number(a.amount) / 10 ** (decimals || 0);
    if (!Number.isFinite(ui)) return;
    if (auth === INCINERATOR) {
      excludedUi += ui; // burned
      return;
    }
    const ownerProg = authProgram.get(auth);
    if (ownerProg && ownerProg !== SYSTEM_PROGRAM) {
      if (HOLDER_EXCLUDE_PROGRAMS.has(ownerProg)) {
        excludedUi += ui; // known AMM vault / locker — genuinely non-free-floating
        return;
      }
      // Program-owned but NOT allowlisted = unknown custody (possibly withdrawable) →
      // COUNT it as concentration, and remember the total for a residual note.
      unknownProgramUi += ui;
    }
    byOwner.set(auth, (byOwner.get(auth) ?? 0) + ui);
  });
  const sorted = [...byOwner.entries()].sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return null;
  const amounts = sorted.map(([, n]) => n);

  return {
    top1: (amounts[0] / supplyUi) * 100,
    top10: (amounts.slice(0, 10).reduce((s, n) => s + n, 0) / supplyUi) * 100,
    top1Owner: sorted[0][0],
    excludedPct: (excludedUi / supplyUi) * 100,
    unknownProgramPct: (unknownProgramUi / supplyUi) * 100,
    labelExcludedMaxPct: (labelExcludedMaxUi / supplyUi) * 100,
    source: "on-chain largest-accounts (burn + known AMM/locker vaults excluded; unrecognized escrows counted)",
  };
}

// Unique-holder count via Helius DAS getTokenAccounts (one page of up to 1000).
// `capped` = true when the page was full (so the real count is higher).
// Null when DAS is unavailable (e.g. the RPC is not Helius).
export async function fetchHolderCount(
  mint: string,
): Promise<{ holders: number; capped: boolean } | null> {
  try {
    // Helius DAS getTokenAccounts expects an OBJECT param (not array-wrapped).
    const r = await rpc("getTokenAccounts", {
      mint,
      limit: 1000,
      page: 1,
      options: { showZeroBalance: false },
    });
    const accs = r?.token_accounts;
    if (!Array.isArray(accs)) return null;
    const uniqueOwners = new Set(accs.map((a: any) => a.owner).filter(Boolean));
    return { holders: uniqueOwners.size, capped: accs.length >= 1000 };
  } catch {
    return null;
  }
}

// Token-account addresses RugCheck labels as locker / AMM / burn — supply that is
// NOT a free-floating whale. We add these to the concentration exclusion set
// because the pure program-ownership heuristic can miss vaults that resolve as
// System-owned. CREATOR is intentionally NOT excluded (a creator wallet can still
// dump); CEX is left counted (and labeled elsewhere) rather than silently dropped.
export function rugcheckExcludedAccounts(rugcheck: any): Set<string> {
  const out = new Set<string>();
  const known = rugcheck?.knownAccounts;
  const tops = rugcheck?.topHolders;
  if (!known || typeof known !== "object" || !Array.isArray(tops)) return out;
  const EXCLUDE = new Set(["LOCKER", "AMM", "BURN"]);
  for (const h of tops) {
    const info = known[h?.address] ?? known[h?.owner];
    const type = String(info?.type ?? "").toUpperCase();
    if (EXCLUDE.has(type) && typeof h?.address === "string") out.add(h.address);
  }
  return out;
}

// ---- Target resolution ------------------------------------------------------

export interface Resolved {
  kind: "mint" | "pool";
  mint: MintInfo;
  baseMint: string;
  pool?: PoolInfo;
}

export async function resolveTarget(
  addr: string,
  sources: SourceStatus[],
): Promise<Resolved> {
  // 1. Is the target itself a mint?
  let acc: any = null;
  try {
    acc = await getParsedAccount(addr);
    sources.push({ name: "Solana RPC", ok: true });
  } catch (e: any) {
    sources.push({ name: "Solana RPC", ok: false, note: e.message });
    throw new Error(`RPC unavailable, cannot resolve target: ${e.message}`);
  }

  if (isMintAccount(acc)) {
    return { kind: "mint", mint: parseMint(addr, acc), baseMint: addr };
  }

  // 2. Otherwise try it as a Meteora pool.
  const pool = await fetchMeteoraPool(addr);
  if (pool && pool.baseMint) {
    // Bind the resolved pool to the REQUESTED address — ON-CHAIN, not just on the API's
    // self-report. `acc` is the on-chain account at `addr` (fetched above); it must be
    // owned by a Meteora pool program, AND the API's reported address (when present) must
    // match. A compromised/stale REST response therefore can't pass off unrelated
    // (safe-looking) mints for a non-pool account or a different address.
    if (!acc || !METEORA_PROGRAMS.has(acc.owner))
      throw new Error(`pool identity unverified: ${addr} is not a Meteora pool program account on-chain`);
    // Stronger bind PER AMM: the account's discriminator must be the pool type (so a
    // different program-owned account can't pass as a pool), AND the on-chain token pair
    // must equal the API-reported pair (so a compromised REST response can't keep a real
    // pool address but substitute safe-looking mints → a pair-substitution false GO).
    // The trailing `else` fails CLOSED: an unrecognized AMM string can never bind on
    // program-ownership + API self-report alone. resolveTarget throws are uncaught in
    // analyze(), so a thrown identity error yields NO verdict — structurally never a GO.
    if (pool.amm === "meteora-dlmm") {
      if (!hasDiscriminator(acc, DLMM_LBPAIR_DISCRIMINATOR))
        throw new Error(`pool identity unverified: ${addr} is owned by the DLMM program but is not an LbPair (pool) account`);
      if (!pairMatchesOnchain(acc, [pool.baseMint, pool.quoteMint], DLMM_TOKEN_X_OFFSET, DLMM_TOKEN_Y_OFFSET))
        throw new Error(`pool pair mismatch: the API-reported mints do not match the on-chain LbPair token pair for ${addr}`);
    } else if (pool.amm === "meteora-damm-v2") {
      if (!hasDiscriminator(acc, DAMM_V2_POOL_DISCRIMINATOR))
        throw new Error(`pool identity unverified: ${addr} is owned by the DAMM v2 program but is not a Pool account`);
      if (!pairMatchesOnchain(acc, [pool.baseMint, pool.quoteMint], DAMM_V2_TOKEN_A_OFFSET, DAMM_V2_TOKEN_B_OFFSET))
        throw new Error(`pool pair mismatch: the API-reported mints do not match the on-chain DAMM v2 Pool token pair for ${addr}`);
    } else {
      throw new Error(`pool identity unverified: unrecognized AMM type '${pool.amm}' for ${addr} — cannot bind on-chain`);
    }
    if (pool.address && pool.address !== addr)
      throw new Error(`pool identity mismatch: requested ${addr} but Meteora returned ${pool.address}`);
    sources.push({ name: "Meteora API", ok: true, note: pool.amm });
    const baseAcc = await getParsedAccount(pool.baseMint);
    if (!isMintAccount(baseAcc)) throw new Error("pool base mint is not a valid mint account");
    return { kind: "pool", mint: parseMint(pool.baseMint, baseAcc), baseMint: pool.baseMint, pool };
  }

  throw new Error("target is neither a recognizable SPL mint nor a known Meteora pool");
}
