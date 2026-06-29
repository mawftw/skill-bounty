/**
 * Unit tests for the verdict logic (buildFindings + verdictFrom + isKnownGood) —
 * PURE functions, no network, fully deterministic. Run: npm run test:unit
 *
 * The headline guard is P0.0: a broad RugCheck/Jupiter "verified" signal must NEVER
 * downgrade a live, dangerous authority to a GO — the worst error a safety tool can
 * make. The remaining tests pin the trust gate (genuine blue-chip / GoPlus
 * trusted_token still downgrade by-design authorities) and the invariant that hard
 * Token-2022 seize powers are never relaxed, trusted or not.
 */
import assert from "node:assert/strict";
import { buildFindings, verdictFrom, isKnownGood } from "../scripts/lib/score.js";
import { selectQuoteFindings } from "../scripts/lib/analyze.js";
import { parseMint, TOKEN, TOKEN_2022 } from "../scripts/lib/sources.js";
import type { MintInfo, PoolInfo } from "../scripts/lib/types.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // canonical blue-chip
const SOME_WALLET = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9"; // arbitrary, untrusted
const SOME_DELEGATE = "2apBGMsS6ti9RyF5TwQTDswXBWskiJP2LD4cUEDqYJjk"; // a valid base58 pubkey (live delegate)

function mint(over: Partial<MintInfo> = {}): MintInfo {
  return {
    mint: SOME_WALLET, // a non-blue-chip, untrusted mint by default
    program: "spl-token",
    mintAuthority: null,
    freezeAuthority: null,
    decimals: 6,
    supply: "1000000",
    extensions: [],
    ...over,
  };
}

function poolInfo(over: Partial<PoolInfo> = {}): PoolInfo {
  return {
    address: "Poo1111111111111111111111111111111111111111",
    amm: "meteora-dlmm",
    baseMint: SOME_WALLET,
    quoteMint: USDC,
    ...over,
  };
}

// A Token-2022 mint carrying the given extensions (authorities renounced unless
// overridden) — isolates one extension hard-fail branch at a time.
function t2022(extensions: any[], over: Partial<MintInfo> = {}): MintInfo {
  return mint({ program: "spl-token-2022", extensions, ...over });
}

// Run the full verdict pipeline on synthetic inputs (no holder data).
function verdict(m: MintInfo, rugcheck: any, goplus: any, pool?: PoolInfo) {
  const knownGood = isKnownGood(m.mint, goplus);
  return verdictFrom(buildFindings(m, pool, rugcheck, goplus, knownGood));
}

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e: any) {
    failures++;
    console.error(`  ✗ ${name}\n      ${e?.message ?? e}`);
  }
}

console.log("\nscore.ts — verdict unit tests");
console.log("=".repeat(64));

// --- P0.0: the false-GO guard (a broad "verified" must not trust an authority) ---
check("verified-but-untrusted + live freeze authority → NO-GO", () => {
  const v = verdict(
    mint({ freezeAuthority: SOME_WALLET }),
    { verification: { verified: true, jup_verified: true } }, // RugCheck/Jup say verified
    { trusted_token: "0" }, // but GoPlus does NOT trust it, and it's not a blue-chip
  );
  assert.equal(v, "NO-GO");
});

check("verified-but-untrusted + live mint authority → NO-GO", () => {
  const v = verdict(
    mint({ mintAuthority: SOME_WALLET }),
    { verification: { jup_verified: true } },
    null,
  );
  assert.equal(v, "NO-GO");
});

// --- genuine trust signals still downgrade a by-design authority to GO ------------
check("blue-chip (USDC) + live freeze authority → GO (downgraded)", () => {
  const v = verdict(mint({ mint: USDC, freezeAuthority: SOME_WALLET }), null, null);
  assert.equal(v, "GO");
});

check("blue-chip allowlist + live freeze authority → GO (fully downgraded)", () => {
  // only the canonical allowlist (here USDC) clears a LIVE authority to GO.
  const v = verdict(mint({ mint: USDC, freezeAuthority: SOME_WALLET }), null, { trusted_token: "1" });
  assert.equal(v, "GO");
});

