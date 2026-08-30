#!/usr/bin/env bash
# Stop hook: runs project tests before allowing Claude to stop.
set -u
INPUT=$(cat)

# Loop protection layer (a): stop_hook_active flag from Claude Code.
ACTIVE=$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)
[ "$ACTIVE" = "true" ] && exit 0

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# Loop protection layer (b): marker file younger than 10 minutes.
MARKER="$PROJECT_DIR/.claude/hooks/.stop-gate-running"
if [ -f "$MARKER" ]; then
  NOW=$(date +%s)
  MTIME=$(stat -c %Y "$MARKER" 2>/dev/null || echo 0)
  AGE=$(( NOW - MTIME ))
  if [ "$AGE" -lt 600 ]; then
    exit 0
  fi
fi

CONFIG="$PROJECT_DIR/.claude/hooks/config.env"
[ -f "$CONFIG" ] || exit 0
# shellcheck disable=SC1090
. "$CONFIG"
[ -n "${TEST_COMMAND:-}" ] || exit 0

cd "$PROJECT_DIR" || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

CHANGED=$(git status --porcelain 2>/dev/null | grep -E '\.(py|ts|tsx|js|jsx|go|rs)$' || true)
[ -z "$CHANGED" ] && exit 0

mkdir -p "$(dirname "$MARKER")"
touch "$MARKER"
trap 'rm -f "$MARKER"' EXIT

OUT=$(timeout 300 bash -c "$TEST_COMMAND" 2>&1)
RC=$?
if [ $RC -ne 0 ]; then
  echo "stop-gate: тесты провалились (TEST_COMMAND=$TEST_COMMAND, rc=$RC). Последние 50 строк:" >&2
  printf '%s\n' "$OUT" | tail -n 50 >&2
  exit 2
fi
exit 0
