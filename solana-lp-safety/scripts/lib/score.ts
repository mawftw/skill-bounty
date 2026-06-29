// Aggregates all source data into findings + a GO/CAUTION/NO-GO verdict.
// Mirrors skill/scoring.md. Raw RPC is authoritative for the hard fails;
// aggregators (RugCheck/GoPlus) add corroboration and soft flags.

import { isNone, fieldState } from "./http.js";
import type { Finding, MintInfo, PoolInfo, Verdict } from "./types.js";
import type { HolderStats } from "./sources.js";

// Public default thresholds (the commodity baseline; Rake tunes its own).
const TH = {
  thinTvlUsd: 25_000,
  topHolderPct: 10,
  top10Pct: 30,
  lpLockMinPct: 50, // DAMM v2: below this much permanent-locked LP = concern
  feeBpsExitDrain: 5000, // a fixed transfer fee this high (>=50%) traps the LP on exit = hard
  feeAprUnrealisticPct: 1000, // realized fee APR above this is implausible/transient = wash-trade flag
  lopsidedMinSidePct: 4, // one side below this % of pool value = extreme imbalance (info)
};

// Canonical blue-chip mints — always recognized as trusted, independent of any
// API. The GoPlus `trusted_token` list covers the broader universe; this is a
// robustness fallback for the absolute-canonical mints when that API is flaky.
const BLUE_CHIPS = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "So11111111111111111111111111111111111111112", // wSOL
]);

// Token-2022 extensions we recognize — either explicitly risk-assessed in buildFindings
// or known to carry no LP seize/freeze/exit risk (metadata, grouping, account-level
// mirrors). An extension OUTSIDE this set (a new or undecodable one) is treated as an
// unknown risk and withholds GO: a safety tool must not silently ignore a capability it
// cannot reason about.
const KNOWN_EXTENSIONS = new Set([
  // risk-assessed below:
  "transferFeeConfig", "transferHook", "permanentDelegate", "pausableConfig",
  "defaultAccountState", "mintCloseAuthority", "nonTransferable",
  "interestBearingConfig", "scaledUiAmountConfig",
  // benign / no LP seize-or-freeze risk:
  "transferFeeAmount", "metadataPointer", "tokenMetadata", "groupPointer",
  "tokenGroup", "groupMemberPointer", "tokenGroupMember", "immutableOwner",
  "memoTransfer", "cpiGuard", "nonTransferableAccount", "transferHookAccount",
  "pausableAccount", "confidentialTransferMint", "confidentialTransferAccount",
  "confidentialTransferFeeConfig", "confidentialTransferFeeAmount",
]);

function ext(m: MintInfo, name: string) {
  return m.extensions.find((e) => e.extension === name);
}

// Fail-closed read of a pubkey field INSIDE a recognized extension's `state`. The
// real jsonParsed RPC always returns `state` as an object with the field present
// (value possibly null) — so anything else is schema drift we must NOT read as
// "safely renounced". Returns "malformed" when state is missing / not an object /
// the expected field is absent, else the field's own three-way fieldState.
//   "live" = present authority/delegate → hard fail
//   "absent" = genuinely none/renounced
//   "malformed" = undecodable → withhold GO (soft), never assume safe
function extFieldState(e: any, field: string): "live" | "absent" | "malformed" {
  const st = e?.state;
  if (st == null || typeof st !== "object" || Array.isArray(st)) return "malformed";
  if (!(field in st)) return "malformed";
  return fieldState(st[field]);
}

// "Known-good" = a defensible issuer-trust signal strong enough to treat a token's
// BY-DESIGN live authority (e.g. USDC's freeze authority) as a residual note rather
// than a hard block. ONLY GoPlus's curated `trusted_token` list or the canonical
// BLUE_CHIPS allowlist qualify.
//
// RugCheck/Jupiter `verification` is DELIBERATELY excluded: "verified" means the token
// has a listing + socials, NOT that its live freeze/mint authority is safe. Trusting it
// would let a verified-but-untrusted token with a live, dangerous authority earn a false
// GO — the worst error a safety tool can make. (Hard Token-2022 seize powers are never
// relaxed by this signal either; see buildFindings.)
export function isKnownGood(mint: string, goplus: any): boolean {
  if (BLUE_CHIPS.has(mint)) return true;
  if (goplus?.trusted_token === "1" || goplus?.trusted_token === 1) return true;
  return false;
}

