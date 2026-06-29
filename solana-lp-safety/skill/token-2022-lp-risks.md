# Token-2022 Extension Risks (LP impact)

SPL **Token-2022** mints can carry extensions that classic mints cannot. Judge each by how it
**blocks**, **drains**, or **seizes** an LP position — not by mere presence.

## Step 0 — is it even Token-2022?

From `getAccountInfo` (jsonParsed): `value.owner === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"`.
Classic mints (`Tokenkeg…`) have zero extensions — only the base checks in
[`token-authorities.md`](./token-authorities.md) apply.

## How to detect

Iterate `value.data.parsed.info.extensions[]`; each element is `{ extension: "<camelCase>", state: {…} }`.
Match the **camelCase** strings below (these are the Agave `account-decoder` names, not the Rust
PascalCase names). If any element is `"unparseableExtension"`, **treat as a red flag** and decode raw
with a current `@solana/spl-token` (`unpackMint` / `getExtensionData`) — do not assume "safe".

> **The core rule:** for almost every extension the verdict is *"is the controlling authority live
> (non-null) or renounced (null)?"* — not presence. Two exceptions: `nonTransferable` (presence =
> fatal, no authority) and `permanentDelegate` (fixed at mint init, **can never be renounced**).

## (a) Can OUTRIGHT BLOCK add/remove liquidity → NO-GO

| Extension (`extension` string) | State to read | Block condition |
| --- | --- | --- |
| `nonTransferable` | (marker) | **Present = fatal.** Soulbound; AMM can't custody it. |
| `pausableConfig` | `authority`, `paused` | `authority != null` = discretionary kill-switch over transfers/withdraws. `paused == true` = halted now. (mint-level string; account-level is `pausableAccount`) |
| `transferHook` | `programId`, `authority` | `programId != null` = arbitrary program runs on every transfer → can deny your exit (audit it). `authority != null` = a hook can be added later (latent). |
| `defaultAccountState` | `accountState` | `"frozen"` + live base `freezeAuthority` = new vaults born frozen, stranded. |

Plus the base **`freezeAuthority`** (not an extension — see [`token-authorities.md`](./token-authorities.md)): the dominant block vector.

## (b) Silently DRAIN or MISPRICE value

| Extension | State to read | LP impact |
| --- | --- | --- |
| `transferFeeConfig` | `newerTransferFee.{transferFeeBasisPoints,maximumFee}`, `transferFeeConfigAuthority` | **The only real on-chain drain.** Fee skimmed from received amount on every transfer (incl. your withdrawal). If `transferFeeConfigAuthority != null` it can be raised toward **100%** (epoch-gated, short grace) → withdrawal becomes total loss. Acceptable only if authority `null` **and** fee small/fixed. |
| `interestBearingConfig` | `currentRate`, `rateAuthority` | **Mispricing only — does NOT change raw balances.** Only scales displayed `uiAmount` (live authority can even go negative). Always value off **raw amount**, never `uiAmount`. |
| `scaledUiAmountConfig` | `multiplier`, `authority` | Same family as interest-bearing: rebasing display only, no raw drain. Price off raw amount. |

## (c) Enable SEIZURE → NO-GO

| Extension | State | LP impact |
| --- | --- | --- |
| `permanentDelegate` | `delegate` | **Highest severity.** If `delegate != null`, that key can transfer/burn from **any** account — including the pool vault — at will, irrevocably. **Cannot be renounced** (fixed at init). Non-null = permanent seize power forever. |

## Cosmetic / low-LP-risk (record, don't block)

`metadataPointer`, `tokenMetadata` (mutable name/symbol = impersonation, see token-authorities),
`groupPointer`, `groupMemberPointer`, `tokenGroup*`. `mintCloseAuthority` — indirect: a live
`closeAuthority` can close a zero-supply mint and reinitialize it with worse extensions (reinit
vector) → CAUTION. `confidentialTransferMint` — most AMMs reject it outright.

## Meteora-specific gate (useful signal, not a guarantee)

Meteora DLMM only allows **permissionless** pool creation for Token-2022 mints whose risky
extensions are neutralized: transfer hook revoked/inactive, freeze authority handled; only benign
`transferFeeConfig` + `metadataPointer` are permissionless. An **active transfer hook, live freeze
authority, or permanent delegate requires a manually-reviewed Meteora `token_badge`**. So a DLMM
pool *existing* is partial assurance — still inspect the mint's extensions directly.

Feeds the verdict in [`scoring.md`](./scoring.md).
