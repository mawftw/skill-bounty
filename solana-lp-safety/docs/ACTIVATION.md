# Activation test set — when the skill should (and should NOT) fire

An Agent Skill is only useful if it **triggers on the right prompts and stays quiet on the wrong
ones**. This is the labeled set we use to validate the `SKILL.md` `description` (the text the agent
matches against). Run it as a real activation eval by feeding each prompt to an agent that has the
skill installed and recording whether the skill loads; the deterministic discriminability check
(`npm run activation-check`) verifies the description carries the separating vocabulary offline.

**Target:** ≥90% correct triggering on the should-fire set, ≤10% false-fire on the near-miss set.

## ✅ Should trigger (LP pre-deposit safety — the skill's job)

1. "Is it safe to LP into this Meteora pool: `<addr>`?"
2. "Before my agent adds liquidity here, check the exit risks."
3. "Run due-diligence on this mint before I provide liquidity."
4. "Should I open a DLMM position in this pair?"
5. "Can this Token-2022 mint seize funds out of the pool if I LP?"
6. "Check whether the creator can pull liquidity before I deposit."
7. "Is this DAMM v2 pool's LP locked enough to provide into?"
8. "What's the rug risk if I become a liquidity provider here?"
9. "Vet this pool for freeze/seize traps before I add liquidity."
10. "Is the quote token on this pool safe to hold as an LP?"
11. "Pre-deposit safety check on `<pool addr>` please."
12. "I'm about to range-LP this token — can I get my capital back out?"

## ❌ Should NOT trigger (near-misses — adjacent but a different job)

1. "Should I buy this memecoin?" — buyer/spot question, not LP exit risk.
2. "Audit this Anchor program's source code." — program logic, not on-chain token/pool state.
3. "Rebalance my existing Orca position." — managing an *open* position, not a pre-deposit gate.
4. "Explain how Token-2022 transfer fees work." — concept explainer, no specific pool/mint to vet.
5. "Create a new token with a permanent delegate." — token *creation*, not safety screening.
6. "What's the price of SOL right now?" — market data, unrelated.
7. "Bridge my USDC from Ethereum to Solana." — bridging op, not LP due-diligence.
8. "Is this NFT collection legit?" — NFT, not an LP token/pool.

## Why these near-misses are the hard ones

The buy-side ("should I buy?"), the position-manager ("rebalance my open position"), and the
program-audit ("audit this code") prompts share vocabulary with LP safety but are **different
decisions**. The `description` is written to separate them: it names *provide / add / rebalance
liquidity* and *liquidity provider*, scopes to *Meteora DLMM/DAMM v2*, and the body's **"When NOT
to use"** section explicitly rejects buyer-side rug-checking and program audits. Items 3 and 5 are
the trickiest: "rebalance" appears in our trigger surface (rebalancing *into* a position needs the
same entry check) but "rebalance my **existing** position" is lifecycle management — the agent
should prefer a position-manager skill there.
