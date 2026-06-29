# Offline transport fixtures

Each `*.json` here is a sanitized record/replay capture that lets `analyze()` run with
**no network and no API key** (see `transport.ts`, `../../scripts/record-fixture.ts`, and
`../../P0.2-REPLAY-SEAM-PLAN.md`). `npm run test:integration` replays them and asserts the
verdict; the runner stubs global `fetch` to throw, so a pass proves the run was truly offline.

**Sanitization.** Calls are keyed by `requestKey()`: RPC POSTs key on `method`+`params` only
(so the RPC URL — and any Helius `api-key` in it — never enters a fixture), REST GETs key on
the keyless URL. The recorder additionally aborts if the serialized fixture would contain a
credential-shaped query param, an RPC-provider hostname, or the `HELIUS_API_KEY` /
`SOLANA_RPC_URL` value. No fixture contains a key or RPC host.

**Strictness.** The replayer is strict: an unrecorded call is recorded as a `miss` and the
integration runner fails if `misses > 0`, so an incomplete/hand-edited fixture can't silently
pass for the wrong reason. "Source unavailable" is simulated ONLY by a stored `{"__error": …}`
value (a present key), never by an absent key.

## The matrix

| Fixture | Origin | Target | Expect | Exercises |
|---|---|---|---|---|
| `unverified-label-caution` | recorded (real) | legit token, one >10% holder excluded only via a RugCheck label | CAUTION | label-exclusion safeguard — a single ≥10% holder dropped on an unverified third-party label caps at CAUTION (`unverified_label_exclusion`), never a GO |
| `usdc-go` | recorded (real) | USDC | GO | trusted blue-chip, live freeze authority → residual (not a block) |
| `pyusd-nogo` | recorded (real) | PYUSD | NO-GO | Token-2022 permanent delegate (seize) — hard, never relaxed |
| `conc-caution` | recorded (real) | a pump.fun token | CAUTION | one real ~32% unlabeled wallet (concentration) |
| `locked-excluded-go` | recorded (real) | a pump.fun token | GO | ~49% Streamflow-locked supply excluded from concentration |
| `pool-dlmm-go` | recorded (real) | SOL-USDC DLMM pool | GO | **pool resolution** + `toPoolInfo` + base/quote split + USDC quote waived |
| `verified-untrusted-nogo` | synthetic (real capture + injected live freeze) | untrusted + injected live freeze | NO-GO | the P0.0 invariant: "verified"/untrusted can't downgrade a live authority |
| `rugcheck-unavailable-caution` | recorded with RugCheck forced down | legit token, RugCheck offline | CAUTION | fail-closed evidence gate (untrusted + missing risk source ≠ safe) |
| `goplus-unavailable-go` | synthetic (from `locked-excluded-go`) | GoPlus offline | GO | graceful degradation — one source down doesn't false-flag |
| `malformed-error` | synthetic | address that is neither mint nor pool | error | clean resolve failure (no account, no pool) |
| `pool-no-tvl` | synthetic (from `pool-dlmm-go`) | DLMM pool, TVL/fees omitted | CAUTION | fail-closed pool economics — depth unverified ⇒ `pool_economics_unavailable` |
| `pool-identity-attack` | synthetic | non-Meteora account + safe-looking API pool | error | on-chain pool-identity binding — wrong program owner rejected |
| `pool-pair-substitution` | synthetic (real LbPair acct + wrong API mint) | DLMM pool addr, substituted base mint | error | on-chain **pair** binding — decoded tokenX/tokenY must match the API pair |
| `pool-pair-duplicate` | synthetic (real LbPair acct + duplicated API mint) | DLMM pool addr, API repeats the safe mint | error | **set-equality** pair binding — `[USDC,USDC]` can't hide the other on-chain token |
| `pool-damm-v2-caution` | recorded (real) | SOL-USDC DAMM v2 (cp-amm) pool | CAUTION | **DAMM v2 pool resolution + on-chain binding** (cp-amm Pool disc + tokenA/B @168/200); 0% LP-locked soft flag |
| `pool-damm-pair-substitution` | synthetic (real cp-amm Pool acct + wrong API mint) | DAMM v2 pool addr, substituted base mint | error | **DAMM v2 pair** binding — decoded cp-amm tokenA/tokenB must match the API pair |
| `pool-damm-pair-duplicate` | synthetic (real cp-amm Pool acct + duplicated API mint) | DAMM v2 pool addr, API repeats the safe mint | error | DAMM v2 **set-equality** pair binding — duplicate mint rejected |
| `pool-damm-wrong-type` | synthetic (cp-amm-owned acct, corrupted discriminator) | DAMM v2 addr, non-Pool account type | error | DAMM v2 **discriminator** binding — a cp-amm Position/Config can't pass as a Pool |
| `conc-unknown-pda-whale-caution` | synthetic (from `conc-caution`) | token whose top holder sits behind an **unrecognized program** | CAUTION | holder-exclusion allowlist — an unlisted program escrow is **counted** (not assumed locked) → `unlisted_program_supply` |

**Reproducing.** The `recorded (real)` rows can be re-captured with
`npm run record-fixture -- <ADDR> <name>`. The `synthetic` rows are derived from a real
recording by editing a single field (noted in each file's `note`); the forced-down row is a
real recording with one source made unavailable at capture time. Verdict logic for every
hard-fail branch is additionally covered by the pure unit tests in `../score.test.ts`.

> Not yet captured (covered by unit tests; optional integration follow-ups): isolated
> Token-2022 transfer-fee / transfer-hook / pausable hard-fails, and a token/token pool whose
> **quote** side carries a live authority (quote-side hard-fail end-to-end).
