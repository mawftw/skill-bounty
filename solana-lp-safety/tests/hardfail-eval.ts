/**
 * Hard-fail recall eval — the security-critical companion to the live eval.
 *
 *   npm run eval:hardfail
 *
 * For a safety tool, the worst error is a FALSE GO: clearing a token that can trap,
 * seize, dilute, or drain an LP. This eval measures recall on exactly that failure
 * mode. It drives one synthetic mint per disqualifying capability through the SAME
 * verdict engine the CLI uses (buildFindings + verdictFrom) and against the SAME
 * authority-only baseline as the live eval — then prints a confusion matrix and the
 * one number that matters: false-GO count.
 *
 * It is fully DETERMINISTIC and OFFLINE — the inputs are constructed token states,
 * not network captures — so it pins the verdict rules independent of chain drift and
 * runs in CI with no key. (The live eval covers real mints; this covers the full
 * hard-fail surface, including the Token-2022 seize powers that real GO/CAUTION
 * fixtures don't exhibit.)
 *
 * The headline: every NO-GO case below has its CLASSIC mint/freeze authorities
 * RENOUNCED, so the authority-only baseline waves them through as GO — a false GO on
 * every Token-2022 seize power, every rug/blacklist flag. The skill catches them.
 */
import assert from "node:assert/strict";
import { buildFindings, verdictFrom, isKnownGood } from "../scripts/lib/score.js";
import { authorityOnlyBaseline } from "../scripts/lib/baseline.js";
import type { MintInfo, PoolInfo, Verdict } from "../scripts/lib/types.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // canonical blue-chip
const WALLET = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9"; // arbitrary, untrusted
const DELEGATE = "2apBGMsS6ti9RyF5TwQTDswXBWskiJP2LD4cUEDqYJjk"; // a valid base58 pubkey (live delegate)

function mint(over: Partial<MintInfo> = {}): MintInfo {
  return {
    mint: WALLET,
    program: "spl-token",
    mintAuthority: null,
    freezeAuthority: null,
    decimals: 6,
    supply: "1000000",
    extensions: [],
    ...over,
  };
}
function t2022(extensions: any[], over: Partial<MintInfo> = {}): MintInfo {
  return mint({ program: "spl-token-2022", extensions, ...over });
}
function pool(over: Partial<PoolInfo> = {}): PoolInfo {
  return { address: "Poo1111111111111111111111111111111111111111", amm: "meteora-dlmm", baseMint: WALLET, quoteMint: USDC, ...over };
}

// Sources that satisfy the evidence-completeness gate (so a clean token can earn a
// GO rather than a fail-closed CAUTION): a present-but-empty RugCheck + a present
// holder set with no whale. NO-GO cases ignore these — a hard fail dominates.
const RUG_OK = {};
const HOLDERS_OK = { holders: [{ percent: "0.01" }] };

interface Case {
  name: string;
  group: "seize/exit (Token-2022)" | "classic authority" | "rug / blacklist" | "schema drift (fail-closed)" | "safe control";
  expected: Verdict;
  m: MintInfo;
  rugcheck?: any;
  goplus?: any;
  pool?: PoolInfo;
  note: string; // what the authority-only baseline does with it, and why
}

