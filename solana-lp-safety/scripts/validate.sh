#!/usr/bin/env bash
# Offline, deterministic validation gate — the SAME checks CI runs as its blocking
# steps, runnable by anyone with no network and no API key. A judge can clone, run
# `npm run validate`, and reproduce the green result in seconds.
#
#   npm run validate           # or: bash scripts/validate.sh
#
# Blocking gates (all offline):
#   1. typecheck
#   2. offline tests — 88 unit + 19 integration + hard-fail recall
#   3. signature demo — real captures, fetch disabled
#   4. secret / .env hygiene — no key or RPC URL ever committed
#   5. zero runtime dependencies — minimal supply-chain attack surface
#
# The LIVE eval (`npm run eval`) and `npm audit` need network and run in CI only;
# they are informational, never merge-blocking (live chain state can drift).
set -uo pipefail
cd "$(dirname "$0")/.."

pass=0; fail=0
step() {
  local name="$1"; shift
  printf '\n\033[1m▶ %s\033[0m\n' "$name"
  if "$@"; then printf '\033[32m  ✓ %s\033[0m\n' "$name"; pass=$((pass+1));
  else printf '\033[31m  ✗ %s\033[0m\n' "$name"; fail=$((fail+1)); fi
}

# --- 4. secret / .env hygiene (no network) --------------------------------------
# Scans only what would actually be COMMITTED — git-tracked files (the local,
# gitignored .env with the real key is correctly out of scope). Patterns: a
# Helius-style api-key in a URL, or a bare UUID (Helius keys are UUIDs). Sanitized
# fixtures key on method+params, so they never carry the RPC URL or its key.
SECRET_PATTERNS=(
  -e 'api-key=[A-Za-z0-9][A-Za-z0-9_-]{15,}'
  -e '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
)
secret_scan() {
  local bad=0 hits=""
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    # .env must never be tracked; it must be gitignored.
    if git ls-files --error-unmatch .env >/dev/null 2>&1; then
      echo "  ✗ .env is tracked by git — it must be gitignored"; bad=1; fi
    if ! git check-ignore -q .env; then
      echo "  ✗ .env is not gitignored"; bad=1; fi
    # Scan TRACKED files only — exactly the bytes that ship.
    hits=$(git grep -IEn "${SECRET_PATTERNS[@]}" -- ':!package-lock.json' 2>/dev/null || true)
  else
    # No git context (e.g. a tarball): scan the tree, excluding local-only secrets.
    hits=$(grep -rIEn "${SECRET_PATTERNS[@]}" \
      --exclude-dir=node_modules --exclude-dir=.git \
      --exclude=package-lock.json --exclude='.env' --exclude='.env.*' --exclude='*.log' . 2>/dev/null || true)
  fi
  if [ -n "$hits" ]; then
    echo "  ✗ possible secret/api-key literal in a committed file:"; echo "$hits" | sed 's/^/      /'; bad=1; fi
  [ "$bad" -eq 0 ] && echo "  no secrets in tracked files; .env gitignored & untracked"
  return $bad
}

# --- 5. zero runtime dependencies (no network) ----------------------------------
zero_runtime_deps() {
  node -e 'const d=require("./package.json").dependencies||{};const n=Object.keys(d).length;if(n){console.error("  runtime dependencies present: "+n);process.exit(1)}console.log("  dependencies: {} — read-only, no runtime packages")'
}

echo "════════════════════════════════════════════════════════════════"
echo "  solana-lp-safety-skill — offline validation gate"
echo "════════════════════════════════════════════════════════════════"

step "typecheck"            npm run --silent typecheck
step "offline tests"       npm test
step "signature demo"      npm run --silent demo
step "secret / .env scan"  secret_scan
step "zero runtime deps"   zero_runtime_deps

echo
echo "════════════════════════════════════════════════════════════════"
if [ "$fail" -ne 0 ]; then
  printf '\033[31m  VALIDATION FAILED — %d gate(s) failed, %d passed.\033[0m\n' "$fail" "$pass"
  echo "════════════════════════════════════════════════════════════════"
  exit 1
fi
printf '\033[32m  VALIDATION PASSED — all %d offline gates green (no network, no key).\033[0m\n' "$pass"
echo "════════════════════════════════════════════════════════════════"
