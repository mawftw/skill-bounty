/**
 * Signature demo — the LP-specific findings a token-only scanner can't produce.
 *
 *   npm run demo
 *
 * Runs analyze() — the EXACT CLI pipeline — against sanitized record/replay captures
 * with global fetch disabled, so it's fully OFFLINE and DETERMINISTIC (no network, no
 * key, same output every time). Each case prints the real verdict report plus a
 * "generic scanner vs LP-safety" contrast that shows where the LP framing changes the
 * answer. The demo self-checks: if a fixture's verdict ever drifts from the documented
 * one, it exits non-zero.
 *
 * The four cases are the skill's decision-semantics moat: the same on-chain facts,
 * read for a liquidity provider's exit risk rather than a buyer's entry risk.
 */
import { readFileSync } from "node:fs";
import { analyze } from "./lib/analyze.js";
import { render } from "./lib/report.js";
import { authorityOnlyBaseline } from "./lib/baseline.js";
import { setResponder } from "./lib/http.js";
import { makeReplayer, type Fixture } from "../tests/fixtures/transport.js";

// Forbid real network for the whole demo — a pass proves it ran purely on the captures.
globalThis.fetch = (() => {
  throw new Error("demo is offline-only: real network access is forbidden");
}) as unknown as typeof fetch;

interface DemoCase {
  file: string;
  title: string;
  contrast: string[]; // the "generic vs LP-safety" read, most important last
}

const CASES: DemoCase[] = [
  {
    file: "pool-dlmm-go",
    title: "Real Meteora DLMM pool — pool-level resolution a token scanner can't do",
    contrast: [
      "Generic token scanner: needs a single MINT — it can't resolve a pool address at all.",
      "LP-safety: resolved the pool (bound to the requested address) → split base/quote → waived the",
      "  trusted USDC quote → reported DLMM creator-lock as \"not assessed\" → excluded AMM/locker supply",
      "  from concentration → AND computed the realized fee yield (24h fees ÷ TVL, ~60% APR — not an",
      "  advertised number) + reserve balance from data a token scanner never even fetches.",
    ],
  },
  {
    file: "pyusd-nogo",
    title: "PYUSD — trusted issuer, still a hard NO-GO (seize power over trust)",
    contrast: [
      "A \"trusted-issuer ⇒ safe\" check: GO (false) — PYUSD is a regulated PayPal/Paxos stablecoin.",
      "An authority-only check: NO-GO, but for the WRONG reason (its by-design freeze authority).",
      "LP-safety: PYUSD is third-party-trusted (GoPlus), so its by-design freeze/mint authorities are",
      "  capped at residual CAUTION — not cleared (only the canonical blue-chip allowlist clears a live",
      "  authority). And it HARD-blocks on the Token-2022 permanent delegate that can seize pooled",
      "  tokens. Trust never relaxes a seize power → NO-GO. This is the signature call.",
    ],
  },
  {
    file: "locked-excluded-go",
    title: "Locked supply — pool/lock-aware concentration (no false whale flag)",
    contrast: [
      "Naive top-holder check: sees ~49% sitting in a few accounts → \"whale\" → false CAUTION/NO-GO.",
      "LP-safety: labels those accounts (Streamflow locker / AMM liquidity) and excludes locked +",
      "  pool supply from free-float concentration → GO, with the composition shown, not an opaque %.",
    ],
  },
  {
    file: "conc-caution",
    title: "Real free-floating whale — the concentration the baseline is blind to",
    contrast: [
      "Authority-only baseline: authorities renounced → GO, blind to who holds the supply.",
      "LP-safety: one real unlabeled wallet holds ~32% of free float and can dump on the pool →",
      "  CAUTION, and it names the holder so you can identify it before LPing.",
    ],
  },
];

const dir = new URL("../tests/fixtures/", import.meta.url);
const indent = (s: string, pad = "    ") => s.split("\n").map((l) => pad + l).join("\n");

async function main() {
  console.log("\n" + "═".repeat(80));
  console.log("  LP-SAFETY SIGNATURE DEMO  —  offline & deterministic (replayed captures)");
  console.log("═".repeat(80));
  console.log("  analyze() — the exact CLI pipeline — over sanitized record/replay fixtures,");
  console.log("  with global fetch disabled. No network, no key. Reproduce: npm run demo\n");

  let n = 0;
  let drift = 0;
  for (const c of CASES) {
    n++;
    const fx: Fixture = JSON.parse(readFileSync(new URL(`${c.file}.json`, dir), "utf8"));
    const { responder, misses } = makeReplayer(fx.calls);
    setResponder(responder);
    let report;
    try {
      report = await analyze(fx.target);
    } finally {
      setResponder(null);
    }

    console.log("─".repeat(80));
    console.log(`  ${n}. ${c.title}`);
    console.log(`     target: ${fx.target}`);
    console.log("─".repeat(80));
    console.log(indent(render(report)));

    const base = authorityOnlyBaseline(report.mint);
    console.log("");
    console.log(`    ┌─ generic / authority-only view vs LP-safety ─────────────────────────`);
    console.log(`    │ authority-only baseline verdict: ${base}`);
    console.log(`    │ LP-safety verdict:               ${report.verdict}`);
    for (const line of c.contrast) console.log(`    │ ${line}`);
    console.log(`    └──────────────────────────────────────────────────────────────────────`);
    console.log("");

    // Self-check: the demo must reflect the documented verdict, and must have run
    // purely on the capture (no unrecorded call slipped through to a fake outage).
    if (misses.length) { console.error(`  ! ${c.file}: ${misses.length} fixture miss(es) — not fully offline`); drift++; }
    if (fx.expect.verdict && report.verdict !== fx.expect.verdict) {
      console.error(`  ! ${c.file}: verdict drifted — got ${report.verdict}, fixture documents ${fx.expect.verdict}`);
      drift++;
    }
  }

  console.log("═".repeat(80));
  if (drift) {
    console.error(`\nDEMO FAILED: ${drift} case(s) drifted from their documented verdict.\n`);
    process.exit(1);
  }
  console.log(`  ${n} cases, all matching their documented verdicts — offline, no network, no key.`);
  console.log("═".repeat(80) + "\n");
}

main().catch((e) => {
  console.error(`demo error: ${e?.message ?? e}`);
  process.exit(2);
});
