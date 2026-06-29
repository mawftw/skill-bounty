---
name: solana-lp-safety
description: Pre-LP due-diligence for Solana liquidity providers (Meteora DLMM / DAMM v2, generalizes to Raydium/Orca AMMs). Answers "is it safe to PROVIDE LIQUIDITY to this pool/token, and can I get it back out?" — distinct from buyer-side rug-checking. Inspects mint/freeze authority and Token-2022 seize/exit risks (transfer hook, transfer fee, permanent delegate, pausable, mint-close, non-transferable), LP-lock and pool TVL, mutable metadata, and pool/lock-aware holder concentration; it also reasons about pool depth, fee-APR realism, and impermanent-loss exposure as guidance. Aggregates Solana RPC, RugCheck, GoPlus, Helius DAS, and Meteora API into a composite GO / CAUTION / NO-GO verdict with an LP-specific red-flags checklist. Use before opening, adding to, or rebalancing a liquidity position.
user-invocable: true
---

# Solana LP Safety Skill

> Pre-LP due-diligence for liquidity providers. Not "should I **buy** this token?" — **"should I put liquidity into this pool, and can I get it back out?"**

## What This Skill Is For

Use this skill when the user is about to **provide, add to, or rebalance liquidity** on a Solana AMM — primarily **Meteora DLMM / DAMM v2** (automated pool resolution is Meteora-only; the token-level checks are AMM-agnostic, so for a Raydium/Orca token pass its mint) — and wants a risk read before committing capital.

Trigger phrases:
- "Is it safe to LP into this pool?"
- "Check this Meteora pool before I add liquidity."
- "Run due-diligence on `<mint>` / `<pool>` for LPing."
- "Should I open a position in this DLMM pair?"
- "What's the rug risk if I provide liquidity here?"

### When NOT to use this skill
- **Buyer-side rug-check / "should I ape this memecoin?"** — the checks overlap, but this skill's verdict is weighted for a *liquidity provider* (committed in a price range, cannot exit instantly), not a spot holder. For pure buy-side analysis use a token-forensics skill.
- **Smart-contract / program source audit** — this skill inspects on-chain token & pool **state**, not program logic. Use a code-audit skill for that.

## Why LP Risk ≠ Buyer Risk (the core idea)

A buyer can sell the instant something looks wrong. A liquidity provider **cannot** — your capital is locked into a price range as two assets, and several attacks hit LPs specifically:

| Risk | Why it matters MORE to an LP than to a buyer |
| --- | --- |
| **Freeze authority live** | Your LP token / position account can be frozen — capital trapped, no exit. |
| **LP not locked/burned** | If the *creator's* base liquidity isn't locked/burned, they can pull it; your impermanent loss becomes total loss. |
| **Mint authority live** | Unlimited new supply dilutes the pool and tanks the side you're holding. |
| **Transfer hook (Token-2022)** | An active hook can block AMM transfers — you may not be able to add or remove liquidity. |
| **Transfer fee (Token-2022)** | Silently skims every swap/withdraw — quietly eats your LP yield and principal. |
| **Permanent delegate (Token-2022)** | Holder can seize tokens from any account, including the pool/your position. |
| **Thin TVL / lopsided bins** | Advertised fee APR may be wash-traded or unrealizable; exit slippage can be brutal. |
| **Impermanent loss profile** | High-volatility / reflexive tokens punish range LPs even with no malice. |

## Operating Procedure

> The topic files referenced below (bare names like `scoring.md`) sit alongside this `SKILL.md` in the skill directory; `rules/` is a subdirectory. Run the bundled CLI through `${CLAUDE_SKILL_DIR}` (see the CLI section) so it resolves wherever the skill is installed.

1. **Resolve the target.** Accept a **Meteora pool** address or a token mint. A pool address is resolved and identity-bound **on-chain** (Meteora **DLMM / DAMM v2** only): both mints + the AMM are decoded from the account and matched against the API. A bare **mint** is analyzed at the **token level** — there is no automatic pool lookup. For a Raydium/Orca position, pass the token mint and run the AMM-agnostic token checks (pool resolution there is manual / out of scope). → `data-sources.md`
2. **Run the risk dimensions** (load only the files you need — progressive disclosure):

   | Sub-question | Load |
   | --- | --- |
   | Mint / freeze / update authority, metadata & impersonation | `token-authorities.md` |
   | LP lock/burn, TVL, depth, bin distribution, fee-APR realism | `lp-pool-health.md` |
   | Top-holder concentration, bundle / insider / sniper clustering | `holder-concentration.md` |
   | Token-2022 extensions that break or drain LP positions | `token-2022-lp-risks.md` |
   | Volatility / reflexivity / impermanent-loss exposure | `impermanent-loss-risk.md` |
   | Which API to call, keys, fallbacks, rate limits | `data-sources.md` |