export function buildFindings(
  mint: MintInfo,
  pool: PoolInfo | undefined,
  rugcheck: any,
  goplus: any,
  knownGood: boolean,
  holderStats: HolderStats | null = null,
  holderCount: { holders: number; capped: boolean } | null = null,
): Finding[] {
  const f: Finding[] = [];
  const push = (severity: Finding["severity"], code: string, message: string, source = "RPC") =>
    f.push({ severity, code, message, source });

  // `knownGood` (see isKnownGood) is the trust signal — GoPlus `trusted_token` or the
  // canonical BLUE_CHIPS allowlist. A trusted token's issuer-by-design authority/metadata
  // is downgraded to a residual note. NOTE the TIERS differ by what they relax: the
  // blue-chip allowlist also waives custodial holder CONCENTRATION (a stablecoin's reserves
  // are by-design), but a third-party `trusted_token` flag alone does NOT — it can't clear a
  // real, withdrawable concentration, so that stays a soft flag (see the concentration block).
  // Degen/unverified tokens are NOT trusted, so their flags stay. A broad RugCheck/Jupiter
  // "verified" status is intentionally NOT trust here, so a verified-but-untrusted token
  // with a live authority still hard-fails to NO-GO. Hard Token-2022 seize powers
  // (permanent delegate, pausable, live transfer-fee authority, active hook,
  // non-transferable) are NEVER relaxed, trusted or not (see below).
  const trusted = knownGood;
  // Trust PROVENANCE: surface exactly which signal conferred issuer trust and the
  // bounded scope of what it relaxes — so a reviewer can see the single external bit
  // and confirm it never reaches a seize power / rugged flag.
  if (trusted)
    push("info", "trust_basis",
      BLUE_CHIPS.has(mint.mint)
        ? `Issuer trust applied via the canonical blue-chip allowlist — relaxes by-design mint/freeze authority, custodial holder concentration & mutable metadata to residual; NEVER a Token-2022 seize power or a rugged/blacklist flag.`
        : `Issuer trust applied via the GoPlus trusted_token list — relaxes by-design mint/freeze authority & mutable metadata to residual (caps a live authority at CAUTION); does NOT clear holder concentration, a Token-2022 seize power, or a rugged/blacklist flag.`);

  // ---- Classic authorities (authoritative: RPC) ----------------------------
  // fieldState withholds GO on MALFORMED data — a non-string / undecodable authority
  // is never read as "safely renounced" (fail-closed against schema drift).
  //
  // TIERED trust for a LIVE classic authority (the blast radius of the single trust bit):
  //  • canonical blue-chip ALLOWLIST (USDC/USDT/wSOL) — issuer control is genuinely
  //    by-design and the hardcoded list can't be spoofed → INFO residual (GO ok).
  //  • third-party `trusted_token` ONLY (a single external bit) — NOT strong enough to
  //    clear a live mint/freeze authority on its own → SOFT residual (caps at CAUTION),
  //    so an arbitrary token can't ride one external flag straight to GO.
  //  • untrusted → HARD (NO-GO).
  const authorityAllowlisted = BLUE_CHIPS.has(mint.mint);
  const liveAuthority = (kind: "Freeze" | "Mint", code: string, val: any, impact: string) => {
    if (authorityAllowlisted)
      push("info", `${code}_known_good`,
        `${kind} authority live (${val}) but token is a canonical blue-chip — residual risk, not a block.`);
    else if (trusted)
      push("soft", `${code}_live`,
        `${kind} authority is live (${val}); issuer is third-party-trusted but not a canonical blue-chip — residual control, capped at CAUTION (one external flag can't clear a live authority).`);
    else
      push("hard", `${code}_live`, `${kind} authority is live (${val}) — ${impact}.`);
  };
  const freeze = fieldState(mint.freezeAuthority);
  if (freeze === "malformed")
    push("soft", "unparseable_authority",
      "Freeze-authority field is malformed/undecodable — cannot confirm it is renounced; withholding GO.");
  else if (freeze === "live")
    liveAuthority("Freeze", "freeze_authority", mint.freezeAuthority, "your position/vault can be frozen");
  const mintAuth = fieldState(mint.mintAuthority);
  if (mintAuth === "malformed")
    push("soft", "unparseable_authority",
      "Mint-authority field is malformed/undecodable — cannot confirm it is renounced; withholding GO.");
  else if (mintAuth === "live")
    liveAuthority("Mint", "mint_authority", mint.mintAuthority, "supply can be inflated, diluting the pool");

  // ---- Token-2022 extensions (authoritative: RPC) --------------------------
  if (mint.program === "spl-token-2022") {
    // Each recognized risk extension is read FAIL-CLOSED: if its name is present but
    // the risk-determining state is malformed/undecodable (schema drift inside a known
    // extension), we withhold GO rather than read it as "safely absent". A real
    // capability we can't decode is treated as unverified, never as safe.
    const withholdExt = (what: string) =>
      push("soft", "unparseable_extension_state",
        `Token-2022 ${what} state is malformed/undecodable — cannot confirm it is safe; withholding GO.`);
    // EVERY instance of a risk extension is evaluated (not just the first), so a
    // duplicate can't mask a dangerous one. A real mint carries at most one of each,
    // so a duplicate is itself anomalous → flag it (withhold GO) AND assess all copies.
    const allExts = (name: string) => mint.extensions.filter((e) => e?.extension === name);
    const counts = new Map<string, number>();
    for (const e of mint.extensions) {
      const n = typeof e?.extension === "string" ? e.extension : null;
      if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    for (const [n, c] of counts)
      if (c > 1)
        push("soft", "duplicate_extension",
          `Token-2022 carries ${c}× the "${n}" extension — anomalous; a later instance could mask an earlier one. Withholding GO.`);

    if (allExts("nonTransferable").length)
      push("hard", "non_transferable", "Token is non-transferable (soulbound) — cannot be pooled/withdrawn.");

    for (const hook of allExts("transferHook")) {
      const prog = extFieldState(hook, "programId");
      if (prog === "live")
        push("hard", "transfer_hook_active",
          `Active transfer hook (${hook.state.programId}) — can block add/remove of liquidity.`);
      else if (prog === "malformed" || extFieldState(hook, "authority") === "malformed")
        withholdExt("transfer-hook");
      else if (extFieldState(hook, "authority") === "live")
        push("soft", "latent_transfer_hook",
          "Transfer-hook authority is live (no active hook yet) — a blocking hook can be added later.");
    }

    for (const pd of allExts("permanentDelegate")) {
      const d = extFieldState(pd, "delegate");
      if (d === "live")
        push("hard", "permanent_delegate",
          `Permanent delegate set (${pd.state.delegate}) — can seize tokens from the pool. Irrevocable.`);
      else if (d === "malformed") withholdExt("permanent-delegate");
    }

    for (const pause of allExts("pausableConfig")) {
      const st = pause.state;
      if (st == null || typeof st !== "object" || Array.isArray(st)) { withholdExt("pausable"); continue; }
      // HARD signals are evaluated INDEPENDENTLY (and dominate) — a malformed sibling
      // field can never downgrade a confirmed hard fail below NO-GO.
      if (st.paused === true)
        push("hard", "pausable_live", "Token transfers are currently PAUSED — liquidity is frozen.");
      else if (fieldState(st.authority) === "live")
        push("hard", "pausable_live", "Pausable authority is live — transfers/withdrawals can be halted at will.");
      // real pausable state always carries `authority` AND a boolean `paused`; anything
      // less (or a malformed authority) means we can't confirm transfers can't be halted
      // → also withhold (a soft flag that can't lower a hard fail, only raise a GO to CAUTION).
      if (!("authority" in st) || !("paused" in st) || typeof st.paused !== "boolean" || fieldState(st.authority) === "malformed")
        withholdExt("pausable");
    }

    for (const fee of allExts("transferFeeConfig")) {
      const st = fee.state;
      if (st == null || typeof st !== "object" || Array.isArray(st)) { withholdExt("transfer-fee-config"); continue; }
      const a = fieldState(st.transferFeeConfigAuthority);
      // A Token-2022 fee config carries TWO schedules (older + newer); the newer activates
      // at its epoch, so before then the OLDER one is still in force. We don't fetch the
      // current epoch, so the fail-closed effective rate is the MAX of the two — checking
      // only `newerTransferFee` would miss an active tax hiding in the older schedule.
      // A schedule is well-formed only if it's an object with a finite epoch and a basis-
      // point rate in [0, 10000] (10000 bps = 100%); a missing epoch, negative/out-of-range
      // rate, or non-object is schema drift → withhold GO (never read as a safe zero).
      // numField accepts ONLY a real number or a strict numeric string — rejecting every
      // value Number() would silently coerce to a number (null, boolean, "", "  ", [], [0],
      // {}), any one of which could otherwise fake a clean 0-bps schedule.
      const numField = (v: any, min: number, max: number): number | null => {
        let n: number;
        if (typeof v === "number") n = v;
        else if (typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim())) n = Number(v.trim());
        else return null;
        return Number.isFinite(n) && n >= min && n <= max ? n : null;
      };
      const schedOk = (s: any) =>
        s != null && typeof s === "object" &&
        numField(s.transferFeeBasisPoints, 0, 10_000) != null &&
        numField(s.epoch, 0, Number.MAX_SAFE_INTEGER) != null;
      const present = [st.olderTransferFee, st.newerTransferFee].filter((s) => s != null);
      const validBps = present.filter(schedOk).map((s) => Number(s.transferFeeBasisPoints));
      const effBps = validBps.length ? Math.max(...validBps) : NaN;
      // HARD first, INDEPENDENTLY — a malformed sibling field can't downgrade a hard fail.
      if (a === "live")
        push("hard", "transfer_fee_authority_live",
          `Transfer-fee authority is live (effective ${Number.isFinite(effBps) ? effBps : "?"} bps) — fee can be ramped toward 100%, taxing every withdrawal.`);
      else if (Number.isFinite(effBps) && effBps >= TH.feeBpsExitDrain)
        push("hard", "transfer_fee_exit_drain",
          `Fixed transfer fee is ${(effBps / 100).toFixed(1)}% (authority renounced, effective across schedules) — withdrawing the position is taxed to the point of a trap.`);
      else if (Number.isFinite(effBps) && effBps > 0)
        push("soft", "transfer_fee_fixed",
          `Fixed transfer fee of ${effBps} bps (authority renounced, effective across schedules) — skims every transfer/withdrawal.`);
      // fail-closed: missing authority field, malformed authority, or ANY present-but-
      // malformed schedule withholds GO (soft — never lowers the hard fail above).
      const schedUndecodable = present.length === 0 || present.length !== validBps.length;
      if (!("transferFeeConfigAuthority" in st) || a === "malformed" || schedUndecodable)
        withholdExt("transfer-fee-config");
    }

    const VALID_ACCT_STATE = new Set(["initialized", "frozen", "uninitialized"]);
    for (const dflt of allExts("defaultAccountState")) {
      const st = dflt.state;
      const acc = st != null && typeof st === "object" && !Array.isArray(st) ? st.accountState : undefined;
      if (acc === "frozen") {
        if (!isNone(mint.freezeAuthority))
          push("hard", "default_frozen",
            "New token accounts are frozen by default + freeze authority live — vaults can be stranded.");
        else
          push("soft", "default_frozen_no_thaw",
            "New token accounts default to frozen but no freeze authority exists to thaw them — verify accounts aren't permanently frozen.");
      } else if (!(typeof acc === "string" && VALID_ACCT_STATE.has(acc))) {
        // missing or unrecognized accountState — can't confirm new accounts aren't frozen.
        withholdExt("default-account-state");
      }
    }

    for (const close of allExts("mintCloseAuthority")) {
      const c = extFieldState(close, "closeAuthority");
      if (c === "live")
        push("soft", "mint_close_authority",
          "Mint-close authority is live — mint can be closed and reinitialized with worse settings.");
      else if (c === "malformed") withholdExt("mint-close-authority");
    }

    if (ext(mint, "interestBearingConfig"))
      push("info", "interest_bearing",
        "Interest-bearing: displayed uiAmount drifts (raw balance unchanged) — price off the raw amount.");
    if (ext(mint, "scaledUiAmountConfig"))
      push("info", "scaled_ui",
        "Scaled-UI (rebasing display): uiAmount is scaled (raw balance unchanged) — price off the raw amount.");

    // Fail-closed on the UNKNOWN: an extension we don't recognize (new type, or an
    // undecodable entry) is a capability we can't reason about → withhold GO.
    const seen = new Set<string>();
    for (const e of mint.extensions) {
      const name = typeof e?.extension === "string" ? e.extension : null;
      if ((name && KNOWN_EXTENSIONS.has(name)) || (name && seen.has(name))) continue;
      if (name) seen.add(name);
      push("soft", "unrecognized_extension",
        `Token-2022 carries an unrecognized extension${name ? ` (${name})` : " (undecodable entry)"} — capability not assessed; withholding GO.`);
    }
  }

  // ---- Rugged / blacklisted (hard) -----------------------------------------
  if (rugcheck?.rugged === true)
    push("hard", "rugged_or_blacklisted", "RugCheck flags this token as RUGGED.", "RugCheck");
  if (pool?.isBlacklisted)
    push("hard", "rugged_or_blacklisted", "Meteora has blacklisted this pool.", "Meteora");

  // ---- Mutable metadata (soft) ---------------------------------------------
  if (rugcheck?.tokenMeta?.mutable === true)
    push(trusted ? "info" : "soft", "mutable_metadata",
      `Token metadata is mutable (name/symbol/URI can change).${trusted ? " Trusted issuer — residual, not a block." : ""}`, "RugCheck");
  else if (goplus?.metadata_mutable?.status === "1")
    push(trusted ? "info" : "soft", "mutable_metadata",
      `Token metadata is mutable (GoPlus).${trusted ? " Trusted issuer — residual, not a block." : ""}`, "GoPlus");

  // ---- Holder concentration (soft) -----------------------------------------
  // Prefer authoritative on-chain (Helius/RPC largest accounts); fall back to GoPlus.
  const conc = holderStats ?? concentration(goplus);
  const concSrc = holderStats ? `Helius ${holderStats.source}` : "GoPlus";
  const labels = holderLabels(rugcheck); // RugCheck knownAccounts → who each holder is
  if (conc) {
    // Only the canonical blue-chip allowlist (USDC/USDT/wSOL) waives concentration to a
    // residual note — a custodial stablecoin's holdings are genuinely by-design. A
    // third-party GoPlus `trusted_token` flag ALONE does NOT clear a real dump risk, so
    // its concentration stays a soft flag (→ CAUTION), mirroring the tiered live-authority
    // rule (one external bit can't clear a real, withdrawable concentration).
    const concWaived = authorityAllowlisted;
    const concSev: Finding["severity"] = concWaived ? "info" : "soft";
    if (conc.top1 > TH.topHolderPct) {
      const who = labels?.labelOf(holderStats?.top1Owner);
      const suffix = concWaived
        ? " — canonical blue-chip, so this is residual (custodial/issuer holdings), not a block."
        : holderStats?.top1Owner
          ? who
            ? ` Largest holder is ${who}.`
            : " Largest holder is unlabeled (a private wallet) — identify it before LPing."
          : "";
      push(concSev, "holder_concentration",
        `Top non-pool holder controls ${conc.top1.toFixed(1)}% (threshold ${TH.topHolderPct}%).${suffix}`, concSrc);
    } else if (conc.top10 > TH.top10Pct) {
      push(concSev, "holder_concentration",
        `Top-10 non-pool holders control ${conc.top10.toFixed(1)}% (threshold ${TH.top10Pct}%).${concWaived ? " — canonical blue-chip, residual not a block." : ""}`, concSrc);
    }
  }
  if (holderCount)
    push("info", "holder_count",
      `Unique holders (Helius DAS${holderCount.capped ? ", sampled first 1000 accts" : ""}): ${holderCount.capped ? `${holderCount.holders}+` : holderCount.holders}.`,
      "Helius DAS");
  // Where the non-circulating supply sits. Prefer RugCheck's labeled registry
  // (it catches lockers/AMMs our program-ownership heuristic can miss); fall back
  // to the on-chain excluded total when RugCheck has no labels.
  if (labels && labels.composition.length)
    push("info", "holder_labels",
      `Where the big holders sit (RugCheck labels): ${labels.composition.slice(0, 4).map((c) => `${c.pct.toFixed(0)}% ${c.label}`).join(" · ")} — mostly liquidity / locked supply (CREATOR-labeled positions can still move — treat those as potentially free-floating).`,
      "RugCheck");
  else if (holderStats && holderStats.excludedPct > 1)
    push("info", "excluded_supply",
      `${holderStats.excludedPct.toFixed(1)}% of supply sits in known AMM pools / lockers — excluded from holder concentration (that's liquidity or locked supply, not a free-floating whale).`,
      "on-chain");
  // Program-owned supply we could NOT classify as a known AMM/locker is COUNTED in the
  // concentration above (fail-closed); surface it so the LP can identify the custodian.
  if (holderStats?.unknownProgramPct && holderStats.unknownProgramPct > 1)
    push("info", "unlisted_program_supply",
      `${holderStats.unknownProgramPct.toFixed(1)}% of supply sits in an UNRECOGNIZED program escrow/PDA — counted as concentration (treated as potentially withdrawable, NOT assumed locked). Identify the controlling program before LPing.`,
      "on-chain");
  // A MATERIAL amount of supply excluded SOLELY on a third-party RugCheck LOCKER/AMM/BURN
  // label we could not verify on-chain must NOT buy a GO — a forged/incorrect label would
  // otherwise hide a whale. Cap the verdict at CAUTION (soft) unless the token is a
  // canonical blue-chip. Threshold = the per-holder concentration threshold.
  if (!authorityAllowlisted && holderStats?.labelExcludedMaxPct && holderStats.labelExcludedMaxPct >= TH.topHolderPct)
    push("soft", "unverified_label_exclusion",
      `A single holder of ${holderStats.labelExcludedMaxPct.toFixed(1)}% was excluded from concentration on a third-party (RugCheck) lock/AMM label alone — this tool does not independently verify that lock on-chain, so the verdict is capped at CAUTION. Verify the lock before LPing (an incorrect/forged label must not earn a GO).`,
      "skill");

  // ---- Pool health (soft) --------------------------------------------------
  if (pool) {
    if (pool.tvl != null && pool.tvl < TH.thinTvlUsd)
      push("soft", "thin_tvl",
        `Thin pool TVL ~$${Math.round(pool.tvl).toLocaleString()} (< $${TH.thinTvlUsd.toLocaleString()}) — manipulable, high exit slippage.`, "Meteora");
    if (pool.amm === "meteora-damm-v2" && pool.permanentLockPct != null && pool.permanentLockPct < TH.lpLockMinPct)
      push("soft", "lp_low_lock",
        `Only ${pool.permanentLockPct.toFixed(0)}% of DAMM v2 LP is permanently locked — creator can withdraw most liquidity.`, "Meteora");
    if (pool.baseFreezeDisabled === false && isNone(mint.freezeAuthority))
      push("info", "freeze_flag_mismatch",
        "Meteora reports base-token freeze authority NOT disabled, but RPC shows it renounced — verify.", "Meteora");

    // ---- Pool economics: REALIZED fee yield + reserve balance (automated) ----
    // Fail-closed: a pool we can't size (no TVL) can't be cleared on depth — withhold GO.
    // A check that didn't run is "not verified," not "safe" (consistent with the evidence
    // gate). The real fixtures carry TVL, so legitimate pools are unaffected.
    if (pool.tvl == null)
      push("soft", "pool_economics_unavailable",
        "Pool economics (TVL / depth / fees) could not be assessed — withholding GO; the pool's depth and fee realism are unverified.", "Meteora");
    // The real measured yield (24h fees ÷ TVL), not an advertised APR. An implausibly
    // high realized yield is the canonical wash-trade / unsustainable-APR signal for an
    // LP — the headline number won't be realizable and IL will dominate.
    if (pool.tvl != null && pool.tvl > 0 && pool.fees24h != null) {
      const aprPct = (pool.fees24h / pool.tvl) * 365 * 100;
      push("info", "fee_yield",
        `Measured fee yield: ~${aprPct.toFixed(0)}% APR (24h fees ÷ TVL — the realized rate, not an advertised number).`, "Meteora");
      if (aprPct > TH.feeAprUnrealisticPct)
        push("soft", "fee_apr_unrealistic",
          `Realized fee APR ~${aprPct.toFixed(0)}% is implausibly high — likely transient or wash-traded volume; the advertised yield is unlikely to be realizable and IL can dominate.`, "Meteora");
    }
    // Reserve VALUE balance — how one-sided the pool is (info; DLMM can be legitimately
    // one-sided at a range edge, so this is a heads-up, not a verdict driver).
    if (pool.baseValuePct != null && Number.isFinite(pool.baseValuePct)) {
      const b = pool.baseValuePct, q = 100 - b;
      push("info", "pool_balance",
        `Pool balance by value: ${b.toFixed(0)}% base / ${q.toFixed(0)}% quote.${Math.min(b, q) < TH.lopsidedMinSidePct ? " Extremely one-sided — you'd provide mostly one asset and face worse exit slippage." : ""}`, "Meteora");
    }
  }

  // ---- RugCheck corroborating risks (soft, de-duped) -----------------------
  if (Array.isArray(rugcheck?.risks)) {
    for (const r of rugcheck.risks.slice(0, 8)) {
      const name = String(r?.name ?? "").toLowerCase();
      // Skip ones we assess more accurately on-chain: authorities (RPC) and
      // holder concentration (on-chain, pool/lock-aware — RugCheck counts pools).
      if (/authority|holder|concentration/.test(name)) continue;
      // Trusted blue-chips: corroborating RugCheck risks are residual, not a block.
      push(trusted ? "info" : "soft", "rugcheck_flag",
        `RugCheck: ${r.name}${r.description ? ` — ${r.description}` : ""}`, "RugCheck");
    }
  }

  // ---- Evidence-completeness gate (fail-CLOSED) ----------------------------
  // A GO must mean "the checks ran and found nothing disqualifying," NOT "the
  // checks couldn't run." (Authorities + Token-2022 come from RPC, which is always
  // present here — if RPC were down, analyze() would have thrown.)
  //   • Holder concentration is WAIVED only for the canonical blue-chip allowlist (a
  //     stablecoin's custodial concentration is by-design). A third-party `trusted_token`
  //     does NOT waive it — so a MISSING concentration source for such a token can't be
  //     read as "safe"; gate it unless the token is blue-chip-allowlisted.
  //   • RugCheck covers rugged/blacklist, which NO trust tier relaxes — so a third-party
  //     `trusted_token` bit alone must NOT exempt it. Only the canonical blue-chip
  //     allowlist (un-spoofable) is exempt from the RugCheck-missing gate; a third-party-
  //     trusted token with RugCheck down still caps at CAUTION (can't confirm not-rugged
  //     on one external flag).
  const missing: string[] = [];
  if (!rugcheck && !authorityAllowlisted)
    missing.push("RugCheck (rugged/blacklist — never trust-relaxed)");
  if (conc == null && !authorityAllowlisted)
    missing.push("holder concentration (top-holder %)");
  if (missing.length)
    push("soft", "incomplete_evidence",
      `Incomplete evidence — could not run: ${missing.join("; ")}. Capped at CAUTION: a check that did not run is "not verified," not "safe."`,
      "skill");

  // ---- IL reminder (info) --------------------------------------------------
  push("info", "il_volatility",
    "Impermanent loss is range-blind and IL-blind APR can mislead — size accordingly and prefer wider ranges on volatile pairs.", "skill");

  return f;
}