check("third-party trusted_token ONLY + live freeze authority → CAUTION (not GO)", () => {
  // a single external trust bit must NOT clear a live authority on a non-allowlisted token.
  const v = verdict(mint({ freezeAuthority: SOME_WALLET }), null, { trusted_token: "1" });
  assert.equal(v, "CAUTION");
});

// --- hard Token-2022 seize powers are NEVER relaxed, even for a trusted token -----
check("trusted token + Token-2022 permanent delegate → NO-GO (seize never relaxed)", () => {
  const v = verdict(
    mint({
      mint: USDC, // trusted (blue-chip)
      program: "spl-token-2022",
      extensions: [{ extension: "permanentDelegate", state: { delegate: SOME_DELEGATE } }],
    }),
    null,
    { trusted_token: "1" },
  );
  assert.equal(v, "NO-GO");
});

// --- isKnownGood: verification alone is not trust; the narrow signals are ----------
check("isKnownGood: RugCheck/Jup verified alone is NOT trusted", () => {
  // isKnownGood no longer reads rugcheck at all — verification can't confer trust.
  assert.equal(isKnownGood(SOME_WALLET, { trusted_token: "0" }), false);
  assert.equal(isKnownGood(SOME_WALLET, null), false);
});

check("isKnownGood: blue-chip and GoPlus trusted_token ARE trusted", () => {
  assert.equal(isKnownGood(USDC, null), true);
  assert.equal(isKnownGood(SOME_WALLET, { trusted_token: "1" }), true);
  assert.equal(isKnownGood(SOME_WALLET, { trusted_token: 1 }), true);
});

// --- the OTHER trust-relaxable authority: live MINT authority ---
check("blue-chip allowlist + live MINT authority → GO (fully downgraded)", () => {
  assert.equal(verdict(mint({ mint: USDC, mintAuthority: SOME_WALLET }), null, { trusted_token: "1" }), "GO");
});
check("third-party trusted_token ONLY + live MINT authority → CAUTION (not GO)", () => {
  assert.equal(verdict(mint({ mintAuthority: SOME_WALLET }), null, { trusted_token: "1" }), "CAUTION");
});

// --- every UNCONDITIONAL hard fail: NO-GO untrusted AND still NO-GO when trusted ---
// Only classic freeze/mint authority is trust-relaxable (the GO cases above).
// Seize / exit-blocking / rugged / blacklist powers are NEVER relaxed — pin that
// for each branch so a future trust tweak can't silently re-open one.
const TRUSTED = { trusted_token: "1" };
interface HardCase { name: string; m: MintInfo; rugcheck?: any; pool?: PoolInfo }
const UNCONDITIONAL_HARD_FAILS: HardCase[] = [
  { name: "Token-2022 non-transferable", m: t2022([{ extension: "nonTransferable" }]) },
  { name: "Token-2022 active transfer hook", m: t2022([{ extension: "transferHook", state: { programId: SOME_DELEGATE } }]) },
  { name: "Token-2022 permanent delegate", m: t2022([{ extension: "permanentDelegate", state: { delegate: SOME_DELEGATE } }]) },
  { name: "Token-2022 pausable authority live", m: t2022([{ extension: "pausableConfig", state: { authority: SOME_WALLET, paused: false } }]) },
  { name: "Token-2022 currently paused", m: t2022([{ extension: "pausableConfig", state: { paused: true } }]) },
  { name: "Token-2022 transfer-fee authority live", m: t2022([{ extension: "transferFeeConfig", state: { transferFeeConfigAuthority: SOME_WALLET, newerTransferFee: { epoch: 0, transferFeeBasisPoints: 50 } } }]) },
  { name: "Token-2022 default-frozen + live freeze", m: t2022([{ extension: "defaultAccountState", state: { accountState: "frozen" } }], { freezeAuthority: SOME_WALLET }) },
  { name: "RugCheck rugged", m: mint(), rugcheck: { rugged: true } },
  { name: "Meteora blacklisted pool", m: mint(), pool: poolInfo({ isBlacklisted: true }) },
];
for (const c of UNCONDITIONAL_HARD_FAILS) {
  check(`${c.name} → NO-GO (untrusted)`, () => {
    assert.equal(verdict(c.m, c.rugcheck ?? null, null, c.pool), "NO-GO");
  });
  check(`${c.name} → NO-GO even when trusted (never relaxed)`, () => {
    assert.equal(verdict(c.m, c.rugcheck ?? null, TRUSTED, c.pool), "NO-GO");
  });
}

