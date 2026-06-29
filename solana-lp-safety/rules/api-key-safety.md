# Rule: API key safety

- **Never hardcode** API keys (Helius, Solana Tracker, etc.) in source, commits, or skill output.
- Read keys from **environment variables only** (`HELIUS_API_KEY`, `SOLANA_TRACKER_API_KEY`).
- Keep a `.env` (gitignored); ship `.env.example` with placeholder names only.
- Prefer **keyless sources** (RugCheck public, public RPC, GoPlus) when no key is set; degrade
  gracefully and explicitly report which sources were skipped.
- Never echo a key back to the user or include it in logs / reports.
