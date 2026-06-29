// The fair "authority-only" baseline — shared by every eval (live, hard-fail,
// demo) so the comparison is identical everywhere (no drift).
//
// This is what a basic rug-check, or a non-expert agent, does: live mint OR freeze
// authority ⇒ NO-GO, else GO. It has NO Token-2022 seize detection, NO holder
// concentration, NO LP-lock check, and NO trusted-token allowlist. It runs on the
// SAME parsed mint the skill sees — a fair ablation of the input data, not a
// strawman. Its two blind spots are the whole point of the eval:
//   • false NO-GO on a blue-chip's by-design authority (USDC/USDT), and
//   • false GO on a Token-2022 seize power (renounced classic authorities, but a
//     live permanent delegate / hook / fee authority can still trap or drain an LP).

import { isNone } from "./http.js";
import type { MintInfo, Verdict } from "./types.js";

export function authorityOnlyBaseline(mint: MintInfo): Verdict {
  if (!isNone(mint.mintAuthority) || !isNone(mint.freezeAuthority)) return "NO-GO";
  return "GO";
}
