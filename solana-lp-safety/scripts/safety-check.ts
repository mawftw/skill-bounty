/**
 * solana-lp-safety-skill — safety-check CLI
 *
 * Pre-LP due-diligence: resolves a pool or mint, runs multi-source on-chain checks
 * from a liquidity-provider's perspective, and prints a GO / CAUTION / NO-GO verdict.
 *
 * Usage:
 *   npm run safety-check -- <POOL_OR_MINT_ADDRESS> [--json]
 *
 * Works keyless (public RPC + RugCheck + GoPlus + Meteora API). Optional env:
 *   SOLANA_RPC_URL     custom RPC (e.g. your Helius RPC) — recommended
 *   HELIUS_API_KEY     enables Helius RPC if SOLANA_RPC_URL unset
 *   SOLANA_TRACKER_API_KEY  reserved (optional enrichment)
 */

import { analyze } from "./lib/analyze.js";
import { render } from "./lib/report.js";
import type { Report } from "./lib/types.js";

// Load a local .env (gitignored) if present, so HELIUS_API_KEY / SOLANA_RPC_URL
// are picked up automatically. No-op when there's no .env (relies on real env).
try {
  process.loadEnvFile();
} catch {
  /* no .env file — that's fine, the tool runs keyless */
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const target = args.find((a) => !a.startsWith("--"));

  if (!target) {
    console.error("usage: npm run safety-check -- <POOL_OR_MINT_ADDRESS> [--json]");
    process.exit(1);
  }
  if (!BASE58.test(target)) {
    console.error(`error: "${target}" is not a valid base58 Solana address.`);
    process.exit(1);
  }

  let report: Report;
  try {
    report = await analyze(target);
  } catch (e: any) {
    console.error(`error: ${e.message}`);
    process.exit(2);
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(render(report));
  }

  // Exit code encodes the verdict for scripting: 0 GO, 10 CAUTION, 20 NO-GO.
  process.exit(report.verdict === "GO" ? 0 : report.verdict === "CAUTION" ? 10 : 20);
}

main().catch((e) => {
  console.error(`unexpected error: ${e?.message ?? e}`);
  process.exit(3);
});