function concentration(goplus: any): { top1: number; top10: number } | null {
  const holders = goplus?.holders;
  if (!Array.isArray(holders) || holders.length === 0) return null;
  const pcts = holders
    .filter((h: any) => !h.tag && h.is_locked != 1 && h.is_locked !== "1")
    .map((h: any) => parseFloat(h.percent) * 100)
    .filter((n: number) => Number.isFinite(n))
    .sort((a: number, b: number) => b - a);
  if (pcts.length === 0) return null;
  return {
    top1: pcts[0],
    top10: pcts.slice(0, 10).reduce((s: number, n: number) => s + n, 0),
  };
}

// RugCheck labels each big holder (CREATOR / LOCKER:Streamflow Vault / AMM:<venue>
// / CEX / ...). We already fetch knownAccounts — use it to name the flagged whale
// and break the big-holder supply into named buckets, instead of one opaque
// "X% excluded" number. Read-only enrichment; never changes the verdict.
interface HolderLabels {
  composition: { label: string; pct: number }[];
  labelOf: (addr: string | undefined) => string | undefined;
}
function holderLabels(rugcheck: any): HolderLabels | null {
  const known = rugcheck?.knownAccounts;
  const tops = rugcheck?.topHolders;
  if (!known || typeof known !== "object" || !Array.isArray(tops) || !tops.length) return null;
  const info = (addr: string | undefined): any => (addr ? known[addr] : undefined);
  const bucket = (i: any): string => {
    const t = String(i?.type ?? "").toUpperCase();
    const n = String(i?.name ?? "");
    if (t === "LOCKER") return /stream/i.test(n) ? "Streamflow-locked" : `locked (${n || "locker"})`;
    if (t === "AMM") return "AMM liquidity";
    if (t === "CREATOR") return "creator-held";
    if (t === "CEX") return "CEX (custodial)";
    if (t === "BURN" || /burn|incinerat/i.test(n)) return "burned";
    return t ? t.toLowerCase() : "contract";
  };
  const byBucket = new Map<string, number>();
  for (const h of tops) {
    const i = info(h?.address) ?? info(h?.owner);
    const pct = Number(h?.pct);
    if (!i || !Number.isFinite(pct)) continue;
    byBucket.set(bucket(i), (byBucket.get(bucket(i)) ?? 0) + pct);
  }
  return {
    composition: [...byBucket.entries()]
      .map(([label, pct]) => ({ label, pct }))
      .sort((a, b) => b.pct - a.pct),
    labelOf: (addr) => {
      if (!addr) return undefined;
      // top1Owner is an on-chain owner wallet; RugCheck may key knownAccounts by
      // the token-account instead — fall back to the matching topHolders entry.
      let i = known[addr];
      if (!i) {
        const h = tops.find((x: any) => x?.owner === addr);
        if (h) i = known[h.address] ?? known[h.owner];
      }
      if (!i) return undefined;
      const t = String(i.type ?? "").toUpperCase();
      if (t === "CREATOR") return "the creator wallet";
      if (t === "CEX") return "a known CEX (custodial) wallet — not a single whale";
      if (t === "LOCKER") return /stream/i.test(String(i.name)) ? "a Streamflow lock" : "a locker";
      if (t === "AMM") return "an AMM pool";
      return i.name ? String(i.name) : t.toLowerCase();
    },
  };
}

export function verdictFrom(findings: Finding[]): Verdict {
  if (findings.some((x) => x.severity === "hard")) return "NO-GO";
  if (findings.some((x) => x.severity === "soft")) return "CAUTION";
  return "GO";
}
