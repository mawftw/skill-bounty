# Scoring: GO / CAUTION / NO-GO

Combine all dimensions into one verdict. **Hard fails dominate** (any one → NO-GO); soft flags
accumulate into CAUTION. Thresholds below are **public defaults** — sensible, not aggressive. (Rake
tunes its own private thresholds; this skill ships the commodity baseline.)

## Hard fails — any ONE → NO-GO (for an untrusted token)

| Check | Source |
| --- | --- |
| Freeze authority live (`freezeAuthority != null`) | RPC / `freeze_authority_disabled == false` |
| Mint authority live (`mintAuthority != null`) | RPC |
| Token-2022 `permanentDelegate.delegate != null` | RPC extensions |
| Token-2022 active `transferHook.programId != null` | RPC extensions |
| Token-2022 `pausableConfig.authority != null` (or `paused == true`) | RPC extensions |
| Token-2022 `nonTransferable` present | RPC extensions |
| `transferFeeConfig` with live `transferFeeConfigAuthority` (can → 100%) | RPC extensions |
| `rugged == true` or `is_blacklisted == true` | RugCheck / Meteora |

> **Automated vs guidance.** The CLI engine automates every hard fail above. The
> **creator-majority-unlocked-LP** rule is *agent-assessed guidance — **not yet a CLI hard fail***:
> the engine emits a **soft** flag when DAMM v2 permanent-lock is < 50%, and reports DLMM
> creator-lock as **"not assessed"** (DLMM positions are individually owned, so there is no single
> creator-lock to read). Do **not** read a `GO` as "the creator can't pull DLMM liquidity."

> **Known-good override (TIERED, so one external bit can't clear a live authority):**
> - **Canonical blue-chip allowlist** (USDC/USDT/wSOL) — a hardcoded, un-spoofable list. A live
>   freeze/mint authority on these is genuinely by-design → downgraded to an **info residual** (GO ok).
> - **Third-party `trusted_token` only** (a single GoPlus bit, token not on the allowlist) — relaxes
>   the *softer* by-design signals (**holder-concentration**, **mutable-metadata**, corroborating
>   RugCheck risks) to residual, BUT a live mint/freeze authority is downgraded only to a **soft flag
>   → the verdict caps at CAUTION, never GO**. One external classification can't clear a live authority.
> - A broad RugCheck/Jupiter `verification` flag is **not** trust at all — "verified" means a listing +
>   socials, so a verified-but-untrusted token with a live authority still hard-fails to NO-GO.
>
> Hard Token-2022 seize powers (permanent delegate, pausable, live transfer-fee authority, active hook,
> non-transferable) and rugged/blacklist are **never** relaxed by any trust tier.
>
> *Limitation (by design):* trust is still a single external bit, so a stale/compromised allowlist or
> `trusted_token` entry could relax the *soft* by-design signals above. It is deliberately bounded — it
> never reaches a hard seize/rugged/blacklist flag, and third-party trust alone can't even clear a live
> classic authority (caps at CAUTION) — and its **provenance is surfaced** in the output (`trust_basis`)
> so a reviewer sees exactly which signal fired and what it relaxed.

## Soft flags — accumulate → CAUTION

| Check | Default threshold |
| --- | --- |
| Holder concentration | single non-pool holder > ~10%, or top-10 (filtered) > ~25–30% |
| Bundle / insider supply at launch | > ~20–30%, or RugCheck `insider` clusters present |
| Thin TVL | < ~$25k, or `tvl` backed by one/lopsided bin spike |
| Fragile liquidity distribution | single-bin / one-sided around active bin |
| Wash-trade / unrealistic fee-APR **(automated)** | realized yield = 24h fees ÷ TVL; annualized > ~1000% APR ⇒ implausible/transient |
| Transfer fee (fixed/renounced) **(automated)** | **effective** rate across *both* fee schedules; > 0 = soft, **≥ 50% = hard exit-drain** |
| Update authority live / mutable metadata | `isMutable == true` |
| `mintCloseAuthority` live | reinit vector |
| Latent transfer hook | `transferHook.programId` null but `authority` live (a hook can be added later) |
| Fragile liquidity distribution / IL profile | single-bin / one-sided, volatile pair — *bin-level depth is agent guidance; reserve-value balance is reported as info* |
| High IL / volatility profile | volatile/volatile pair, tight range, reflexive low-cap *(agent guidance)* |

> **Automated vs guidance (soft flags).** The engine **computes**: holder concentration (pool/lock-aware),
> thin TVL, **effective transfer fee** (+ exit-drain hard escalation), **realized fee-APR wash-trade flag**,
> **reserve-value balance** (info), mutable metadata, mint-close, latent hook, DAMM lock, and the
> malformed/unknown/incomplete fail-closed flags. **Agent guidance (not engine-scored):** bundle/insider
> clustering, bin-level depth / exit-slippage, and IL/volatility sizing.

## Verdict

- **NO-GO** — ≥ 1 hard fail.
- **CAUTION** — 0 hard fails, ≥ 1 soft flag (report each; let the user size accordingly).
- **GO** — 0 hard fails, soft flags within tolerance.

## Evidence completeness & pool scope (fail-closed)

- **A GO requires that the checks actually ran.** For an *untrusted* token, if a critical
  risk check could not be performed — RugCheck (rugged/blacklist) **or** holder
  concentration unavailable — the verdict is capped at **CAUTION**, never GO. A check that
  did not run is "not verified," not "safe." (Trusted blue-chips are exempt: their
  concentration/risk flags are by-design residual, so a missing source can't move their
  verdict.)
- **Malformed or unknown data withholds GO.** An authority field that can't be decoded (wrong
  type / not a plausible address), a Token-2022 extension the engine does not recognize, **or
  malformed/missing state *inside* a recognized extension** (e.g. a `permanentDelegate` with no
  decodable `delegate`, a `pausableConfig` with a non-boolean `paused`, a `transferFeeConfig`
  missing its authority field) is treated as **unverified** — a soft flag that caps at CAUTION,
  never read as "safe." Fail-closed against schema drift *between* and *within* extensions, and
  against novel capabilities.
- **Both pool sides are checked, fail-closed.** An LP is exposed to *both* tokens in a pool —
  either one freezing, seizing, or rugging traps the position. A hard fail on the **quote** side
  (live authority, Token-2022 seize power, rugged) is a NO-GO exactly like the base side; and the
  quote side's **fail-closed soft flags** (malformed authority/extension-state, **incomplete
  evidence**) are preserved into the pool verdict too — so an untrusted quote the engine couldn't
  fully verify caps the pool at CAUTION, never a false GO. A trusted/blue-chip quote (USDC/USDT/wSOL)
  is waived the same way the base side is.

## Source disagreement

If RPC/SDK (authoritative) and an aggregator disagree, **trust RPC/SDK and flag the disagreement** —
never silently pick the friendlier answer.

## Mandatory disclaimer on every verdict

> A **GO** means "no disqualifying on-chain red flags found for an LP" — **not** financial advice and
> **not** a profitability guarantee (fee APR is IL-blind and range-blind). Always list residual
> risks, including any known-good overrides applied and any data sources that were unavailable.
