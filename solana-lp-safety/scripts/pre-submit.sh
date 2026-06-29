#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "  ✗ $*" >&2; exit 1; }
ok() { echo "  ✓ $*"; }

echo "▶ pre-submit: identity, remote, and reproducibility checks"

git diff --quiet || fail "working tree has unstaged changes"
git diff --cached --quiet || fail "index has staged but uncommitted changes"
ok "working tree clean"

email="$(git config --get user.email || true)"
case "$email" in
  *mawftw@users.noreply.github.com) ok "git email is mawftw noreply" ;;
  *) fail "git email is not mawftw noreply: ${email:-<unset>}" ;;
esac

if ! gh auth status >/dev/null 2>&1; then
  fail "gh is not authenticated"
fi
if ! gh auth status 2>&1 | grep -q "account mawftw"; then
  fail "gh is not authenticated as mawftw"
fi
ok "gh authenticated as mawftw"

remote="$(git remote get-url origin 2>/dev/null || true)"
[ -n "$remote" ] || fail "origin remote is missing"
case "$remote" in
  *mawftw/solana-lp-safety-skill*) ok "origin points at mawftw/solana-lp-safety-skill" ;;
  *) fail "origin does not point at mawftw/solana-lp-safety-skill: $remote" ;;
esac

npm run validate
npm run smoke
npm audit --audit-level=high

echo "▶ pre-submit PASSED — ready to push and verify GitHub Actions."