// Every NO-GO case keeps classic mint/freeze RENOUNCED unless the case IS a classic
// authority — so the baseline's verdict is the honest measure of its blind spot.
const CASES: Case[] = [
  // ---- Token-2022 seize / exit powers: baseline is BLIND (classic authorities renounced) ----
  { name: "permanent delegate (seize)", group: "seize/exit (Token-2022)", expected: "NO-GO",
    m: t2022([{ extension: "permanentDelegate", state: { delegate: DELEGATE } }]),
    note: "baseline GO — can't see the delegate that seizes pooled tokens" },
  { name: "active transfer hook", group: "seize/exit (Token-2022)", expected: "NO-GO",
    m: t2022([{ extension: "transferHook", state: { programId: DELEGATE } }]),
    note: "baseline GO — a hook can block add/remove of liquidity" },
  { name: "live transfer-fee authority", group: "seize/exit (Token-2022)", expected: "NO-GO",
    m: t2022([{ extension: "transferFeeConfig", state: { transferFeeConfigAuthority: WALLET, newerTransferFee: { epoch: 0, transferFeeBasisPoints: 50 } } }]),
    note: "baseline GO — fee can be ramped toward 100%, taxing every withdrawal" },
  { name: "pausable authority live", group: "seize/exit (Token-2022)", expected: "NO-GO",
    m: t2022([{ extension: "pausableConfig", state: { authority: WALLET, paused: false } }]),
    note: "baseline GO — transfers can be halted at will" },
  { name: "currently paused", group: "seize/exit (Token-2022)", expected: "NO-GO",
    m: t2022([{ extension: "pausableConfig", state: { paused: true } }]),
    note: "baseline GO — liquidity is frozen right now" },
  { name: "non-transferable (soulbound)", group: "seize/exit (Token-2022)", expected: "NO-GO",
    m: t2022([{ extension: "nonTransferable" }]),
    note: "baseline GO — can't be pooled or withdrawn at all" },
  { name: "pausable authority live + malformed paused", group: "seize/exit (Token-2022)", expected: "NO-GO",
    m: t2022([{ extension: "pausableConfig", state: { authority: WALLET, paused: "yes" } }]),
    note: "baseline GO — a malformed sibling field must not mask the live authority (hard dominates)" },
  { name: "transfer-fee authority live + bad schedule", group: "seize/exit (Token-2022)", expected: "NO-GO",
    m: t2022([{ extension: "transferFeeConfig", state: { transferFeeConfigAuthority: WALLET, newerTransferFee: "garbage" } }]),
    note: "baseline GO — malformed schedule must not mask the live fee authority (hard dominates)" },
  { name: "renounced 100% fixed transfer fee", group: "seize/exit (Token-2022)", expected: "NO-GO",
    m: t2022([{ extension: "transferFeeConfig", state: { transferFeeConfigAuthority: null, newerTransferFee: { epoch: 20, transferFeeBasisPoints: 10000 } } }]),
    note: "baseline GO — a renounced but 100% fee traps the LP on exit (exit-drain → hard)" },
  { name: "Token-2022 missing extensions array", group: "schema drift (fail-closed)", expected: "CAUTION",
    m: { mint: WALLET, program: "spl-token-2022", mintAuthority: null, freezeAuthority: null, decimals: 6, supply: "1", extensions: [{ extension: "__malformed_extensions__" }] } as any, rugcheck: RUG_OK, goplus: HOLDERS_OK,
    note: "baseline GO — a 2022 mint with no extensions array is schema drift; skill withholds GO" },
  { name: "active OLDER fee schedule (newer 0)", group: "schema drift (fail-closed)", expected: "CAUTION",
    m: t2022([{ extension: "transferFeeConfig", state: { transferFeeConfigAuthority: null, olderTransferFee: { epoch: 10, transferFeeBasisPoints: 500 }, newerTransferFee: { epoch: 20, transferFeeBasisPoints: 0 } } }]), rugcheck: RUG_OK, goplus: HOLDERS_OK,
    note: "baseline GO — reading only the newer (0 bps) schedule misses the older 5% tax" },
  { name: "fee schedule with negative bps", group: "schema drift (fail-closed)", expected: "CAUTION",
    m: t2022([{ extension: "transferFeeConfig", state: { transferFeeConfigAuthority: null, newerTransferFee: { epoch: 20, transferFeeBasisPoints: -500 } } }]), rugcheck: RUG_OK, goplus: HOLDERS_OK,
    note: "baseline GO — a negative/out-of-range rate is malformed; skill withholds GO" },
  { name: "pool target with no economics (TVL absent)", group: "schema drift (fail-closed)", expected: "CAUTION",
    m: mint(), pool: pool({}), rugcheck: RUG_OK, goplus: HOLDERS_OK,
    note: "baseline GO — a pool that can't be sized can't be cleared on depth; skill withholds GO" },
  { name: "unknown extension (fail-closed)", group: "seize/exit (Token-2022)", expected: "CAUTION",
    m: t2022([{ extension: "someBrandNewSeizePower" }]), rugcheck: RUG_OK, goplus: HOLDERS_OK,
    note: "baseline GO — a capability it can't decode is assumed safe; skill withholds GO" },

  // ---- Classic authorities: the ONE thing the baseline does see ----
  { name: "untrusted live freeze authority", group: "classic authority", expected: "NO-GO",
    m: mint({ freezeAuthority: WALLET }),
    note: "baseline NO-GO ✓ — the classic check it gets right" },
  { name: "untrusted live mint authority", group: "classic authority", expected: "NO-GO",
    m: mint({ mintAuthority: WALLET }),
    note: "baseline NO-GO ✓ — the classic check it gets right" },
  { name: "default-frozen + live freeze", group: "classic authority", expected: "NO-GO",
    m: t2022([{ extension: "defaultAccountState", state: { accountState: "frozen" } }], { freezeAuthority: WALLET }),
    note: "baseline NO-GO ✓ (freeze live) — skill also flags the default-frozen trap" },

  // ---- Rug / blacklist: baseline BLIND (authorities renounced) ----
  { name: "RugCheck rugged", group: "rug / blacklist", expected: "NO-GO",
    m: mint(), rugcheck: { rugged: true },
    note: "baseline GO — no rug/blacklist awareness" },
  { name: "Meteora blacklisted pool", group: "rug / blacklist", expected: "NO-GO",
    m: mint(), pool: pool({ isBlacklisted: true }),
    note: "baseline GO — no rug/blacklist awareness" },

  // ---- Schema drift INSIDE a known extension: must fail closed, never GO ----
  // (Adversarial, not authored from the happy path — answers "do you only test the
  // branches you wrote?". Classic authorities renounced, so only state-decoding moves it.)
  { name: "permanentDelegate, no state", group: "schema drift (fail-closed)", expected: "CAUTION",
    m: t2022([{ extension: "permanentDelegate" }]), rugcheck: RUG_OK, goplus: HOLDERS_OK,
    note: "baseline GO — can't decode the delegate field, so assumes safe; skill withholds GO" },
  { name: "transferHook programId wrong type", group: "schema drift (fail-closed)", expected: "CAUTION",
    m: t2022([{ extension: "transferHook", state: { programId: 12345 } }]), rugcheck: RUG_OK, goplus: HOLDERS_OK,
    note: "baseline GO — undecodable hook target; skill withholds GO" },
  { name: "pausableConfig paused non-boolean", group: "schema drift (fail-closed)", expected: "CAUTION",
    m: t2022([{ extension: "pausableConfig", state: { paused: "yes" } }]), rugcheck: RUG_OK, goplus: HOLDERS_OK,
    note: "baseline GO — malformed paused flag; skill withholds GO" },
  { name: "transferFeeConfig, no authority", group: "schema drift (fail-closed)", expected: "CAUTION",
    m: t2022([{ extension: "transferFeeConfig", state: { newerTransferFee: { transferFeeBasisPoints: 0 } } }]), rugcheck: RUG_OK, goplus: HOLDERS_OK,
    note: "baseline GO — can't confirm the fee authority is renounced; skill withholds GO" },
  { name: "transferFeeConfig, no fee schedule", group: "schema drift (fail-closed)", expected: "CAUTION",
    m: t2022([{ extension: "transferFeeConfig", state: { transferFeeConfigAuthority: null } }]), rugcheck: RUG_OK, goplus: HOLDERS_OK,
    note: "baseline GO — missing schedule must not default to a safe zero; skill withholds GO" },
  { name: "pausableConfig, missing paused field", group: "schema drift (fail-closed)", expected: "CAUTION",
    m: t2022([{ extension: "pausableConfig", state: { authority: null } }]), rugcheck: RUG_OK, goplus: HOLDERS_OK,
    note: "baseline GO — can't confirm transfers can't be halted; skill withholds GO" },
  { name: "defaultAccountState, invalid value", group: "schema drift (fail-closed)", expected: "CAUTION",
    m: t2022([{ extension: "defaultAccountState", state: { accountState: "garbage" } }]), rugcheck: RUG_OK, goplus: HOLDERS_OK,
    note: "baseline GO — unrecognized account-state can't be confirmed non-frozen; skill withholds GO" },
  { name: "duplicate permanentDelegate (safe, then live)", group: "schema drift (fail-closed)", expected: "NO-GO",
    m: t2022([{ extension: "permanentDelegate", state: { delegate: null } }, { extension: "permanentDelegate", state: { delegate: DELEGATE } }]), rugcheck: RUG_OK, goplus: HOLDERS_OK,
    note: "baseline GO — reads only the first (safe) copy; skill assesses ALL instances → seize power → NO-GO" },

  // ---- Safe controls: the skill must NOT over-block (no false NO-GO) ----
  { name: "clean renounced token", group: "safe control", expected: "GO",
    m: mint(), rugcheck: RUG_OK, goplus: HOLDERS_OK,
    note: "both GO — sanity floor: the skill isn't just blocking everything" },
  { name: "blue-chip USDC (by-design freeze)", group: "safe control", expected: "GO",
    m: mint({ mint: USDC, freezeAuthority: WALLET }), rugcheck: RUG_OK, goplus: HOLDERS_OK,
    note: "baseline NO-GO ✗ (false block) — skill waives the trusted issuer's by-design authority" },
];

