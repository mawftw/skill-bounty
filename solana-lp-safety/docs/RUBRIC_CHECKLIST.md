# Rubric checklist — claim → evidence → one command

An index, not a pitch. Every claim below points to the file that backs it and the single
command that reproduces it. Judging axes: **Usefulness · Novelty · Quality · Fit.**

## Reproduce everything (~60s, mostly offline)

```bash
git clone https://github.com/mawftw/solana-lp-safety-skill.git
cd solana-lp-safety-skill && npm ci

npm run validate     # OFFLINE gate: typecheck · 88 unit + 19 integration + hard-fail recall ·
                     #               signature demo · secret/.env scan · zero runtime deps
npm run demo         # OFFLINE: the four signature cases (real captures, fetch disabled)
npm run eval         # LIVE: with-skill vs authority-only baseline over real mainnet mints
npm run pre-submit   # PUSH-READINESS: clean tree · mawftw identity · origin · validate/smoke/audit
```

`validate` and `demo` need **no network and no key**. Only `eval` (live mainnet) does.
`pre-submit` is intentionally stricter: it fails until the public `origin` remote is configured.

---

## Usefulness — *does it solve a real LP problem?*

| Claim | Evidence | One command |
|---|---|---|
| Returns a composite GO / CAUTION / NO-GO LP verdict with an LP-specific red-flags checklist | `scripts/safety-check.ts`, `scripts/lib/report.ts` | `npm run safety-check -- <POOL_OR_MINT>` |
| Resolves a **real Meteora pool** end-to-end (base/quote split, TVL, DLMM lock honesty, holder exclusions) | `scripts/lib/sources.ts` (`resolveTarget`), demo case 1 | `npm run demo` |
| Measurably beats the naive authority-only rug-check, with zero live under-warning | `docs/EVAL.md`, `tests/eval.ts` | `npm run eval` |
| Runs keyless; degrades gracefully when a source is down | `scripts/lib/analyze.ts`, `goplus-unavailable-go` / `rugcheck-unavailable-caution` fixtures | `npm test` |

## Novelty — *what does nothing else do?*

| Claim | Evidence | One command |
|---|---|---|
| **LP-entry** framing — "can I get liquidity back out?", distinct from buyer-side rug-checking and from position managers | `README.md` "Where it fits", `skill/SKILL.md` | read |
| **Signature call:** a trusted issuer is still a hard NO-GO if it carries a Token-2022 seize power (PYUSD) | demo case 2; `scripts/lib/score.ts` (`isKnownGood` + never-relaxed Token-2022 hard fails) | `npm run demo` |
| **Trust never relaxes a seize power** — proven for every hard-fail branch, trusted and untrusted | `tests/score.test.ts` (`UNCONDITIONAL_HARD_FAILS`) | `npm run test:unit` |
| **Pool/lock-aware concentration** — labels & excludes locker/AMM supply, names the real free-floating whale | demo cases 3–4; `scripts/lib/score.ts` (`holderLabels`) | `npm run demo` |

## Quality — *is it correct, deterministic, and safe?*

