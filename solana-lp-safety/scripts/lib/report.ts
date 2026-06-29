// Renders a Report in the Output Format from skill/SKILL.md.

import type { Finding, Report } from "./types.js";

const has = (f: Finding[], code: string) => f.some((x) => x.code === code);

// ✓ unless any of `failCodes` is present (then ✗).
function mark(f: Finding[], ...failCodes: string[]): string {
  return failCodes.some((c) => has(f, c)) ? "✗" : "✓";
}

// ✗ if the fail code is present, ~ if only the known-good variant is, else ✓.
function triState(f: Finding[], failCode: string, knownGoodCode: string): string {
  if (has(f, failCode)) return "✗";
  if (has(f, knownGoodCode)) return "~";
  return "✓";
}

export function render(r: Report): string {
  const f = r.findings;
  const L: string[] = [];
  const pair = r.pool ? `${short(r.pool.baseMint)}/${short(r.pool.quoteMint)}` : short(r.baseMint);
  const amm = r.pool?.amm ?? "(mint-only, no pool given)";

  // Mint-only is a TOKEN-level result, not an LP verdict — the pool-specific checks
  // (lock, TVL, depth, both-sides) did not run, so a clean token-only pass must NOT read
  // as "safe to LP". Label it distinctly.
  if (r.pool) {
    L.push(`LP SAFETY: ${r.verdict}   (target: ${short(r.target)}  pair: ${pair}  amm: ${amm})`);
  } else {
    L.push(`TOKEN SAFETY: ${r.verdict}   ·   ⚠ TOKEN-LEVEL ONLY — NOT an LP/pool verdict   (target: ${short(r.target)})`);
    L.push("           the pool-specific LP checks (lock, TVL, depth, both-sides) did NOT run — pass a Meteora pool address for an LP verdict");
  }
  L.push("");
  // A fail-closed soft (e.g. a malformed authority/extension we couldn't decode) must not
  // leave its row showing a clean ✓ — surface it as ⚠ on the relevant row.
  const warnIf = (clean: string, ...failClosed: string[]) => (failClosed.some((c) => has(f, c)) ? "⚠" : clean);
  L.push("Token checks  (✓ ok · ✗ fail · ~ live-but-trusted · ⚠ concern · — not assessed)");
  L.push(`  [${warnIf(triState(f, "freeze_authority_live", "freeze_authority_known_good"), "unparseable_authority")}] Freeze authority renounced${has(f, "freeze_authority_known_good") ? " (live, trusted)" : ""}`);
  L.push(`  [${warnIf(triState(f, "mint_authority_live", "mint_authority_known_good"), "unparseable_authority")}] Mint authority renounced${has(f, "mint_authority_known_good") ? " (live, trusted)" : ""}`);
  L.push(`  [${warnIf(mark(f, "transfer_hook_active", "permanent_delegate", "pausable_live", "non_transferable", "default_frozen"), "unparseable_extension_state", "duplicate_extension")}] No active transfer hook / permanent delegate / pausable / non-transferable (or undecodable extension)`);
  L.push(`  [${mark(f, "transfer_fee_authority_live", "transfer_fee_exit_drain")}] No live / exit-draining transfer-fee authority`);
  L.push(`  [${mark(f, "rugged_or_blacklisted")}] Not flagged rugged / blacklisted`);
  L.push("LP / pool checks");
  L.push(`  ${lpLockLine(r, f)}`);
  L.push(`  [${!r.pool ? "—" : r.pool.tvl == null ? "⚠" : soft(f, "thin_tvl", "fee_apr_unrealistic")}] Pool TVL / depth / fee-APR realism${r.pool?.tvl != null ? ` ($${Math.round(r.pool.tvl).toLocaleString()})` : r.pool ? " (unavailable — not verified)" : ""}`);
  L.push("Soft checks");
  L.push(`  [${soft(f, "holder_concentration")}] Holder concentration`);
  L.push(`  [${soft(f, "transfer_fee_fixed")}] Transfer fee`);
  L.push(`  [${soft(f, "mutable_metadata")}] Metadata immutable / update authority renounced`);
  L.push(`  [${soft(f, "latent_transfer_hook", "mint_close_authority")}] No latent Token-2022 risk`);

  const reds = f.filter((x) => x.severity === "hard" || x.severity === "soft");
  L.push("");
  if (reds.length) {
    L.push("🚩 Red flags:");
    for (const x of sortBySeverity(reds)) L.push(`   - [${x.severity.toUpperCase()}] ${x.message}`);
  } else {
    L.push("🚩 Red flags: none");
  }

  const info = f.filter((x) => x.severity === "info");
  if (info.length) {
    L.push("ℹ️  Residual risks / notes:");
    for (const x of info) L.push(`   - ${x.message}`);
  }

  L.push("");
  L.push(`Sources: ${r.sources.map((s) => `${s.name}${s.ok ? "✓" : `✗${s.note ? `(${s.note})` : ""}`}`).join("  ")}`);
  L.push("Note: deep bin-distribution / exit-slippage analysis (DLMM SDK) not yet wired — pool-level TVL used. Not financial advice.");
  return L.join("\n");
}

function soft(f: Finding[], ...codes: string[]): string {
  return codes.some((c) => has(f, c)) ? "⚠" : "✓";
}

// Creator-LP-lock line. Honest tri-state: only DAMM v2 exposes a permanent-lock
// %; DLMM positions are individually owned (no pool-level lock to read yet);
// mint-only can't assess any pool.
function lpLockLine(r: Report, f: Finding[]): string {
  if (!r.pool) return "[—] Creator LP lock — not assessed (mint-only)";
  if (r.pool.amm === "meteora-damm-v2" && r.pool.permanentLockPct != null)
    return `[${has(f, "lp_low_lock") ? "⚠" : "✓"}] DAMM v2 LP permanently locked (${r.pool.permanentLockPct.toFixed(0)}%)`;
  return "[—] Creator LP lock — not assessed (DLMM positions individually owned; creator-position check is a planned enhancement)";
}

function sortBySeverity(f: Finding[]): Finding[] {
  const rank = (s: string) => (s === "hard" ? 0 : s === "soft" ? 1 : 2);
  return [...f].sort((a, b) => rank(a.severity) - rank(b.severity));
}

function short(addr: string): string {
  return addr && addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}
