# solana-lp-safety-skill

This repository is a Claude Code / Solana AI Kit **Agent Skill**.

When a task involves providing, adding to, or rebalancing **liquidity** on a Solana AMM
(Meteora DLMM/DAMM v2, Raydium, Orca) and needs a safety / due-diligence read, load
**[skill/SKILL.md](skill/SKILL.md)** and follow its routing table.

Progressive disclosure: do **not** load the topic files under `skill/` eagerly — `SKILL.md`
routes to only the file each request needs.