// --- evidence-completeness gate (fail-CLOSED): missing critical check ≠ safe ---
check("untrusted + renounced + NO RugCheck + NO holder data → CAUTION (not GO)", () => {
  // renounced authorities would otherwise be GO; but neither risk source ran.
  assert.equal(verdict(mint(), null, null), "CAUTION");
});

check("untrusted + renounced + RugCheck present + holder data present → GO", () => {
  // both critical checks ran and found nothing → a justified GO.
  assert.equal(verdict(mint(), {}, { holders: [{ percent: "0.01" }] }), "GO");
});

check("untrusted + renounced + RugCheck present but NO holder data → CAUTION", () => {
  assert.equal(verdict(mint(), {}, null), "CAUTION");
});

check("blue-chip allowlist + renounced + all sources missing → GO (gate exempt)", () => {
  // the canonical allowlist is un-spoofable, so a missing source can't move its verdict.
  assert.equal(verdict(mint({ mint: USDC }), null, null), "GO");
});

check("third-party trusted_token + renounced + RugCheck missing → CAUTION (rugged check un-relaxed)", () => {
  // a single external trust bit must NOT exempt the rugged/blacklist check it can't relax.
  assert.equal(verdict(mint(), null, { trusted_token: "1" }), "CAUTION");
});

check("third-party trusted_token + renounced + RugCheck present + NO concentration → CAUTION", () => {
  // trusted_token does NOT waive concentration (only the blue-chip allowlist does), so a
  // MISSING concentration source can't be read as safe — fail-closed to CAUTION, not GO.
  assert.equal(verdict(mint(), {}, { trusted_token: "1" }), "CAUTION");
});

// --- label-exclusion safeguard: a single ≥10% holder excluded ONLY on an unverified
//     third-party RugCheck label caps at CAUTION (a forged/incorrect label must not buy a GO) ---
function verdictH(m: MintInfo, rugcheck: any, goplus: any, holderStats: any) {
  return verdictFrom(buildFindings(m, undefined, rugcheck, goplus, isKnownGood(m.mint, goplus), holderStats));
}
// renounced mint + present sources + sub-threshold counted concentration → GO unless the
// label-exclusion gate fires; vary only the largest single label-excluded holder %.
const HS = (labelExcludedMaxPct: number) => ({
  top1: 5, top10: 20, excludedPct: 0, source: "test", labelExcludedMaxPct,
});
check("label-excluded single holder 9.99% → GO (below threshold)", () => {
  assert.equal(verdictH(mint(), {}, {}, HS(9.99)), "GO");
});
check("label-excluded single holder exactly 10% → CAUTION", () => {
  assert.equal(verdictH(mint(), {}, {}, HS(10)), "CAUTION");
});
check("label-excluded single holder 25% → CAUTION", () => {
  assert.equal(verdictH(mint(), {}, {}, HS(25)), "CAUTION");
});
check("label-excluded 25% + GoPlus trusted_token → still CAUTION (third-party trust doesn't exempt)", () => {
  assert.equal(verdictH(mint(), {}, { trusted_token: "1" }, HS(25)), "CAUTION");
});
check("label-excluded 25% on a canonical blue-chip → GO (allowlist exempt)", () => {
  assert.equal(verdictH(mint({ mint: USDC }), {}, {}, HS(25)), "GO");
});

check("incomplete evidence never downgrades a hard fail (stays NO-GO)", () => {
  // permanent delegate + missing sources: the hard fail dominates the soft gate.
  assert.equal(
    verdict(t2022([{ extension: "permanentDelegate", state: { delegate: SOME_DELEGATE } }]), null, null),
    "NO-GO",
  );
});

// --- fail-closed on MALFORMED / UNKNOWN data (never read as "safe") ---------------
check("malformed freeze authority (wrong type) → not GO (withheld)", () => {
  // a non-string authority must NOT be treated as renounced
  const v = verdict(mint({ freezeAuthority: { foo: 1 } as unknown as string }), {}, { holders: [{ percent: "0.01" }] });
  assert.notEqual(v, "GO");
});

