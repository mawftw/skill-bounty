# solana-lp-safety-skill

[![validate](https://github.com/mawftw/solana-lp-safety-skill/actions/workflows/validate.yml/badge.svg)](https://github.com/mawftw/solana-lp-safety-skill/actions/workflows/validate.yml)
&nbsp;`MIT`&nbsp; · &nbsp;`zero production npm deps`&nbsp; · &nbsp;`read-only — no wallet / key access`&nbsp; · &nbsp;reproduce the whole gate offline: `npm run validate`

> Pre-LP due-diligence for Solana liquidity providers. *Not* "should I buy this token?" —
> **"should I put liquidity into this pool, and can I get it back out?"**

Claude Code / [Solana AI Kit](https://github.com/solanabr/solana-ai-kit) Agent Skill for read-only
Solana LP due-diligence. It checks a pool or mint from a liquidity provider's perspective and
returns **GO / CAUTION / NO-GO** with the red flags that drove the verdict.

**Where it sits in an agent's LP workflow — the pre-entry gate.** Route here *before* opening or
adding liquidity, to decide *can capital safely enter and exit this pool?* Once you're in range, a
position manager takes over (impermanent loss, out-of-range, rebalance). Different lifecycle step,
different question — this is the check that runs first.

Built for **Meteora DLMM / DAMM v2**. The token-level checks (authorities, Token-2022, holder
concentration) are AMM-agnostic, so they apply to a Raydium/Orca *token* too — but automated
**pool** resolution is Meteora-only; for other AMMs, pass the token mint.

## Quick start

```bash
git clone https://github.com/mawftw/solana-lp-safety-skill.git
cd solana-lp-safety-skill
./install.sh
```

`install.sh` copies the self-contained skill into `~/.claude/skills/solana-lp-safety/` and installs
the `/lp-safety-check` command into `~/.claude/commands/`. Start a new Claude Code session after
installing.

Use it from any project:

```text
/lp-safety-check <POOL_OR_MINT_ADDRESS>
"is it safe to LP into this Meteora pool: <addr>?"
```

Or run the CLI directly from the clone:

```bash
npm run safety-check -- <POOL_OR_MINT_ADDRESS>
npm run safety-check -- <POOL_OR_MINT_ADDRESS> --json
```

Runs keyless with public Solana RPC, RugCheck, GoPlus, and Meteora API. `SOLANA_RPC_URL` or
`HELIUS_API_KEY` is optional for reliability / richer holder data. No wallet access. CLI exit
codes: `0` GO · `10` CAUTION · `20` NO-GO.

## Verify

```bash
npm run validate     # offline: typecheck, tests, hard-fail eval, demo, secret scan
npm run smoke        # installer + slash-command packaging smoke test
npm run eval         # live mainnet eval; exact counts can drift
```

`validate` is the main reproducibility gate: no network, no key, deterministic fixture replay.

## Scope

| Status | Covered |
|---|---|
| Automated today | Token authorities, Token-2022 exit/seize risks, Meteora DLMM/DAMM v2 pool identity binding, DAMM v2 lock %, TVL/thin-pool, measured fee-yield sanity, reserve balance, holder concentration, source-completeness gates |
| Agent-guided today | Bin-level exit depth, impermanent-loss sizing, bundle/insider context |
| Out of scope today | Wallet actions, trade execution, non-Meteora pool auto-resolution |

## Why LP-side?

Buyer-side token checks and LP-entry checks overlap, but the decision is not the same. A liquidity
provider is range-bound and may not be able to exit instantly, so this tool weights freeze/mint
authority, Token-2022 transfer restrictions, pool depth, LP lock state, concentration, and
source-completeness as LP exit risks.

## Where it fits

Token authorities and Token-2022 traps are the entry check. This skill also looks at pool health,
LP-lock, pool/lock-aware holder concentration, and LP-specific exit risk. Different tools answer
different questions:

| Capability | **LP-safety (this skill)** | Buyer-side rug-checkers | Token-2022 mint auditors | LP position managers |
|---|:---:|:---:|:---:|:---:|
| **The question it answers** | *"Safe to **provide** liquidity — can I exit?"* | *"Safe to **buy / hold**?"* | *"Safe to **integrate** this mint?"* | *"Manage an **open** position"* |
| Mint / freeze authority | ✅ | ✅ | ✅ | ❌ |
| Token-2022 seize / pause / fee extensions | ✅ | ◐ | ✅ | ❌ |
| LP permanent-lock (DAMM v2) — *framed for the LP's exit* | ✅ | ◐ | ❌ | ❌ |
| Pool TVL / thin-pool + LP-lock (DAMM v2) | ✅ | ◐ | ❌ | ✅ |
| Holder concentration — *pool/lock-aware* | ✅ | ◐ | ❌ | ❌ |
| Impermanent-loss risk *(skill guidance)* | ◐ | ❌ | ❌ | ◐ |
| **GO / CAUTION / NO-GO on *providing* liquidity** | ✅ | ❌ | ❌ | ❌ |

<sub>◐ = partial. These are tool *categories*, not specific products. The distinction is the
liquidity-provider question, not a claim about any single external tool.</sub>

### Ecosystem fit

This skill is not a replacement for Meteora, Jupiter, Helius, Birdeye, or other protocol/API
skills. Those help an agent build integrations, fetch data, route transactions, or manage
positions. `solana-lp-safety-skill` sits one step earlier: it is a read-only pre-entry safety
gate for LPs.

| Category | Typical job | What this skill adds |
|---|---|---|
| AMM SDK skills | Create pools, open/manage liquidity, claim fees | GO / CAUTION / NO-GO before capital enters the pool |
| Market/data API skills | Prices, volume, liquidity, holders, wallet analytics | Fail-closed LP risk semantics across multiple sources |
| Buyer-side rug tools | "Should I buy or hold this token?" | LP-specific exit-risk checks for pooled/range-bound capital |
| Position managers | Monitor/rebalance an already-open position | Pre-LP due-diligence before opening or adding liquidity |
| Program auditors | Review source code or protocol design | Live token + pool state inspection, no source repo required |

The difference is decision semantics, not private data access: external APIs are inputs, while the
engine binds pool identity on-chain, checks both pool sides, treats Token-2022 seize powers as
never trust-relaxable, and handles pool/lock-aware concentration.

## Evaluation

Over a labeled set of **11 real mainnet mints**, the latest observed live run has **10 / 11 exact**
GO / CAUTION / NO-GO matches — vs **6 / 11** for a common *authority-only* rug-check — and
**11 / 11 no-under-warning** outcomes, meaning the skill never returned a less severe verdict than
the independent label required. A previous run on 2026-06-27 returned **11 / 11 exact**; the
current drift is conservative, not a false GO: one expected-GO utility token is capped at
`CAUTION` because a single 10%+ holder is excluded only by a third-party lock/AMM label, and the
skill requires stronger proof before granting GO.

| latest observed live eval (of 11) | authority-only baseline | **this skill** |
|---|:---:|:---:|
| exact GO / CAUTION / NO-GO match | 6 | **10** |
| no under-warning (never less severe than label) | 8 | **11** |

The baseline is the **same input data under the naive authority-only rule** — an ablation, not a
competing product (it has no `CAUTION` state, so it's a floor on the concentration cases, not a
tournament). Counts are measured **live**, so they can move with chain state and third-party holder
labels; the ground-truth labels don't. The live CI gate therefore asserts the robust invariant —
the skill must beat the baseline — while the offline hard-fail gate below pins the safety-critical
false-GO surface deterministically.

The deterministic offline hard-fail eval focuses on the unsafe failure mode: returning `GO` for a
capability that can trap, seize, or drain an LP.

| over the hard-fail surface | authority-only baseline | **this skill** |
|---|:---:|:---:|
| NO-GO recall (caught disqualifying capabilities) | 3 / 15 | **15 / 15** |
| **false GO** (cleared something disqualifying) | 12 | **0** |
| false NO-GO (over-blocked a safe token) | 1 *(blocks USDC)* | **0** |
| fail-closed on undecodable / unknown capability (held, not leaked to GO) | 0 / 12 | **12 / 12** |

The baseline misses Token-2022 seize powers (permanent delegate, transfer hook, live fee authority,
pausable, non-transferable) and rug/blacklist flags because it only reads classic mint/freeze
authority. The skill also fail-closes on schema drift: a known extension whose internal state will
not decode is withheld, not assumed safe. **0 false GO** is across this evaluated surface, not a
universal guarantee. Run it: `npm run eval:hardfail` (confusion matrix included).

**Reproduce, no network or key:** `npm run validate` (typecheck + 88 unit + 19 integration +
hard-fail recall + signature demo + secret scan) and `npm run demo` (the four signature cases over
real captures). Live run: `npm run eval`. Method + per-token breakdown: **[`docs/EVAL.md`](docs/EVAL.md)**.
Axis-by-axis evidence map: **[`docs/RUBRIC_CHECKLIST.md`](docs/RUBRIC_CHECKLIST.md)**.

## What it checks (automated, in the CLI/engine)

- **Token authorities** — live mint / freeze authority; **fail-closed on malformed data**
  (a field it can't decode withholds GO rather than reading it as "renounced")
- **Token-2022 seize / exit risks** — permanent delegate, transfer hook, live transfer-fee
  authority, pausable, default-frozen, mint-close, non-transferable; **fail-closed on schema
  drift** — an unrecognized extension *or* malformed/missing state *inside* a known one (a
  delegate field that won't decode, a non-boolean `paused`) withholds GO, never read as renounced
- **Transfer-fee realism** — the **effective** fee across *both* Token-2022 fee schedules
  (older + newer, fail-closed to the higher rate); a renounced-but-≥50% fixed fee is a hard
  **exit-drain** block, not a soft note
- **LP lock & pool economics** — DAMM v2 permanent-lock %, thin-pool flag, **measured fee yield**
  (24h fees ÷ TVL — the *realized* rate, not an advertised APR) with a **wash-trade flag** when it's
  implausibly high, and the **reserve value balance** (how one-sided the pool is). *DLMM positions
  are individually owned, so DLMM creator-lock is reported as "not assessed" — never assumed safe.*
- **Pool-identity binding (on-chain)** — the requested address must be a real Meteora pool
  account: owned by the DLMM/DAMM program on-chain, and — for **both DLMM and DAMM v2** — it must
  carry the program's **pool-account discriminator** *and* its **decoded on-chain token pair must
  match the API-reported mints** (LbPair tokenX/tokenY for DLMM; cp-amm tokenA/tokenB for DAMM v2).
  So a stale/compromised REST response can neither point at a non-pool account nor keep a real pool
  address while **substituting** safe-looking mints — both are rejected for each AMM (see the
  `pool-pair-substitution` / `pool-damm-pair-substitution` / `pool-damm-wrong-type` fixtures). An
  unrecognized AMM type fails **closed**. A pool whose economics (TVL/depth) can't be assessed
  **withholds GO** (fail-closed).
- **Token-only vs LP scope** — given a *mint* (no pool), the result is reported as a **token-level**
  verdict, explicitly **not** an LP GO (the pool checks — lock, TVL, depth, both-sides — didn't run)
- **Holder concentration** — top-holder / top-10 %, **pool- and lock-aware**: only *known* AMM
  vaults / lockers / burns are excluded (allowlisted programs + RugCheck labels); an **unrecognized
  program escrow is counted** as concentration (never assumed locked → no hidden-whale false GO),
  with RugCheck labels naming the big holders
- **Mutable metadata**, a **fail-closed evidence gate** (a check that couldn't run caps at
  CAUTION), and a **both-sides pool check** (the quote token can trap an LP too)
- **Issuer trust (tiered)** — the canonical blue-chip allowlist (USDC/USDT/wSOL) clears a
  by-design live authority to GO; a third-party `trusted_token` flag alone only caps it at
  CAUTION (one external bit can't clear a live authority) and **never** relaxes a Token-2022
  seize power; trust provenance is surfaced in the output

Sources: Solana RPC (authorities + Token-2022) · RugCheck · GoPlus · Helius DAS (holder
count) · Meteora API. Keyless where possible.

## Skill guidance

Bin-level depth / exit-slippage, impermanent-loss sizing, volatility, and bundle/insider
context are covered as **methodology in the skill's topic files** — the agent applies them to
your specific pool. They are *not* computed verdicts in the CLI engine yet (see Implementation
status). *(Fee-APR realism is now automated — see the measured-yield wash-trade flag above.)*

## Example output

A legitimate token with large locked/AMM supply separated from free-floating whales — **GO**:

```text
$ npm run safety-check -- AWGCDT2gd8…pump
LP SAFETY: GO
🚩 Red flags: none
ℹ️  Where the big holders sit (RugCheck labels): 49% Streamflow-locked · 7% AMM liquidity
    — liquidity/locked supply, not free-floating whales.
```

A token with a real free-floating whale — **CAUTION**:

```text
$ npm run safety-check -- 739dnZEG4y…pump
LP SAFETY: CAUTION
🚩 [SOFT] Top non-pool holder controls 14.9% — largest is unlabeled (a private wallet);
    identify it before LPing.   (the rest: 53% Streamflow-locked)
```

A trusted issuer that's *still* unsafe to LP — **NO-GO**. The skill recognizes the issuer and
waives its by-design freeze/mint authorities, but a Token-2022 **permanent delegate** can seize
pooled tokens — a hard block regardless of trust:

```text
$ npm run safety-check -- 2b1kV6DkPA…4GXo   # PYUSD
LP SAFETY: NO-GO
🚩 [HARD] Permanent delegate set — can seize tokens from the pool. Irrevocable.
🚩 [HARD] Transfer-fee authority is live — fee can be ramped toward 100%, taxing withdrawals.
```

<sub>Output abridged to the decisive lines; the tool also prints residual notes, the holder
count, and which sources answered.</sub>

## Implementation status

Automated today: authority checks, Token-2022 exit/seize risk, DAMM v2 lock %, TVL/thin-pool,
measured fee-yield sanity, reserve balance, holder concentration, source-completeness gates, and
on-chain Meteora DLMM/DAMM v2 pool identity binding.

Agent-guided today: DLMM creator-position lock review, bin-level depth / exit slippage,
impermanent-loss sizing, bundle/insider context, and Solana Tracker enrichment.

Tested with `npm run validate` (offline) and `npm run smoke` (installer/slash-command packaging).

## Disclaimer

A `GO` verdict means "no disqualifying on-chain red flags found for an LP" — **not** financial
advice and **not** a profitability guarantee. Always review residual risks.

## License

MIT © 2026 mawftw
