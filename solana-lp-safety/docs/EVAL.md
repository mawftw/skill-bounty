# Evaluation

> **Latest observed live run: with-skill 10/11 exact and 11/11 no-under-warning ·
> authority-only baseline 6/11 exact and 8/11 no-under-warning** (checked 2026-06-29), over a
> labeled set of real mainnet mints. A previous run on 2026-06-27 returned **11/11 exact**.
> Reproduce: `npm run eval` — the CI gate asserts the skill **beats** the baseline and never
> under-warns on this live set (exact counts can drift with live chain state; see Scope).

This skill makes a GO / CAUTION / NO-GO call on whether it's safe to *provide liquidity* to a
Solana token/pool. This eval measures whether that call is right — and how much it improves on
the common naive approach.

## Method

For each fixture we run the full pipeline (`analyze()` — the same code the CLI runs) and compare
its verdict to an independent ground-truth label. Alongside it we score an **authority-only
ablation floor**: an *authority-only rug-check* — live mint **or** freeze authority ⇒ `NO-GO`, else
`GO`. That's what a basic tool, or a non-expert agent, does. It has no Token-2022 seize detection, no
holder-concentration check, no LP-lock awareness, and no trusted-token allowlist. It runs on the
**same input data** as the skill — an **ablation floor**, **not** a strawman. *Caveat:* the baseline has no
`CAUTION` state, so by construction it can't win the concentration cases — that's the point (it is
*blind* to concentration). Read the comparison as a floor on the value-add, not a tournament.

**Labels are independent of the tool under test:**

- Blue-chips (`USDC`, `USDT`, `wSOL`) are expected `GO` at the **token level** — their live
  authorities are issuer-by-design, not rug vectors. (Pool-specific LP checks — lock, TVL, depth,
  both-sides — still require a pool address; this mint-only eval scores the token-layer call.)
- `PYUSD` carries a **Token-2022 permanent delegate** (a documented seize power) ⇒ `NO-GO`.
- The `legit-*` tokens are confirmed legitimate utility tokens with renounced authorities, no seize
  power, and no single >10% known free-floating wallet ⇒ `GO`.
- The `conc-*` tokens each have **one real (unlabeled) wallet holding >10%** of supply (an on-chain
  fact) ⇒ `CAUTION` (a concentration heads-up for an LP).

## Results

| token   | expected | authority-only baseline | with-skill |
|---------|----------|-------------------------|------------|
| USDC    | GO       | NO-GO ✗                 | GO ✓       |
| USDT    | GO       | NO-GO ✗                 | GO ✓       |
| wSOL    | GO       | GO ✓                    | GO ✓       |
| legit-A | GO       | GO ✓                    | CAUTION ✗  |
| legit-B | GO       | GO ✓                    | GO ✓       |
| legit-C | GO       | GO ✓                    | GO ✓       |
| legit-D | GO       | GO ✓                    | GO ✓       |
| conc-A  | CAUTION  | GO ✗                    | CAUTION ✓  |
| conc-B  | CAUTION  | GO ✗                    | CAUTION ✓  |
| conc-C  | CAUTION  | GO ✗                    | CAUTION ✓  |
| PYUSD   | NO-GO    | NO-GO ✓                 | NO-GO ✓    |
| **TOTAL exact** |  | **6 / 11** | **10 / 11** |
| **NO under-warning** |  | **8 / 11** | **11 / 11** |

`legit-A` is the current live drift case: the token's authorities and Token-2022 seize surface are
clean, but a single 10%+ holder is excluded from concentration only by a third-party RugCheck
lock/AMM label. The engine deliberately caps that case at `CAUTION` until the lock is independently
verified on-chain (`unverified_label_exclusion`). That is a conservative no-GO-withheld outcome,
not a false GO.

## Where the baseline fails (the measured value-add)

- **False `NO-GO` on blue-chips** (`USDC`, `USDT`): the baseline sees a live freeze authority and
  blocks — it can't tell Circle's by-design control from a scam's. The skill's trusted-token
  awareness keeps them `GO`.
- **Missed concentration** (`conc-A/B/C`): renounced authorities ⇒ the baseline says `GO`, blind to
  a 10–32% wallet that can dump on the LP. The skill flags it `CAUTION` — and it's pool/lock-aware,
  counting only the free-floating whale while excluding liquidity and locked (e.g. Streamflow)
  supply.