check("malformed mint authority (wrong type) → not GO (withheld)", () => {
  const v = verdict(mint({ mintAuthority: 12345 as unknown as string }), {}, { holders: [{ percent: "0.01" }] });
  assert.notEqual(v, "GO");
});

check("implausible authority string (not base58) → not GO (withheld)", () => {
  const v = verdict(mint({ freezeAuthority: "not an address" }), {}, { holders: [{ percent: "0.01" }] });
  assert.notEqual(v, "GO");
});

check("unknown Token-2022 extension → CAUTION (capability not assessed)", () => {
  const v = verdict(t2022([{ extension: "someBrandNewSeizePower" }]), {}, { holders: [{ percent: "0.01" }] });
  assert.equal(v, "CAUTION");
});

check("benign known extension (metadataPointer) does NOT trip unrecognized → GO", () => {
  const v = verdict(t2022([{ extension: "metadataPointer" }]), {}, { holders: [{ percent: "0.01" }] });
  assert.equal(v, "GO");
});

// --- fail-CLOSED on malformed/missing state INSIDE a recognized extension ----------
// Schema drift inside a known extension (not just an unknown extension NAME) must
// never read as "safely absent" — a present risk capability we can't decode withholds
// GO. One adversarial case per risk field. (Each has classic authorities renounced, so
// only the extension-state handling can move the verdict.)
const SOURCES_OK: [any, any] = [{}, { holders: [{ percent: "0.01" }] }];
const malformedExt: { name: string; ext: any }[] = [
  { name: "permanentDelegate present, no state", ext: { extension: "permanentDelegate" } },
  { name: "permanentDelegate state without delegate field", ext: { extension: "permanentDelegate", state: {} } },
  { name: "permanentDelegate delegate not base58", ext: { extension: "permanentDelegate", state: { delegate: "not-an-address" } } },
  { name: "transferHook present, no state", ext: { extension: "transferHook" } },
  { name: "transferHook programId wrong type", ext: { extension: "transferHook", state: { programId: 12345 } } },
  { name: "pausableConfig present, no state", ext: { extension: "pausableConfig" } },
  { name: "pausableConfig empty state", ext: { extension: "pausableConfig", state: {} } },
  { name: "pausableConfig paused non-boolean", ext: { extension: "pausableConfig", state: { paused: "yes" } } },
  { name: "transferFeeConfig present, no state", ext: { extension: "transferFeeConfig" } },
  { name: "transferFeeConfig missing authority field", ext: { extension: "transferFeeConfig", state: { newerTransferFee: { transferFeeBasisPoints: 0 } } } },
  { name: "mintCloseAuthority closeAuthority wrong type", ext: { extension: "mintCloseAuthority", state: { closeAuthority: { x: 1 } } } },
];
for (const c of malformedExt) {
  check(`malformed known extension → not GO (withheld): ${c.name}`, () => {
    const v = verdict(t2022([c.ext]), SOURCES_OK[0], SOURCES_OK[1]);
    assert.notEqual(v, "GO");
    // and it must surface the fail-closed reason, not silently pass.
    const f = buildFindings(t2022([c.ext]), undefined, SOURCES_OK[0], SOURCES_OK[1], false);
    assert.ok(f.some((x) => x.code === "unparseable_extension_state"), "expected unparseable_extension_state");
  });
}

// a genuinely-renounced pausable (authority null, paused false) is still a clean GO —
// the fail-closed guard must not over-block well-formed safe state.
check("well-formed renounced pausable (authority null, paused false) → GO", () => {
  assert.equal(verdict(t2022([{ extension: "pausableConfig", state: { authority: null, paused: false } }]), {}, { holders: [{ percent: "0.01" }] }), "GO");
});

// default-account-state we can't decode + a LIVE freeze authority could be default-frozen → withhold.
check("undecodable defaultAccountState + live freeze → not GO (could be default-frozen)", () => {
  const v = verdict(t2022([{ extension: "defaultAccountState" }], { freezeAuthority: SOME_WALLET }), {}, { holders: [{ percent: "0.01" }] });
  assert.equal(v, "NO-GO"); // freeze live alone is already NO-GO (untrusted); the point is it never silently GOes
});

