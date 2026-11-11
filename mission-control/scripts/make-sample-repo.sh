#!/usr/bin/env bash
# Creates ./sample-repo: a small throwaway Git repo the factory works on (labs never touch company code).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$ROOT/sample-repo"
[ -d "$REPO/.git" ] && { echo "sample-repo already exists"; exit 0; }
mkdir -p "$REPO/src/ui" "$REPO/src/core"
cat > "$REPO/README.md" <<'MD'
# Sample repo for the Axiom Software Factory workshop
Throwaway code for agents to work on. Fences in fences.json protect src/core/auth.ts and block process spawning in src/ui/.
MD
cat > "$REPO/src/ui/checkout_helper.py" <<'PY'
def format_total(cents: int) -> str:
    return f"€{cents / 100:.2f}"
PY
cat > "$REPO/src/core/auth.ts" <<'TS'
// Immutable auth session contract (HARD_LOCK fence)
export interface Session { userId: string; expiresAt: number }
TS
git -C "$REPO" init -q && git -C "$REPO" add . && git -C "$REPO" -c user.name=axiom -c user.email=axiom@example.invalid commit -qm "sample repo"
echo "created $REPO"