function skillVerdict(c: Case): Verdict {
  const goplus = c.goplus ?? null;
  const knownGood = isKnownGood(c.m.mint, goplus);
  return verdictFrom(buildFindings(c.m, c.pool, c.rugcheck ?? null, goplus, knownGood));
}

const VERDICTS: Verdict[] = ["GO", "CAUTION", "NO-GO"];
const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n);

function main() {
  console.log("\nsolana-lp-safety-skill — hard-fail recall (deterministic, offline)");
  console.log("=".repeat(82));
  console.log(pad("case", 34) + pad("expected", 10) + pad("baseline", 14) + pad("skill", 12) + "result");
  console.log("-".repeat(82));

  let skillFalseGo = 0;   // expected NO-GO, skill said GO  ← the cardinal sin
  let baseFalseGo = 0;    // expected NO-GO, baseline said GO
  let skillFalseBlock = 0; // expected GO, skill said NO-GO
  let baseFalseBlock = 0;  // expected GO, baseline said NO-GO
  let nogoTotal = 0, skillNogoHit = 0, baseNogoHit = 0;
  let withholdTotal = 0, skillWithheld = 0, baseWithheld = 0; // expected CAUTION (fail-closed)
  let skillCorrect = 0;
  const confusion = new Map<string, number>(); // `${expected}>${skill}` → count

  let lastGroup = "";
  for (const c of CASES) {
    if (c.group !== lastGroup) { console.log(`  ── ${c.group} ──`); lastGroup = c.group; }
    const skill = skillVerdict(c);
    const base = authorityOnlyBaseline(c.m);
    const ok = skill === c.expected;
    if (ok) skillCorrect++;
    confusion.set(`${c.expected}>${skill}`, (confusion.get(`${c.expected}>${skill}`) ?? 0) + 1);

    if (c.expected === "NO-GO") {
      nogoTotal++;
      if (skill === "NO-GO") skillNogoHit++; else if (skill === "GO") skillFalseGo++;
      if (base === "NO-GO") baseNogoHit++; else if (base === "GO") baseFalseGo++;
    }
    if (c.expected === "GO") {
      if (skill === "NO-GO") skillFalseBlock++;
      if (base === "NO-GO") baseFalseBlock++;
    }
    if (c.expected === "CAUTION") {
      withholdTotal++;
      if (skill !== "GO") skillWithheld++;   // held the line (didn't leak to GO)
      if (base !== "GO") baseWithheld++;
    }
    console.log(
      pad(c.name, 34) + pad(c.expected, 10) +
      pad(`${base}${base === c.expected ? " ✓" : " ✗"}`, 14) +
      pad(`${skill}${ok ? " ✓" : " ✗"}`, 12) +
      (ok ? "" : "  ⚠ MISMATCH"),
    );
  }

  console.log("-".repeat(82));
  console.log(`\nNO-GO recall (caught disqualifying capabilities):`);
  console.log(`  skill     ${skillNogoHit}/${nogoTotal}`);
  console.log(`  baseline  ${baseNogoHit}/${nogoTotal}   (misses every Token-2022 seize power + rug/blacklist)`);
  console.log(`\nFALSE GO (cleared something disqualifying — the cardinal sin of a safety tool):`);
  console.log(`  skill     ${skillFalseGo}`);
  console.log(`  baseline  ${baseFalseGo}`);
  console.log(`\nFALSE NO-GO (over-blocked a safe token):`);
  console.log(`  skill     ${skillFalseBlock}`);
  console.log(`  baseline  ${baseFalseBlock}   (blocks USDC on its by-design freeze authority)`);
  console.log(`\nFAIL-CLOSED on undecodable / unknown capability (held at CAUTION, did NOT leak to GO):`);
  console.log(`  skill     ${skillWithheld}/${withholdTotal}`);
  console.log(`  baseline  ${baseWithheld}/${withholdTotal}   (parses no Token-2022 state — every drift case leaks to GO)`);

  console.log(`\nSkill confusion matrix (rows = expected, cols = skill verdict):`);
  console.log("           " + VERDICTS.map((v) => pad(v, 10)).join(""));
  for (const exp of VERDICTS) {
    const row = VERDICTS.map((got) => pad(String(confusion.get(`${exp}>${got}`) ?? 0), 10)).join("");
    console.log(pad(`  ${exp}`, 11) + row);
  }
  console.log(`\nSkill correct: ${skillCorrect}/${CASES.length}.`);
  console.log("=".repeat(82));

  // ---- CI gate: the security-critical invariants must hold exactly. ----
  try {
    assert.equal(skillFalseGo, 0, `skill produced ${skillFalseGo} FALSE GO(s) — a disqualifying token was cleared`);
    assert.equal(skillNogoHit, nogoTotal, `skill NO-GO recall ${skillNogoHit}/${nogoTotal} — must be 100%`);
    assert.equal(skillWithheld, withholdTotal, `skill leaked ${withholdTotal - skillWithheld} undecodable/unknown capability case(s) to GO`);
    assert.equal(skillFalseBlock, 0, `skill over-blocked ${skillFalseBlock} safe token(s)`);
    assert.equal(skillCorrect, CASES.length, `skill missed ${CASES.length - skillCorrect} case(s)`);
  } catch (e: any) {
    console.error(`\nHARD-FAIL EVAL FAILED: ${e?.message ?? e}\n`);
    process.exit(1);
  }
  console.log(
    `\nHARD-FAIL EVAL PASSED: skill recall ${skillNogoHit}/${nogoTotal} on disqualifying capabilities, ` +
    `0 false GO, ${skillWithheld}/${withholdTotal} undecodable cases held closed ` +
    `(baseline: ${baseNogoHit}/${nogoTotal} recall, ${baseFalseGo} false GO, ${baseWithheld}/${withholdTotal} held).\n`,
  );
}

main();