// --- fail-closed at the PARSE boundary (parseMint), not just the verdict layer ------
// A real mint's jsonParsed `info` always carries both authority fields (null or a
// pubkey). If a field is ABSENT (schema drift), parseMint must NOT coerce it to a safe
// "renounced" — it marks it malformed so the verdict withholds GO.
check("parseMint: ABSENT authority fields → malformed → not GO", () => {
  const acc = { owner: TOKEN, data: { parsed: { type: "mint", info: { decimals: 6, supply: "1" } } } };
  const m = parseMint(SOME_WALLET, acc); // info omits mintAuthority + freezeAuthority
  const v = verdictFrom(buildFindings(m, undefined, {}, { holders: [{ percent: "0.01" }] }, false));
  assert.notEqual(v, "GO");
});
check("parseMint: PRESENT-and-null authority fields → renounced → GO", () => {
  const acc = { owner: TOKEN, data: { parsed: { type: "mint", info: { mintAuthority: null, freezeAuthority: null, decimals: 6, supply: "1" } } } };
  const m = parseMint(SOME_WALLET, acc);
  const v = verdictFrom(buildFindings(m, undefined, {}, { holders: [{ percent: "0.01" }] }, false));
  assert.equal(v, "GO");
});
check("parseMint: a live authority pubkey survives parsing → NO-GO (untrusted)", () => {
  const acc = { owner: TOKEN, data: { parsed: { type: "mint", info: { mintAuthority: SOME_WALLET, freezeAuthority: null, decimals: 6, supply: "1" } } } };
  const m = parseMint(SOME_WALLET, acc);
  assert.equal(verdictFrom(buildFindings(m, undefined, {}, { holders: [{ percent: "0.01" }] }, false)), "NO-GO");
});

// --- a Token-2022 mint MUST carry an extensions array (missing one = schema drift) ---
check("parseMint: Token-2022 with ABSENT extensions field → malformed → not GO", () => {
  const acc = { owner: TOKEN_2022, data: { parsed: { type: "mint", info: { mintAuthority: null, freezeAuthority: null, decimals: 6, supply: "1" } } } };
  const m = parseMint(SOME_WALLET, acc); // a 2022 mint, but info omits `extensions`
  assert.notEqual(verdictFrom(buildFindings(m, undefined, {}, { holders: [{ percent: "0.01" }] }, false)), "GO");
});
check("parseMint: classic spl-token with no extensions field → GO (legitimately none)", () => {
  const acc = { owner: TOKEN, data: { parsed: { type: "mint", info: { mintAuthority: null, freezeAuthority: null, decimals: 6, supply: "1" } } } };
  const m = parseMint(SOME_WALLET, acc);
  assert.equal(verdictFrom(buildFindings(m, undefined, {}, { holders: [{ percent: "0.01" }] }, false)), "GO");
});

