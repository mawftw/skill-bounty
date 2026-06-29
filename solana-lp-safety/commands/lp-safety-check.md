---
name: lp-safety-check
description: Run pre-LP due-diligence on a Solana pool or mint and return a GO/CAUTION/NO-GO verdict from a liquidity provider's perspective (Meteora DLMM/DAMM v2).
argument-hint: <POOL_OR_MINT_ADDRESS>
allowed-tools: Bash(__SKILL_DIR__/scripts/lp-safety-check-command.sh:*), Read
---

# /lp-safety-check `$ARGUMENTS`

Pre-LP due-diligence for the Solana pool or mint **`$ARGUMENTS`** — *"is it safe to provide
liquidity here, and can I get it back out?"* (not "should I buy this token?").

## Step 1 — validate the target

If `$ARGUMENTS` is empty or not a base58 Solana address (32–44 chars, alphabet
`[1-9A-HJ-NP-Za-km-z]`), stop and ask the user for a pool or mint address — don't guess.

## Step 2 — run the authoritative check

The bundled CLI (`safety-check.ts`) is the source of truth for the verdict — it runs the same
multi-source pipeline as the skill. Its output for this target (the absolute path below is filled
in by `install.sh` when the skill is installed, so it resolves from any directory):

```!
__SKILL_DIR__/scripts/lp-safety-check-command.sh "$ARGUMENTS"
```

> The CLI exits `0` GO · `10` CAUTION · `20` NO-GO (the `|| true` keeps a CAUTION/NO-GO from
> reading as a command failure inside the wrapper). If the block above shows a usage/parse error,
> fall back to the manual procedure in the **solana-lp-safety** skill (its `SKILL.md`) and report
> which sources you reached.

## Step 3 — present the verdict

Relay the result to the user in this shape:

- **Lead with the verdict** — `GO` / `CAUTION` / `NO-GO` — and the single decisive reason.
- **Red flags**, most severe first (HARD before SOFT). For each: *what* it is → *why it
  matters to an LP* → *authority live or renounced* → *what would clear it*.
- **Residual risks / notes**, including any **known-good override** applied (e.g. a trusted
  issuer's by-design freeze authority downgraded to residual — never a Token-2022 seize power).
- **Which sources answered** vs were unavailable (a check that *couldn't run* is "not verified,"
  not "safe").
- If the target resolved as a **mint, not a pool**, remind the user that LP-specific checks
  (LP-lock, TVL, bin depth) need a Meteora **pool** address.

## Step 4 — the honest caveat

A `GO` is **not** financial advice and **not** a profitability guarantee — it means "no
disqualifying on-chain red flags found for an LP." Always state the residual risks.

---

Scoring rules and the full operating procedure live in the **solana-lp-safety** skill
(`scoring.md`, `SKILL.md`). For deeper, agent-reasoned dimensions (bin depth, fee-APR realism,
impermanent-loss sizing) load the matching topic file in that skill.
