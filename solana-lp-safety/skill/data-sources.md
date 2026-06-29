# Data Sources & Fallbacks

Multi-source by design — raw RPC is **ground truth**; aggregators are enrichment/agreement signals.
Flag disagreements. Prefer keyless sources; degrade gracefully and report which sources were skipped.
Never hardcode keys → [`rules/api-key-safety.md`](rules/api-key-safety.md).

> Endpoints below verified live 2026-06; field names can drift — re-check on failure.

## Source matrix

| Source | Key? | Best for |
| --- | --- | --- |
| Public Solana RPC | no | authorities, account state, Token-2022 extension decode, top-20 holders |
| RugCheck | no (GET reads) | risk summary, authorities, LP-locked %, top holders, insider graph |
| GoPlus (Solana) | no* | token security flags cross-check, holders, LP/dex info |
| Helius DAS | yes | full holder list (owner-aggregated), enhanced txns / forensics |
| Meteora data API | no | pool TVL/volume/fees/APR/bins, DAMM v2 lock status, token flags |
| Meteora DLMM SDK | no | on-chain bins, active bin, fee info, exit-slippage quote |
| Solana Tracker | yes | optional alternative: holders, pricing, trade history / forensics |

\* GoPlus answered keyless in testing but is rate-limited; use its access-token flow for volume.

## Solana RPC

- `getAccountInfo(mint, {encoding:"jsonParsed"})` → `value.owner` (program), `…parsed.info.{mintAuthority,freezeAuthority,supply,decimals}`, and Token-2022 `…info.extensions[]` (`{extension,state}`, camelCase). `unparseableExtension` → decode raw with current `@solana/spl-token`.
- `getTokenSupply(mint)`; `getTokenLargestAccounts(mint)` (top 20, `address` = token account → resolve owners via `getMultipleAccounts`).

## RugCheck — `https://api.rugcheck.xyz`

- `GET /v1/tokens/{mint}/report` (keyless) — full report. `GET …/report/summary` — light.
- Key fields: `mintAuthority`, `freezeAuthority`, `token` (parsed mint), `tokenMeta.{mutable,updateAuthority}`, `token_extensions`, `transferFee`, `risks[].{name,level("warn"|"danger"),score}`, `topHolders[].{owner,pct,insider}`, `markets[].lp.{lpLocked,lpLockedPct}`, `totalMarketLiquidity`, `lockers`, `knownAccounts`, `graphInsidersDetected`, `insiderNetworks`, `rugged`, `score_normalised` (0–100, **higher = riskier**), `verification`.
- Also: `/lockers`, `/insiders/graph`, `/insiders/networks`; bulk `POST /v1/bulk/tokens/report`.

## GoPlus — `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses={mint}`

- Returns `result["<mint>"]`. Authority objects shape `{authority:[…], status:"0"|"1"}` (`"1"` = present/live): `mintable`, `freezable`, `closable`, `transfer_fee_upgradable`, `transfer_hook_upgradable`, `metadata_mutable`.
- `holders[].{account,percent,is_locked,tag}` (use `tag`/`is_locked` to exclude CEX/locked), `lp_holders[]`, `dex[].{dex_name,type,id,tvl,burn_percent}`, `trusted_token` (allowlist shortcut), `total_supply`, `holder_count`.

## Helius DAS (keyed)

- `getTokenAccounts` `{mint, cursor, limit≤1000}` → `token_accounts[].{owner,amount,frozen,burnt}` (owner direct → aggregate by owner). Paginate via `cursor`. Used for full holder concentration + forensics.

## Solana Tracker (keyed, optional)

Optional enrichment when a key is set — alternative holder lists, pricing, and trade history that can
corroborate Helius/RugCheck. Not required: the skill works fully without it. See `docs.solanatracker.io`
for current endpoints/fields before wiring it in (not re-verified here).

## Meteora data API

- **DLMM** `https://dlmm.datapi.meteora.ag` (~30 rps): `GET /pools`, `GET /pools/{addr}`, `GET /pools/groups`, `GET /pools/{addr}/ohlcv?interval=1h`.
- **DAMM v2** `https://damm-v2.datapi.meteora.ag` (~10 rps): same paths; adds `permanent_lock_liquidity`, `vested_liquidity.{months_3,months_6}`, `vault_x/y`, `alpha_vault`, `pool_config.{concentrated_liquidity,min_price,max_price,has_fee_scheduler}`.
- Pool fields: `tvl`, `current_price`, `apr`, `apy`, `farm_apr`, `volume/fees/protocol_fees/fee_tvl_ratio` (keyed 30m…24h), `cumulative_metrics`, `reserve_x/y`, `is_blacklisted`, `is_verified`, `tags`, `launchpad`, `pool_config.{bin_step,base_fee_pct,max_fee_pct}`, and per-token `token_x/token_y.{symbol,decimals,is_verified,holders,freeze_authority_disabled,total_supply,market_cap}`.
- ⚠️ **Deprecated**: legacy `https://dlmm-api.meteora.ag/pair/all` now 404s — many old guides cite it; use `dlmm.datapi.meteora.ag`. `damm-api.meteora.ag` is **DAMM v1**, not v2 — don't confuse.

## Meteora DLMM SDK — `@meteora-ag/dlmm` (keyless, on-chain reads)

`npm i @meteora-ag/dlmm @coral-xyz/anchor @solana/web3.js`. Init `DLMM.create(connection, poolPubkey)`.
Key reads: `getActiveBin()`, `getBinsAroundActiveBin(l,r)` (distribution/fragility), `getBinArrays()`,
`getFeeInfo()`, `getDynamicFee()`, `swapQuote(...)` (simulate exit slippage), `getMaxPriceInBinArrays()`,
`getPriceOfBinByBinId(id)`. (DAMM v2 SDK is a separate package — confirm name before use.)

## Cross-check strategy

Per target: (1) raw RPC for authoritative authorities/extensions, (2) Metaplex metadata PDA for
`isMutable`/`updateAuthority`, (3) Helius for owner-aggregated concentration, (4) Meteora API/SDK for
pool health + lock, (5) RugCheck + GoPlus as opinionated overlays. Authoritative = RPC/SDK;
aggregators = agreement signals. Disagreement → flag, don't silently pick one.