| Claim | Evidence | One command |
|---|---|---|
| Deterministic **offline** correctness — 88 unit + 19 integration, fetch disabled | `tests/score.test.ts`, `tests/integration.test.ts` | `npm test` |
| **Hard-fail recall 15/15, 0 false GO, 12/12 schema-drift cases held closed** vs baseline 3/15 + 12 false GO + 0/12 held (confusion matrix) | `tests/hardfail-eval.ts` | `npm run eval:hardfail` |
| **Fail-closed engine** — malformed authority, unknown extension, **malformed state *inside* a known extension**, and unassessable/incomplete quote all withhold GO | `scripts/lib/score.ts` (`fieldState`, `extFieldState`, `KNOWN_EXTENSIONS`), `scripts/lib/analyze.ts` (`QUOTE_KEEP_SOFT`) | `npm test` |
| **Green CI** + a reproducible offline gate anyone can run | `.github/workflows/validate.yml`, `scripts/validate.sh` | `npm run validate` |
| **Zero runtime dependencies**; read-only, no wallet/private-key access; no committed secrets | `package.json` (`dependencies: {}`), `rules/api-key-safety.md`, secret scan in `validate.sh` | `npm run validate` |
| Honest **ablation** baseline — a floor on value-add, not a competitive benchmark (shares the skill's parsed inputs; has no `CAUTION`, Token-2022, trust, or concentration logic) | `scripts/lib/baseline.ts`, `docs/EVAL.md` | `npm run eval` |

## Fit — *is it a real Agent Skill, well-scoped?*

| Claim | Evidence | One command |
|---|---|---|
| Progressive disclosure — lean `SKILL.md` + load-on-demand topic files | `skill/SKILL.md`, `skill/*.md` | read |
| Trigger description + explicit **when NOT to use** (near-miss discipline) | `skill/SKILL.md` frontmatter + "When NOT to use" | read |
| **Working** `/lp-safety-check` slash command (runs the CLI, renders the verdict) | `commands/lp-safety-check.md` | `/lp-safety-check <addr>` |
| Honest scope — implemented vs agent-guided vs planned, no overclaiming | `README.md` status note, `skill/scoring.md` | read |

---

## Red-team Q&A (the questions a skeptical judge asks)

1. **Why this over RugCheck?** RugCheck answers the *buyer's* question; this weights the verdict for an *LP* who is range-locked and can't exit instantly (seize/exit/dilution risk). → `README.md`, `skill/SKILL.md`.
2. **Is it just an API wrapper?** No — the value is the *decision semantics*: the same on-chain fact read for LP exit risk (trusted-issuer waiver, seize-power override, locker/AMM exclusion, both-sides pool check, fail-closed on schema drift). RugCheck/GoPlus/Meteora are **inputs we compose**, not competing verdicts — so "compare it to RugCheck" is category-confused; the eval baseline is an *ablation of our own pipeline*, not a rival product. → `scripts/lib/score.ts`, `npm run demo`.
3. **Why is USDC GO but PYUSD NO-GO?** USDC's freeze authority is issuer-by-design (trusted) → residual; PYUSD's Token-2022 permanent delegate can seize pooled tokens → hard block, trust notwithstanding. → `npm run eval:hardfail`, demo case 2.
4. **What if a "verified" token holds a dangerous authority?** "Verified" never confers authority trust — only GoPlus `trusted_token` / the blue-chip allowlist does; a verified-but-untrusted live authority → NO-GO. → `tests/score.test.ts` (P0.0 guard).
5. **Is the verdict reliable when RugCheck/GoPlus is down?** Fail-closed: an untrusted token missing a critical check caps at CAUTION, never GO. → `rugcheck-unavailable-caution` fixture, `npm test`.
6. **How do you know it doesn't produce a false GO?** The hard-fail eval drives every disqualifying capability **and** adversarial schema-drift variant through the engine and gates on **0 false GO across that evaluated surface** — including the RPC parse boundary (`parseMint` marks a missing authority field malformed, not "renounced"). It's a strong fail-closed guarantee on the tested surface, not a universal proof. → `npm run eval:hardfail`, `tests/score.test.ts` (parse-boundary cases).
7. **Did the eval labels come from the tool's own output?** No — labels are independent (blue-chip status, documented PYUSD seize power, on-chain concentration facts). → `docs/EVAL.md`.
8. **What can I verify with no internet?** typecheck, 80+ deterministic checks, the signature demo, the secret scan — all of `npm run validate`. → `scripts/validate.sh`.
9. **Does the code touch a wallet or private key?** No — read-only RPC/REST; keys (if any) are env-only and never logged. → `rules/api-key-safety.md`, secret scan.
10. **What's still work-in-progress?** DLMM creator-position lock, bin-level depth / exit-slippage, IL scoring, bundle/insider clustering — labeled agent-guidance, not claimed as automated. → `README.md` status note.
