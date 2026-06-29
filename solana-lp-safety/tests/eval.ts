/**
 * Eval harness — scores the skill's verdict against a FAIR authority-only
 * baseline over a labeled fixture set of real mainnet mints.
 *
 *   npx tsx tests/eval.ts
 *
 * Ground-truth labels are independent of the tool under test: blue-chip status
 * (USDC / USDT / wSOL), a publicly-documented Token-2022 seize power (PYUSD's
 * permanent delegate), user-confirmed legitimate utility tokens, and on-chain
 * holder-concentration facts (a single >10% non-pool wallet). Verdicts are
 * produced live, so exact percentages can drift with chain state — the labels
 * do not. For deterministic CI, snapshot fixtures are a planned follow-up.
 */
import { analyze } from "../scripts/lib/analyze.js";
import { authorityOnlyBaseline } from "../scripts/lib/baseline.js";
import type { Verdict } from "../scripts/lib/types.js";

try {
  process.loadEnvFile();
} catch {
  /* keyless is fine */
}

interface Fixture {
  mint: string;
  name: string;
  expected: Verdict;
  why: string;
}

const FIXTURES: Fixture[] = [
  { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", name: "USDC", expected: "GO", why: "Circle blue-chip stablecoin — its live freeze authority is by-design, not a rug" },
  { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", name: "USDT", expected: "GO", why: "Tether blue-chip stablecoin" },
  { mint: "So11111111111111111111111111111111111111112", name: "wSOL", expected: "GO", why: "canonical wrapped SOL" },
  { mint: "EmcxFTNVDqyLHp11NvwvLZ4D7LKGbG9i7B8RF7dwpump", name: "legit-A", expected: "GO", why: "legit utility token: authorities renounced, no >10% non-pool wallet, no seize power" },
  { mint: "AWGCDT2gd8JadbYbYyZy1iKxfWokPNgrEQoU24zUpump", name: "legit-B", expected: "GO", why: "legit utility token: ~49% Streamflow-locked, no free-floating whale" },
  { mint: "Eg2ymQ2aQqjMcibnmTt8erC6Tvk9PVpJZCxvVPJz2agu", name: "legit-C", expected: "GO", why: "legit utility token: distributed holders" },
  { mint: "FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump", name: "legit-D", expected: "GO", why: "legit utility token: distributed holders" },
  { mint: "69LjZUUzxj3Cb3Fxeo1X4QpYEQTboApkhXTysPpbpump", name: "conc-A", expected: "CAUTION", why: "one real (unlabeled) wallet ~10% of supply — a concentration heads-up for an LP" },
  { mint: "739dnZEG4yaBWFsY8L8ZwrfhGG6dhtCSercW8Umspump", name: "conc-B", expected: "CAUTION", why: "one real (unlabeled) wallet ~15% (the rest is Streamflow-locked)" },
  { mint: "5Aru7v34QY1F69aWuY3mXKf5oxpg2CZNYcmo9hvPpump", name: "conc-C", expected: "CAUTION", why: "one real (unlabeled) wallet ~32% — meaningful dump risk to an LP" },
  { mint: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo", name: "PYUSD", expected: "NO-GO", why: "Token-2022 permanent delegate — the issuer can seize pooled tokens" },
];

// The fair authority-only baseline is shared from scripts/lib/baseline.ts so the
// live eval, the hard-fail eval, and the demo all ablate against the exact same rule.

const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n);
const severityRank = (v: Verdict | "ERR") =>
  v === "GO" ? 0 : v === "CAUTION" ? 1 : v === "NO-GO" ? 2 : -1;

// A live token can drift from GO to CAUTION as holders/labels move. For an LP
// safety tool, the critical live invariant is "do not under-warn": never return
// a less severe verdict than the independent label requires. Over-warning is
// tracked separately via exact-match count.
const noUnderWarning = (actual: Verdict | "ERR", expected: Verdict) =>
  severityRank(actual) >= severityRank(expected);

async function main() {
  console.log("\nsolana-lp-safety-skill — eval: with-skill vs authority-only baseline");
  console.log("=".repeat(78));
  console.log(pad("token", 10) + pad("expected", 10) + pad("baseline", 16) + pad("with-skill", 16));
  console.log("-".repeat(78));

  let baseOk = 0;
  let skillOk = 0;
  let baseNoUnderWarn = 0;
  let skillNoUnderWarn = 0;
  const wins: Fixture[] = [];
  const conservativeDrift: { fx: Fixture; skill: Verdict | "ERR" }[] = [];
  const underWarnings: { fx: Fixture; skill: Verdict | "ERR" }[] = [];

  for (const fx of FIXTURES) {
    let skill: Verdict | "ERR" = "ERR";
    let base: Verdict | "ERR" = "ERR";
    try {
      const report = await analyze(fx.mint);
      skill = report.verdict;
      base = authorityOnlyBaseline(report.mint);
    } catch (e: any) {
      console.error(`  ! ${fx.name} (${fx.mint.slice(0, 6)}…): ${e?.message ?? e}`);
    }
    const bOk = base === fx.expected;
    const sOk = skill === fx.expected;
    const bSafe = noUnderWarning(base, fx.expected);
    const sSafe = noUnderWarning(skill, fx.expected);
    if (bOk) baseOk++;
    if (sOk) skillOk++;
    if (bSafe) baseNoUnderWarn++;
    if (sSafe) skillNoUnderWarn++;
    if (sOk && !bOk) wins.push(fx);
    if (!sOk && sSafe) conservativeDrift.push({ fx, skill });
    if (!sSafe) underWarnings.push({ fx, skill });
    console.log(
      pad(fx.name, 10) +
        pad(fx.expected, 10) +
        pad(`${base} ${bOk ? "✓" : "✗"}`, 16) +
        pad(`${skill} ${sOk ? "✓" : "✗"}`, 16),
    );
  }

  const n = FIXTURES.length;
  console.log("-".repeat(78));
  console.log(pad("TOTAL exact", 20) + `baseline ${baseOk}/${n}      with-skill ${skillOk}/${n}`);
  console.log(pad("NO under-warn", 20) + `baseline ${baseNoUnderWarn}/${n}      with-skill ${skillNoUnderWarn}/${n}`);
  console.log("=".repeat(78));

  if (wins.length) {
    console.log("\nWhere the skill is right and the authority-only baseline is wrong:");
    for (const w of wins) console.log(`  • ${pad(w.name, 8)} (expected ${w.expected}) — ${w.why}`);
  }
  if (conservativeDrift.length) {
    console.log("\nConservative live drift (not an under-warning):");
    for (const d of conservativeDrift)
      console.log(`  • ${pad(d.fx.name, 8)} expected ${d.fx.expected}, got ${d.skill} — held stricter than the label.`);
  }
  if (underWarnings.length) {
    console.log("\nUnder-warnings (less severe than expected):");
    for (const u of underWarnings)
      console.log(`  • ${pad(u.fx.name, 8)} expected ${u.fx.expected}, got ${u.skill}`);
  }
  console.log("");

  // CI gate: the skill must measurably BEAT the authority-only baseline. (Gating
  // on an exact 11/11 would flake on live chain-state drift or a transient RPC
  // error; the robust invariants are "strictly better exact match than naive"
  // and "no under-warnings on the live labeled set."
  if (skillOk <= baseOk || skillNoUnderWarn < n) {
    console.error(
      `EVAL FAILED: exact with-skill ${skillOk}/${n} vs baseline ${baseOk}/${n}; ` +
        `no-under-warning with-skill ${skillNoUnderWarn}/${n}.`,
    );
    process.exit(1);
  }
  if (skillOk < n)
    console.warn(
      `(note: ${n - skillOk} fixture(s) missed exact ${n}/${n}; ` +
        `${skillNoUnderWarn}/${n} had no under-warning — live chain state; see EVAL.md scope.)`,
    );
  console.log(
    `EVAL PASSED: exact with-skill ${skillOk}/${n} > baseline ${baseOk}/${n}; ` +
      `no-under-warning ${skillNoUnderWarn}/${n}.`,
  );
}

main().catch((e) => {
  console.error(`eval error: ${e?.message ?? e}`);
  process.exit(2);
});
