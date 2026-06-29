# Token Authorities & Metadata Risk

Classic SPL-token authorities, read for a **liquidity provider**. These apply to *every* mint
(classic and Token-2022). For Token-2022 extension authorities see
[`token-2022-lp-risks.md`](./token-2022-lp-risks.md).

## How to read (authoritative: raw RPC)

`getAccountInfo(<mint>, { encoding: "jsonParsed" })` → `result.value`:

| Field | Path | `null` means |
| --- | --- | --- |
| Program owner | `value.owner` | `Tokenkeg…` = classic SPL · `TokenzQ…` = Token-2022 |
| Mint authority | `value.data.parsed.info.mintAuthority` | **renounced** (supply fixed) → safe |
| Freeze authority | `value.data.parsed.info.freezeAuthority` | **renounced** (no one can freeze) → safe |
| Supply / decimals | `…info.supply` (raw string) / `…info.decimals` | — |

Type guard: `value.data.parsed.type === "mint"`. On-chain these are `COption<Pubkey>`; jsonParsed
collapses `None` → JSON `null`, so you only check `null` vs a base58 string.

**Metadata UPDATE authority** (Metaplex Token Metadata):
- PDA seeds: `["metadata", <MetadataProgramId bytes>, <mint bytes>]` over program
  `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s`.
- `getAccountInfo` the PDA → deserialize with `mpl-token-metadata` (or read via RugCheck/GoPlus,
  which decode it). Key fields: `updateAuthority`, `isMutable` (bool), `data.{name,symbol,uri}`.

## Risk (when authority is LIVE / non-null)

| Authority live | LP risk | Verdict |
| --- | --- | --- |
| **Freeze authority** | Can freeze the pool vault / your position account → liquidity **trapped, no exit**. This is the single worst classic-token vector for an LP. | **NO-GO** for any untrusted token |
| **Mint authority** | Unlimited new supply dilutes the pool and tanks the side you hold. | **NO-GO** for untrusted token |
| **Metadata mutable** (`isMutable: true` / live `updateAuthority`) | Name/symbol/logo/URI can be rewritten post-launch → rebrand-a-rug / impersonation. | **CAUTION** (manipulation vector, not a drain) |
| **Metadata impersonation** (mimics a known token's name/symbol/logo) | Bait for mistaken LPs. | flag → CAUTION |

Safest classic token: `mintAuthority = null`, `freezeAuthority = null`, `isMutable = false`.

> ⚠️ **Known-good caveat — don't auto-fail blindly.** Some legitimate tokens keep a live authority
> by design: **USDC keeps a freeze authority** (Circle compliance) and a live mint authority. Before
> treating a live authority as fatal, check the token against a **narrow** trust signal — the GoPlus
> `trusted_token` list or a canonical blue-chip allowlist (USDC/USDT/wSOL). **A RugCheck/Jupiter
> `verification` flag is NOT enough** on its own: "verified" means a listing + socials, not a safe
> authority, so a verified-but-untrusted token with a live freeze/mint authority must still NO-GO.
> The hard-fail rule is for *untrusted / fresh* tokens; the override is for genuinely trusted issuers.

## Cross-check

Treat raw RPC as ground truth; use aggregators as agreement signals (flag disagreements):
- **RugCheck** `/report`: top-level `mintAuthority`, `freezeAuthority`, `tokenMeta.{mutable,updateAuthority}`, and `risks[]` (e.g. `{name:"Mutable metadata", level:"warn"}`).
- **GoPlus**: `mintable.status` / `freezable.status` / `metadata_mutable.status` (`"1"` = present/live).

See [`data-sources.md`](./data-sources.md) for endpoints. Feeds the verdict in [`scoring.md`](./scoring.md).
