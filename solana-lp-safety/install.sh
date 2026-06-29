#!/usr/bin/env bash
set -euo pipefail

# solana-lp-safety-skill installer
# ---------------------------------
# Installs this repo as a real, self-contained Claude Code Agent Skill so it works
# from ANY project — not just from inside this clone:
#
#   • the skill (SKILL.md + topic files + the CLI + its runtime) is copied into
#     <claude-dir>/skills/solana-lp-safety/  → discoverable in every session,
#     and invocable by natural language or through /lp-safety-check
#   • the /lp-safety-check slash command is installed into <claude-dir>/commands/
#     with the skill's absolute path baked in, so it runs regardless of cwd
#
# Usage:
#   ./install.sh                     # personal install → ~/.claude (all projects)
#   CLAUDE_DIR=/tmp/x ./install.sh   # install into a custom dir (used by the smoke test)

# Resolve the repo root from this script's own location, so the installer works no
# matter what directory it's launched from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

SKILL_NAME="solana-lp-safety"
COMMAND_NAME="lp-safety-check"
CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"
SKILLS_DIR="$CLAUDE_DIR/skills"
COMMANDS_DIR="$CLAUDE_DIR/commands"
DEST="$SKILLS_DIR/$SKILL_NAME"

echo "Installing solana-lp-safety-skill → $DEST"

# 1. Require Node 20+ (claimed in the README — enforce it, don't just check presence).
if ! command -v node >/dev/null 2>&1; then
  echo "  ✗ Node.js not found — install Node 20+ first (https://nodejs.org)." >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "${NODE_MAJOR:-0}" -lt 20 ]; then
  echo "  ✗ Node 20+ required (found $(node -v 2>/dev/null))." >&2
  exit 1
fi

# 2. Install deps in the clone too, so repo-local dev usage (npm run validate / demo)
#    keeps working as the README documents.
if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi

# 3. Assemble a SELF-CONTAINED skill directory. Everything the skill references at
#    runtime lives under one root, so nothing depends on the clone staying around.
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$SCRIPT_DIR/skill/." "$DEST/"                 # SKILL.md + topic files at the skill root
cp -R "$SCRIPT_DIR/scripts" "$DEST/scripts"          # the CLI (safety-check.ts + lib/)
cp -R "$SCRIPT_DIR/rules" "$DEST/rules"              # api-key-safety.md (referenced by SKILL.md)
cp "$SCRIPT_DIR/package.json" "$SCRIPT_DIR/package-lock.json" "$SCRIPT_DIR/tsconfig.json" "$DEST/"

# 4. Install the CLI runtime (tsx) INSIDE the skill dir so the skill is self-sufficient.
#    Reuses npm's cache from step 2, so this is fast (no second download).
( cd "$DEST" && npm ci --no-audit --no-fund --silent )

# 5. Install the slash command, baking the skill's absolute path so the command's
#    bash block resolves the CLI from any working directory.
mkdir -p "$COMMANDS_DIR"
# Bash-native literal substitution (no sed) so a destination path containing sed
# metacharacters (&, |, \) can never corrupt the generated command file.
cmd_template="$(cat "$SCRIPT_DIR/commands/$COMMAND_NAME.md")"
printf '%s\n' "${cmd_template//__SKILL_DIR__/$DEST}" > "$COMMANDS_DIR/$COMMAND_NAME.md"

# 6. Post-install sanity check — fail loudly if anything didn't land.
test -f "$DEST/SKILL.md"                     || { echo "  ✗ SKILL.md missing in $DEST" >&2; exit 1; }
test -f "$DEST/scripts/safety-check.ts"      || { echo "  ✗ CLI missing in $DEST/scripts" >&2; exit 1; }
test -x "$DEST/scripts/lp-safety-check-command.sh" || { echo "  ✗ command wrapper missing in $DEST/scripts" >&2; exit 1; }
test -x "$DEST/node_modules/.bin/tsx"        || { echo "  ✗ tsx runtime missing in $DEST/node_modules" >&2; exit 1; }
test -f "$COMMANDS_DIR/$COMMAND_NAME.md"     || { echo "  ✗ command missing in $COMMANDS_DIR" >&2; exit 1; }

echo
echo "Done."
echo "  ✓ Skill    → $DEST/SKILL.md"
echo "  ✓ Command  → $COMMANDS_DIR/$COMMAND_NAME.md"
echo
echo "Restart Claude Code (or start a new session) so it picks up the skill, then:"
echo "  • /lp-safety-check <POOL_OR_MINT_ADDRESS>"
echo "  • or ask: \"is it safe to LP into this Meteora pool: <addr>?\""
echo
echo "Repo-local dev (from this clone): npm run safety-check -- <addr> · npm run validate"
echo "Optional API key for richer holder data: cp .env.example .env   (works keyless otherwise)"
