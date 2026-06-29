// Shared types for the LP-safety checker.

export type Verdict = "GO" | "CAUTION" | "NO-GO";

// hard  -> contributes a NO-GO
// soft  -> contributes a CAUTION
// info  -> residual note only (never changes the verdict)
export type Severity = "hard" | "soft" | "info";

export interface Finding {
  severity: Severity;
  code: string;       // stable id, used by the report renderer
  message: string;
  source: string;     // which data source produced it
}

export interface SourceStatus {
  name: string;
  ok: boolean;
  note?: string;      // why it failed / was skipped
}

export interface MintInfo {
  mint: string;
  program: "spl-token" | "spl-token-2022" | "unknown";
  mintAuthority: string | null;
  freezeAuthority: string | null;
  decimals: number | null;
  supply: string | null;
  extensions: { extension: string; state?: any }[];
}

export interface PoolInfo {
  address: string;
  amm: string;            // "meteora-dlmm" | "meteora-damm-v2"
  baseMint: string;
  quoteMint: string;
  tvl?: number;
  volume24h?: number;
  fees24h?: number;            // realized 24h fees (USD) — for fee-APR realism
  baseValuePct?: number;       // base side's % of pool value (reserve balance)
  baseFreezeDisabled?: boolean;
  permanentLockPct?: number;   // DAMM v2 only
  isBlacklisted?: boolean;
  raw?: any;
}

export interface Report {
  target: string;
  resolvedAs: "mint" | "pool";
  // "pool" = a full LP verdict; "token-only" = pool-specific checks did NOT run (a
  // mint was given), so a clean result is NOT an LP-safe GO.
  scope: "pool" | "token-only";
  baseMint: string;
  pool?: PoolInfo;
  mint: MintInfo;
  knownGood: boolean;
  findings: Finding[];
  sources: SourceStatus[];
  verdict: Verdict;
}