3. **Aggregate into a verdict.** Apply the hard-fail and soft-flag rules → **GO / CAUTION / NO-GO**. → `scoring.md`
4. **Report** the verdict + the LP-specific red-flags checklist (see Output Format).

## Verdict Model (summary — full rules in `scoring.md`)

- **NO-GO** — any single hard fail, e.g.: freeze authority live · mint authority live · active transfer hook · permanent delegate · pausable/non-transferable · live transfer-fee authority · rugged/blacklisted. (Creator-majority-unlocked LP is *agent guidance*, **not** an automated hard fail; DLMM creator-lock is "not assessed" — see `scoring.md`.)
- **CAUTION** — no hard fail, but one or more soft flags the engine scores: holder concentration · thin TVL · fixed transfer fee · mutable metadata · mint-close authority · latent transfer hook · DAMM lock < 50% · malformed authority / unrecognized extension / incomplete evidence (fail-closed). *(Bundle patterns and IL profile are agent guidance, not engine-scored.)*
- **GO** — no hard fails, soft flags within tolerance.

> **Known-good override (tiered, classic authorities only):** a live mint/freeze authority counts as issuer-by-design only via an explicit trust signal — *not* a generic RugCheck/Jupiter "verified" listing, which is intentionally ignored. The **canonical blue-chip allowlist** (USDC/USDT/wSOL) downgrades it to a residual note → GO; a third-party GoPlus `trusted_token` flag *alone* is weaker and only caps the verdict at **CAUTION** (one external bit can't clear a live authority or a real holder concentration). Neither ever relaxes a Token-2022 seize power or a rugged/blacklist flag. See `scoring.md`.

> A GO is **never** financial advice — it means "no disqualifying on-chain red flags found for an LP," not "this will be profitable." Always state residual risks.

## Output Format

```
LP SAFETY: <GO | CAUTION | NO-GO>   (pool: <addr>  pair: <A>/<B>  amm: <Meteora DLMM>)

Hard checks
  [✓/✗] Freeze authority renounced
  [✓/✗] Mint authority renounced
  [✓/✗] No active transfer hook / permanent delegate / pausable / non-transferable
  [✓/✗] No live transfer-fee authority (fee can't be ramped toward ~100%)
  [✓/✗] Not flagged rugged / blacklisted
  [ i ] LP lock: DAMM v2 permanent-lock __% (DLMM = individually owned, not assessed)
Soft checks
  [✓/⚠] Holder concentration (top10: __%, pool/lock-aware)
  [✓/⚠] Pool TVL / thin-pool (__)
  [✓/⚠] Transfer fee (__%)
  [✓/⚠] Update authority renounced / metadata immutable
  [✓/⚠] IL / volatility profile

🚩 Red flags: <bullet list, most severe first>
ℹ️  Residual risks even on GO: <bullet list; note any known-good override applied>
Sources: <which APIs answered, which were unavailable>
```

## Data Sources & Keys

Multi-source by design — never trust a single oracle. Keyless (RugCheck public, public RPC, GoPlus, Meteora API) covers most checks; **Helius** (DAS) adds the holder count. (**Solana Tracker** is an optional, not-yet-wired enrichment.) Never hardcode keys → `rules/api-key-safety.md`. Full source matrix, endpoints, and fallbacks → `data-sources.md`.

## CLI

A runnable companion script produces the verdict programmatically. When the skill is installed,
invoke the bundled CLI through `${CLAUDE_SKILL_DIR}` so it resolves from any working directory:

```bash
"${CLAUDE_SKILL_DIR}/node_modules/.bin/tsx" "${CLAUDE_SKILL_DIR}/scripts/safety-check.ts" <POOL_OR_MINT_ADDRESS>
```

(Developing from the cloned repo instead? Use `npm run safety-check -- <POOL_OR_MINT_ADDRESS>`.)
The implementation is `scripts/safety-check.ts`; the `/lp-safety-check` slash command wraps the same CLI.
