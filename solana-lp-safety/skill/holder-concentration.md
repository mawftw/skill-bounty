# Holder Concentration & Bundle / Insider Patterns

Distribution risk = how much supply can dump on the pool (and on you, the LP holding the other side).

## Get holders + supply

- **RPC `getTokenLargestAccounts(<mint>)`** — top **20 only**, no pagination. Returns
  `value[].{address, amount, uiAmount}` where **`address` is the token ACCOUNT, not the owner**. To
  get owner wallets, `getMultipleAccounts(jsonParsed)` and read `info.owner` (two accounts can share
  one owner — dedupe by owner). Supply: `getTokenSupply(<mint>)`.
- **Helius DAS `getTokenAccounts`** (preferred for full lists) — params `{mint, cursor, limit≤1000}`;
  returns `token_accounts[].{address, owner, amount, frozen, burnt}` with `owner` **directly** →
  aggregate `amount` by `owner` for true per-wallet concentration. Paginate via `cursor`.

## Compute top-N correctly (exclusions matter)

1. Aggregate balances **by owner**.
2. **Exclude non-circulating / non-holder accounts** before ranking, or every pool looks "concentrated":
   - AMM **pool vaults** (Raydium/Orca/Meteora) — that's liquidity, not a whale.
   - **Burn address** `1nc1nerator11111111111111111111111111111111`.
   - **Locked/vesting** contracts (RugCheck `lockers`, Streamflow).
   - **CEX hot wallets** (custodial = many users).
   - Shortcut: reuse RugCheck `knownAccounts` (labeled) and per-holder `insider` flag instead of
     maintaining your own list. GoPlus `holders[].tag` / `is_locked` do the same.
3. Concentration = `sum(top-N filtered) / circulating` (circulating = supply − burned − locked,
   recommended).

## Thresholds (heuristic — public defaults; Rake tunes its own)

- Single non-pool holder **> ~10%** = caution; **> ~20–30%** = high dump risk.
- Top-10 (filtered) **> ~25–30%** = elevated; **> ~50%** = high.
- Bundled/insider supply at launch **> ~20–30%** = strong rug/dump risk.

## Bundle / insider / sniper heuristics

- **Bundle** (many wallets = one entity): common SOL **funding source** (trace SOL backward);
  **same-slot/same-block buys** by distinct wallets (~400ms slots → almost always one Jito bundle;
  >50% of pump.fun tokens are sniped in the genesis block); **fresh wallets** created minutes before
  launch with no history.
- **Insider / sniper**: direct **deployer→wallet** SOL transfers pre-launch; **bought before
  liquidity** was added (or in the launch block).
- Lean on RugCheck: `graphInsidersDetected`, `insiderNetworks`, `topHolders[].insider`, and
  endpoints `/insiders/graph`, `/insiders/networks`.

Endpoints/fields → [`data-sources.md`](./data-sources.md). Verdict → [`scoring.md`](./scoring.md).
