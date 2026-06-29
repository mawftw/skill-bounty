#!/usr/bin/env bash
set -uo pipefail

# Claude Code slash-command entrypoint.
# Keep the slash command itself to one allowlisted Bash executable; this wrapper
# preserves CLI output while preventing CAUTION/NO-GO exit codes from being read
# as command-block failures.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

"$SKILL_DIR/node_modules/.bin/tsx" "$SCRIPT_DIR/safety-check.ts" "$@" || true
