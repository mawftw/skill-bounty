// Core LP-safety pipeline, factored out of the CLI so both the `safety-check`
// command and the eval harness run the exact same logic (no drift).
//
// Resolves a pool/mint, runs the multi-source on-chain checks, and returns a
// full Report. Best-effort: every source degrades gracefully to null.

import {
  resolveTarget,
  fetchRugcheck,
  fetchGoplus,
  fetchOnchainHolders,
  fetchHolderCount,
  rugcheckExcludedAccounts,
  getParsedAccount,
  parseMint,
  isMintAccount,
  QUOTES,
} from "./sources.js";
import { buildFindings, verdictFrom, isKnownGood } from "./score.js";
import type { Finding, Report, SourceStatus } from "./types.js";

const short = (a: string) => (a && a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

// Which of a quote token's findings fold into the pool verdict: its HARD fails
// (seize / freeze / rugged) AND every fail-closed SOFT flag that means "we couldn't
// verify this side is safe" — a malformed authority, an unrecognized extension,
// malformed state inside a known extension, OR incomplete evidence (a critical check
// that couldn't run). All of these must survive aggregation exactly like on the base
// side, or a dangerous/unverified quote token yields a false pool-level GO.
// Concentration / metadata / IL soft flags on a quote are noise and intentionally dropped.
const QUOTE_KEEP_SOFT = new Set([
  "unparseable_authority",
  "unrecognized_extension",
  "unparseable_extension_state",
  "duplicate_extension",
  "default_frozen_no_thaw",
  "incomplete_evidence",
  // a third-party-trusted (non-allowlist) quote's LIVE classic authority is a soft
  // residual on the base side; on the quote side it can still trap the LP, so fold it
  // in too (an untrusted quote's live authority is HARD and already kept via severity).
  "freeze_authority_live",
  "mint_authority_live",
]);
export function selectQuoteFindings(findings: Finding[], quoteMint: string): Finding[] {
  return findings
    .filter((f) => f.severity === "hard" || QUOTE_KEEP_SOFT.has(f.code))
    .map((f) => ({
      ...f,
      code: `quote_${f.code}`,
      message: `[quote token ${short(quoteMint)}] ${f.message}`,
    }));
}

// A pool exposes the LP to BOTH tokens — either one freezing, seizing, or rugging
// traps/drains the position. resolveTarget only scans the base (risky) side; this
// adds the QUOTE side's hard-fail surface (authorities, Token-2022 seize powers,
// rugged) so a live authority on token Y can't slip through as a GO on token X.
// A known-good quote asset (wSOL/USDC/USDT) is waived; for ANY OTHER quote, failing
// to assess it is uncertainty, not safety → emit a soft flag so the pool can't pass
// as GO on an unverified side (fail-closed, consistent with the base-side gate).
async function quoteSideFindings(quoteMint: string): Promise<Finding[]> {
  const knownQuote = QUOTES.has(quoteMint);
  const incomplete: Finding = {
    severity: "soft",
    code: "quote_incomplete_evidence",
    message: `[quote token ${short(quoteMint)}] could not be assessed — withholding GO; verify the quote side before LPing.`,
    source: "skill",
  };
  try {
    const acc = await getParsedAccount(quoteMint);
    if (!isMintAccount(acc)) return knownQuote ? [] : [incomplete];
    const mint = parseMint(quoteMint, acc);
    const [rug, go] = await Promise.all([fetchRugcheck(quoteMint), fetchGoplus(quoteMint)]);
    return selectQuoteFindings(
      buildFindings(mint, undefined, rug, go, isKnownGood(quoteMint, go)),
      quoteMint,
    );
  } catch {
    return knownQuote ? [] : [incomplete]; // unknown quote we couldn't verify → withhold GO
  }
}

export async function analyze(target: string): Promise<Report> {
  const sources: SourceStatus[] = [];
  const resolved = await resolveTarget(target, sources);
  const baseMint = resolved.baseMint;

  // Holder-concentration exclusions. We do NOT trust the Meteora REST `reserve_*/vault_*`
  // fields: a stale/compromised response could name a whale's token account as a "vault"
  // to hide it (a false GO). The pool's own reserves are instead excluded ON-CHAIN by
  // fetchOnchainHolders' program allowlist (a pool vault's authority is owned by the AMM
  // program). RugCheck LOCKER/AMM/BURN labels DO augment the exclusion — they catch
  // lockers held via indirection that the program-ownership heuristic alone misses (e.g.
  // Token-2022 escrow accounts); this corroborating trust is documented in EVAL.md.
  const excludeAccts = new Set<string>();

  // RugCheck resolves first so its locker/AMM/burn labels can augment the on-chain
  // allowlist; goplus + holderCount stay in flight concurrently.
  const goplusP = fetchGoplus(baseMint);
  const holderCountP = fetchHolderCount(baseMint);
  const rugcheck = await fetchRugcheck(baseMint);
  for (const acct of rugcheckExcludedAccounts(rugcheck)) excludeAccts.add(acct);
  const [goplus, holderStats, holderCount] = await Promise.all([
    goplusP,
    fetchOnchainHolders(baseMint, resolved.mint.decimals ?? 0, excludeAccts),
    holderCountP,
  ]);
  sources.push({ name: "RugCheck", ok: !!rugcheck, note: rugcheck ? undefined : "unavailable" });
  sources.push({ name: "GoPlus", ok: !!goplus, note: goplus ? undefined : "unavailable" });
  sources.push({
    name: "Helius DAS",
    ok: holderStats != null || holderCount != null,
    note: process.env.HELIUS_API_KEY ? undefined : "no key (using public RPC)",
  });

  const knownGood = isKnownGood(baseMint, goplus);
  const findings = buildFindings(
    resolved.mint,
    resolved.pool,
    rugcheck,
    goplus,
    knownGood,
    holderStats,
    holderCount,
  );

  // For a pool, the quote side can also trap/seize/rug the LP — fold in its hard
  // fails (and a soft flag if an untrusted quote couldn't be assessed) so a dangerous
  // or unverified token Y can't pass as a GO on token X.
  if (resolved.pool?.quoteMint && resolved.pool.quoteMint !== baseMint) {
    findings.push(...(await quoteSideFindings(resolved.pool.quoteMint)));
  }

  const verdict = verdictFrom(findings);

  return {
    target,
    resolvedAs: resolved.kind,
    scope: resolved.kind === "pool" ? "pool" : "token-only",
    baseMint,
    pool: resolved.pool,
    mint: resolved.mint,
    knownGood,
    findings,
    sources,
    verdict,
  };
}