// --- transfer fee is the EFFECTIVE rate across BOTH schedules; a high fixed fee = hard ---
check("renounced fee with an active OLDER schedule (500 bps, newer 0) → CAUTION (not GO)", () => {
  // reading only `newerTransferFee` (0) would miss the older schedule's live 5% tax.
  const v = verdict(t2022([{ extension: "transferFeeConfig", state: { transferFeeConfigAuthority: null, olderTransferFee: { epoch: 10, transferFeeBasisPoints: 500 }, newerTransferFee: { epoch: 20, transferFeeBasisPoints: 0 } } }]), {}, { holders: [{ percent: "0.01" }] });
  assert.equal(v, "CAUTION");
});
check("renounced but 100% fixed transfer fee → NO-GO (exit-drain trap)", () => {
  const v = verdict(t2022([{ extension: "transferFeeConfig", state: { transferFeeConfigAuthority: null, newerTransferFee: { epoch: 20, transferFeeBasisPoints: 10000 } } }]), {}, { holders: [{ percent: "0.01" }] });
  assert.equal(v, "NO-GO");
});
check("renounced fee with a NEGATIVE bps → not GO (malformed schedule)", () => {
  const v = verdict(t2022([{ extension: "transferFeeConfig", state: { transferFeeConfigAuthority: null, newerTransferFee: { epoch: 20, transferFeeBasisPoints: -500 } } }]), {}, { holders: [{ percent: "0.01" }] });
  assert.notEqual(v, "GO");
});
check("renounced fee with a schedule missing its epoch → not GO (malformed)", () => {
  const v = verdict(t2022([{ extension: "transferFeeConfig", state: { transferFeeConfigAuthority: null, newerTransferFee: { transferFeeBasisPoints: 0 } } }]), {}, { holders: [{ percent: "0.01" }] });
  assert.notEqual(v, "GO");
});
check("renounced fee with null/null schedule → not GO (Number() coercion rejected)", () => {
  // Number(null)=0 would have made this look like a clean 0-bps fee → false GO.
  const v = verdict(t2022([{ extension: "transferFeeConfig", state: { transferFeeConfigAuthority: null, newerTransferFee: { epoch: null, transferFeeBasisPoints: null } } }]), {}, { holders: [{ percent: "0.01" }] });
  assert.notEqual(v, "GO");
});
check("renounced fee with boolean bps → not GO (coercion rejected)", () => {
  const v = verdict(t2022([{ extension: "transferFeeConfig", state: { transferFeeConfigAuthority: null, newerTransferFee: { epoch: 5, transferFeeBasisPoints: false } } }]), {}, { holders: [{ percent: "0.01" }] });
  assert.notEqual(v, "GO");
});
for (const [label, bad] of [["array [0]", [0]], ["whitespace string", "   "], ["object", {}], ["non-numeric string", "0x0"]] as [string, any][]) {
  check(`renounced fee with ${label} bps → not GO (Number() coercion rejected)`, () => {
    const v = verdict(t2022([{ extension: "transferFeeConfig", state: { transferFeeConfigAuthority: null, newerTransferFee: { epoch: 5, transferFeeBasisPoints: bad } } }]), {}, { holders: [{ percent: "0.01" }] });
    assert.notEqual(v, "GO");
  });
}
check("renounced fee with a numeric-STRING bps → accepted (real u64 fields can be strings)", () => {
  // "500" is a valid 5% fixed fee → soft CAUTION, not withheld-malformed.
  const v = verdict(t2022([{ extension: "transferFeeConfig", state: { transferFeeConfigAuthority: null, newerTransferFee: { epoch: "20", transferFeeBasisPoints: "500" } } }]), {}, { holders: [{ percent: "0.01" }] });
  assert.equal(v, "CAUTION");
});

// --- pool economics fail-closed: a pool we can't size can't be a clean GO ------------
check("pool target with NO economics (TVL absent) → CAUTION (fail-closed)", () => {
  const v = verdictFrom(buildFindings(mint(), poolInfo({}), {}, { holders: [{ percent: "0.01" }] }, false));
  assert.equal(v, "CAUTION");
});
check("pool target WITH economics + otherwise clean → GO", () => {
  const v = verdictFrom(buildFindings(mint(), poolInfo({ tvl: 1_000_000, fees24h: 100 }), {}, { holders: [{ percent: "0.01" }] }, false));
  assert.equal(v, "GO");
});

// --- a HARD fail is never masked by a malformed SIBLING field (hard dominates) ------
check("live pausable authority + malformed `paused` → NO-GO (hard dominates the withhold)", () => {
  const v = verdict(t2022([{ extension: "pausableConfig", state: { authority: SOME_WALLET, paused: "yes" } }]), {}, { holders: [{ percent: "0.01" }] });
  assert.equal(v, "NO-GO");
});
check("live transfer-fee authority + malformed schedule → NO-GO (hard dominates)", () => {
  const v = verdict(t2022([{ extension: "transferFeeConfig", state: { transferFeeConfigAuthority: SOME_WALLET, newerTransferFee: "garbage" } }]), {}, { holders: [{ percent: "0.01" }] });
  assert.equal(v, "NO-GO");
});