- *Ties:* the baseline is right on `wSOL`, three unchanged legit tokens, and `PYUSD` — the last for the
  wrong reason (it catches PYUSD's live authority, not the permanent delegate the skill flags).
- *Conservative drift:* `legit-A` is expected `GO`, but the skill currently returns `CAUTION`
  because a material holder is excluded only by a third-party lock/AMM label. This avoids allowing
  a label-only exclusion to buy a GO.
- **No under-warning:** treating verdicts by severity (`GO < CAUTION < NO-GO`), the skill is
  **11/11** on this live set: every non-GO label is held at least as severe as expected, and the
  only exact miss is a stricter-than-label CAUTION.

## Scope & limitations

- **Live, not frozen.** This eval runs against mainnet at run time, so exact percentages and
  third-party holder labels move with chain state; the ground-truth labels do not. The gate
  intentionally checks robust invariants: exact match must beat the baseline, and the skill must
  have zero under-warnings on the live set. A **deterministic, offline** companion now exists —
  `npm test` replays 19 sanitized GO / CAUTION / NO-GO / error captures (incl. real DLMM and DAMM
  v2 pools, and pool-identity / pair-substitution attacks) with no network or key (see
  [`tests/fixtures/README.md`](../tests/fixtures/README.md)). Folding this full 11-mint set into
  frozen fixtures is the remaining follow-up.
- **Small, hand-labeled *live* set** (11 mints, one `NO-GO`) — a directional correctness check on
  real chain state, not a statistical benchmark. The `NO-GO` / Token-2022 surface that real GO/CAUTION
  mints don't exhibit is covered separately and deterministically by the **hard-fail recall eval**
  (`npm run eval:hardfail`): 15 disqualifying capabilities + 12 adversarial schema-drift variants,
  **15/15 recall, 0 false GO, 12/12 drift cases held closed** vs the baseline's 3/15 + 12 false GO +
  0/12 held, with a confusion matrix. The RPC parse boundary is covered too (`parseMint` marks a
  missing authority field malformed, not "renounced") — see `tests/score.test.ts`. Broadening the
  live set with independent rug datasets is future work.
- **Holder-exclusion trust model.** Supply is excluded from concentration by two paths: (a) an
  **on-chain program allowlist** — an account is dropped when its authority's owning program is a
  vetted AMM/locker (Meteora/Raydium/Orca/pump/Streamflow/Jupiter Lock) or it is a burn; and (b)
  **RugCheck `LOCKER/AMM/BURN` labels**, which catch lockers held via indirection the program
  heuristic alone misses (e.g. Token-2022 escrows). A stale/compromised Meteora REST
  `reserve_*/vault_*` field is **not** trusted to exclude an account. **Safeguard against a
  forged/incorrect label:** if a single holder of **≥10%** is dropped *solely* on an unverified
  RugCheck label, the verdict is **capped at CAUTION** (`unverified_label_exclusion`) — a label can
  never, on its own, buy a GO for a materially concentrated position. An **unrecognized** program
  escrow is always **counted** as concentration, never assumed locked. So across both paths the
  failure mode is a conservative CAUTION, not a false GO. Decoding each lock's on-chain state (e.g.
  Streamflow vesting/cancellation, to clear the CAUTION) is roadmap.
- The baseline is one naive approach (authority-only); other baselines would fail differently. It
  is an **ablation of this skill's own pipeline**, not a competing product — and deliberately so:
  RugCheck, GoPlus, Helius, and the Meteora API are **inputs the skill composes**, not rival
  verdicts, so "skill vs RugCheck" is category-confused. The ablation isolates *what the LP-specific
  aggregation logic adds* on top of the raw signals.
- **Label provenance.** Every ground-truth label is a public, tool-independent fact: blue-chip
  status (USDC/USDT/wSOL), PYUSD's documented Token-2022 permanent delegate (a published seize
  power), and on-chain holder concentration read directly from `getTokenLargestAccounts`. No label
  is derived from the skill's own output. The `legit-*` tokens are operator-confirmed legitimate
  utility tokens with renounced authorities and no single >10% known free-floating wallet; if a
  material holder can only be excluded by an unverified third-party lock/AMM label, the live engine
  caps the verdict at `CAUTION` until that lock is independently verified.
- **Adversarial coverage is separate and deterministic.** Because real GO/CAUTION mints don't carry
  seize powers or malformed state, the disqualifying surface is covered by `npm run eval:hardfail`
  (synthetic states authored to probe *every* hard-fail branch **and** schema-drift inside known
  extensions) — branch + adversarial coverage, not a real-world prevalence estimate.

## Reproduce

```bash
npm run eval        # runs analyze() + the baseline over the fixtures, prints the scorecard
```

Exits non-zero if the skill does **not beat** the baseline on exact match or if it under-warns on
any live label. (Gating on exact `11/11` would flake on live chain-state drift / a transient RPC;
the robust invariant is "strictly better than naive, with zero under-warning." For a frozen
pass/fail check, use the offline `npm test` suite.) Fixtures and labels live in
[`tests/eval.ts`](../tests/eval.ts).
