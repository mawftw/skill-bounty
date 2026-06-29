#!/usr/bin/env bash
set -euo pipefail

# install-smoke.sh — judge-simulation gate.
# A fresh install must make the skill DISCOVERABLE and its CLI RUNNABLE from an
# unrelated working directory — exactly what a judge does (clone → install → use
# from their own project). Guards against the packaging regression where install.sh
# only ran `npm ci` and never installed the skill/command into Claude Code.
#
# Needs network (install.sh runs `npm ci`). The CLI invocation itself is offline:
# it's fed an invalid address, so it errors before any RPC call.
#
# Run: npm run smoke   (or  bash scripts/install-smoke.sh)

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_NAME="solana-lp-safety"
CMD_NAME="lp-safety-check"

TMP_CLAUDE="$(mktemp -d)"     # throwaway ~/.claude — never touches the real one
TMP_CWD="$(mktemp -d)"        # stands in for "some other project" the judge is in
DEST="$TMP_CLAUDE/skills/$SKILL_NAME"
trap 'rm -rf "$TMP_CLAUDE" "$TMP_CWD"' EXIT

fail() { echo "  ✗ SMOKE FAIL: $*" >&2; exit 1; }
ok()   { echo "  ✓ $*"; }

echo "▶ install-smoke: fresh install into a throwaway dir, then invoke from an unrelated cwd"

# 1. Fresh install into the throwaway CLAUDE_DIR.
CLAUDE_DIR="$TMP_CLAUDE" bash "$REPO_DIR/install.sh" >/dev/null 2>&1 || fail "install.sh exited non-zero"

# 2. Discovery layout — skill + command must land where Claude Code actually looks.
test -f "$DEST/SKILL.md"                     || fail "SKILL.md not installed to $DEST"
test -f "$DEST/scripts/safety-check.ts"      || fail "CLI not bundled inside the skill dir"
test -x "$DEST/scripts/lp-safety-check-command.sh" || fail "slash-command wrapper not executable inside the skill dir"
test -x "$DEST/node_modules/.bin/tsx"        || fail "tsx runtime not bundled inside the skill dir"
test -f "$TMP_CLAUDE/commands/$CMD_NAME.md"  || fail "command not installed to commands/"
ok "skill + command installed to the discovery paths (~/.claude/skills, ~/.claude/commands)"

# 3. The command must have its absolute path baked in (no leftover template placeholder).
if grep -q '__SKILL_DIR__' "$TMP_CLAUDE/commands/$CMD_NAME.md"; then
  fail "command still contains an unsubstituted __SKILL_DIR__ placeholder"
fi
grep -qF "$DEST/scripts/lp-safety-check-command.sh" "$TMP_CLAUDE/commands/$CMD_NAME.md" \
  || fail "command does not reference the installed wrapper absolute path"
quoted_wrapper="\"$DEST/scripts/lp-safety-check-command.sh\""
if grep -qF "$quoted_wrapper" "$TMP_CLAUDE/commands/$CMD_NAME.md"; then
  fail "command quotes the allowlisted executable path; Claude Code matches allowed-tools literally"
fi
ok "command's CLI path baked to the installed skill dir"

# 4. Nothing under the installed skill may rely on the repo's sibling layout (../rules etc.).
if grep -rnE '\.\./(rules|scripts|commands)' "$DEST"/*.md; then
  fail "installed skill files still reference ../ siblings that don't exist after install"
fi
ok "installed skill files have no broken ../ references"

# 5. cwd-independence — invoke the bundled CLI from an UNRELATED dir. Offline: an invalid
#    address makes the CLI reject before any network call. The failure we're guarding against
#    is a resolution error (missing script / module / command), NOT the base58 rejection.
out="$(cd "$TMP_CWD" && "$DEST/scripts/lp-safety-check-command.sh" 'not-a-real-address' 2>&1 || true)"
case "$out" in
  *"Missing script"*|*"command not found"*|*"Cannot find module"*|*"No such file"*|*ENOENT*)
    fail "CLI failed to resolve from an unrelated cwd → $out" ;;
esac
echo "$out" | grep -qi 'base58' || fail "CLI ran but produced unexpected output from an unrelated cwd → $out"
ok "bundled CLI resolves + runs from an unrelated working directory"

echo "▶ install-smoke PASSED — installable + invocable as an Agent Skill from any project."
