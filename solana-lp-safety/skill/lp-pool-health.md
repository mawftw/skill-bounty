# LP & Pool Health

Pool-level checks that matter to whoever **supplies** the liquidity. Primary target: Meteora DLMM /
DAMM v2 (generalizes to other AMMs).

## DLMM mechanics you must understand first

- **Bins** — discrete price points (constant-sum within a bin → zero slippage inside a bin;
  slippage only when a trade crosses bins). **Bin step** = gap between bins in bps
  (`bin_step: 4` = 0.04%). **Active bin** = the *only* bin holding both tokens and the *only* bin
  earning fees. Bins below active hold only quote; bins above hold only base.
- **Distribution shapes**: **Spot** (uniform — most robust), **Curve** (concentrated at active —
  max fees but worst IL, flips single-sided fastest), **Bid-Ask** (edges — volatility/DCA).

## Fragility: the "left holding the bag" check

- **Single-bin / ultra-narrow liquidity** → as soon as price moves one bin, the position becomes
  **100% single-sided** and you're left holding the *losing* token. The #1 fragility signal.
- **Lopsided bins** (all depth on one side of active) → asymmetric, primed to dump on you.
- Healthy = liquidity spread across **many two-sided bins** around the active bin.
- Read with the DLMM SDK `getBinsAroundActiveBin(left,right)` → per-bin `{xAmount,yAmount,price}`.
  Compute `maxBinLiquidity / totalLiquidity` (spike ratio) and left/right balance around active bin.
- **Exit slippage**: simulate selling *your size* with `swapQuote(...)` — a tall single spike has
  almost no depth a few bins out, so exiting walks price down hard even if headline `tvl` looks big.

## TVL / depth (heuristic, not official)

`tvl` (USD). Sub-~$25k = thin/easily manipulated; ~$100k+ with distributed two-sided bins = workable;
majors run into millions. **Always confirm `tvl` is backed by distributed bins, not one spike.**

## Volume / fees / APR realism

- API gives `volume`, `fees`, `protocol_fees`, `fee_tvl_ratio` keyed `30m/1h/2h/4h/12h/24h`, plus
  `apr`, `apy`, `farm_apr`. **Do not trust `apr`/`apy` as forward returns:** `apr` ≈ trailing-24h
  fee/TVL; `apy` annualizes one volatile day across a year. Both are backward-looking, IL-blind, and
  range-blind (you earn fees **only** while price is in your range / the active bin).
- **Wash-trade sanity check**: `volume.24h / tvl`. Deep pairs sustaining a few-x/day with
  `fees ≈ volume × base_fee_pct` are organic. 🚩 tiny `tvl` + huge `volume.24h` (tens–hundreds×/day),
  bursty volume, or fees that don't reconcile to volume. Cross-check the `ohlcv` endpoint: real
  volume tracks price movement; flat-price churn = wash signature.

## LP rug vectors (the ones unique to providers)

- **DLMM positions are unlocked by default** — anyone, including the creator, can withdraw their own
  bins at will *unless* a position carries a native **`lockReleasePoint`** timelock (set at seeding).
  So "locked liquidity" claims on a DLMM pool are **marketing until verified on-chain**: read
  `lockReleasePoint` on the creator's position, and check burn / lock-program ownership. Don't trust
  third-party "locked" badges (Meteora had a **June 2025 DAMM v2 display bug** where unlocked
  liquidity showed as locked).
- **DAMM v2 has real locking**: fields `permanent_lock_liquidity` (USD permanently locked) and
  `vested_liquidity.{months_3,months_6}`. Check `permanent_lock_liquidity / tvl` — high = hard-rug
  resistant (creator still claims fees but can't withdraw principal). Still verify the lock on-chain.
- **Withdrawal traps** — a live token **freeze authority**, an active **transfer hook**, or a
  **permanent delegate** can stop you removing liquidity even while the attacker trades/dumps. Fast
  pre-filter: API `token_x/token_y.freeze_authority_disabled` must be `true` for the risky token;
  then confirm extensions on-chain (see [`token-2022-lp-risks.md`](./token-2022-lp-risks.md)).

## Triage fields (Meteora API)

`is_blacklisted` (must be false), `is_verified`, `tags`, `launchpad`, `alpha_vault` (DAMM v2
anti-sniper escrow; `1111…1111` = none). Endpoints, field shapes, SDK methods →
[`data-sources.md`](./data-sources.md). Verdict → [`scoring.md`](./scoring.md).
