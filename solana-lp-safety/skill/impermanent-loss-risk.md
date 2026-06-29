# Impermanent Loss / Volatility Risk

Non-malicious risk unique to range LPs: even a perfectly "clean" token (all authorities renounced,
LP locked) can still bleed a liquidity provider through divergence. This dimension drives **CAUTION**
and the residual-risk note — it rarely drives a NO-GO on its own.

## Why it's worse in concentrated liquidity (DLMM)

- A full-range AMM spreads IL thin; a **concentrated** DLMM range amplifies it. The tighter your
  range / the more **Curve**-shaped your distribution, the more fees you earn *if price sits still* —
  and the harder IL hits when it moves.
- When price exits your range you go **100% single-sided** (holding the losing token) **and stop
  earning fees entirely**. The headline APR keeps displaying; your realized return is zero + IL.

## What to assess

- **Volatility profile** — high realized volatility punishes concentrated ranges. Fresh / low-cap /
  reflexive tokens are the worst: they trend hard one way, leave your range fast, and the fee APR
  that looked huge was *because* of the whipsaw that caused the IL.
- **Pair composition** — volatile/volatile carries more divergence risk than volatile/stable.
- **Range width vs fees** — tight range = more fees but exits the range (stops earning) sooner;
  wide/Spot range = lower fees but more robust. There's no free APR; high fee APR on a volatile
  low-cap is compensation for IL risk, not alpha.

## The honest framing for the user

> Fee APR is **IL-blind and range-blind**. A "200% APR" DLMM pool on a volatile memecoin can still
> be net-negative after divergence loss and time out of range. Treat high APR as a risk signal, size
> small, and prefer wider/Spot distributions on volatile pairs unless actively managing.

Use volatility (e.g. from `ohlcv` high/low ranges) as a soft input; combine with the pool-fragility
checks in [`lp-pool-health.md`](./lp-pool-health.md). Verdict → [`scoring.md`](./scoring.md).