// --- automated pool economics: realized fee-APR realism (wash-trade signal) ---------
check("pool with an implausible realized fee APR → CAUTION (wash-trade heads-up)", () => {
  // 50000/100000 × 365 × 100 ≈ 18,250% APR → far above the realism threshold.
  const p = poolInfo({ tvl: 100_000, fees24h: 50_000 });
  const f = buildFindings(mint(), p, {}, { holders: [{ percent: "0.01" }] }, false);
  assert.equal(verdictFrom(f), "CAUTION");
  assert.ok(f.some((x) => x.code === "fee_apr_unrealistic"));
});
check("pool with a normal realized fee APR → GO + measured-yield info", () => {
  const p = poolInfo({ tvl: 1_000_000, fees24h: 100 }); // ~3.65% APR
  const f = buildFindings(mint(), p, {}, { holders: [{ percent: "0.01" }] }, false);
  assert.equal(verdictFrom(f), "GO");
  assert.ok(f.some((x) => x.code === "fee_yield"), "should still surface the measured yield as info");
  assert.ok(!f.some((x) => x.code === "fee_apr_unrealistic"));
});
check("reserve balance is reported as INFO and never changes the verdict", () => {
  const p = poolInfo({ tvl: 1_000_000, fees24h: 100, baseValuePct: 1 }); // extremely one-sided
  const f = buildFindings(mint(), p, {}, { holders: [{ percent: "0.01" }] }, false);
  assert.equal(verdictFrom(f), "GO"); // info-only — one-sidedness is a heads-up, not a block
  assert.ok(f.some((x) => x.code === "pool_balance" && x.severity === "info"));
});

// --- quote side folds in HARD + fail-closed SOFT (parity with the base side) -------
// (The pool verdict must not pass GO when the QUOTE token is malformed/unknown/seizing.)
check("quote-side keeps a malformed-authority soft flag (both-sides fail-closed)", () => {
  const f = buildFindings(mint({ freezeAuthority: { x: 1 } as unknown as string }), undefined, {}, null, false);
  assert.ok(selectQuoteFindings(f, SOME_WALLET).some((x) => x.code === "quote_unparseable_authority"));
});

check("quote-side keeps an unknown-extension soft flag", () => {
  const f = buildFindings(t2022([{ extension: "someBrandNewSeizePower" }]), undefined, {}, null, false);
  assert.ok(selectQuoteFindings(f, SOME_WALLET).some((x) => x.code === "quote_unrecognized_extension"));
});

check("quote-side keeps a hard fail (permanent delegate)", () => {
  const f = buildFindings(t2022([{ extension: "permanentDelegate", state: { delegate: SOME_DELEGATE } }]), undefined, null, null, false);
  assert.ok(selectQuoteFindings(f, SOME_WALLET).some((x) => x.code === "quote_permanent_delegate"));
});

check("quote-side drops noise soft flags (concentration is not a quote risk)", () => {
  const f = buildFindings(mint(), undefined, {}, { holders: [{ percent: "0.5" }] }, false);
  assert.ok(!selectQuoteFindings(f, SOME_WALLET).some((x) => x.code.includes("concentration")));
});

check("quote-side PRESERVES incomplete-evidence (untrusted quote, missing sources → withhold pool GO)", () => {
  // an untrusted quote with no RugCheck + no holder data emits incomplete_evidence;
  // it must survive aggregation as quote_incomplete_evidence (a CAUTION-capping soft),
  // or a pool with a thinly-verified quote token could falsely retain GO.
  const f = buildFindings(mint(), undefined, null, null, false);
  assert.ok(f.some((x) => x.code === "incomplete_evidence"), "base build should flag incomplete_evidence");
  assert.ok(selectQuoteFindings(f, SOME_WALLET).some((x) => x.code === "quote_incomplete_evidence"),
    "quote side must keep incomplete_evidence (fail-closed)");
});

check("quote-side preserves malformed-extension-state (fail-closed)", () => {
  const f = buildFindings(t2022([{ extension: "permanentDelegate" }]), undefined, {}, { holders: [{ percent: "0.01" }] }, false);
  assert.ok(selectQuoteFindings(f, SOME_WALLET).some((x) => x.code === "quote_unparseable_extension_state"));
});

check("quote-side folds a third-party-trusted quote's LIVE authority (can trap the LP)", () => {
  // a non-allowlist trusted quote's live freeze is a SOFT residual on the base side; on
  // the quote side it can still freeze the LP → it must fold into the pool verdict.
  const f = buildFindings(mint({ freezeAuthority: SOME_WALLET }), undefined, {}, { trusted_token: "1" }, true);
  assert.ok(selectQuoteFindings(f, SOME_WALLET).some((x) => x.code === "quote_freeze_authority_live"));
});

console.log("=".repeat(64));
if (failures) {
  console.error(`\nUNIT TESTS FAILED: ${failures} failing.\n`);
  process.exit(1);
}
console.log("\nALL UNIT TESTS PASSED.\n");
