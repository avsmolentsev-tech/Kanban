#!/usr/bin/env bash
# PreToolUse guard: blocks dangerous Bash commands by pattern list.
set -u
INPUT=$(cat)
command -v jq >/dev/null 2>&1 || { echo "guard.sh: jq не установлен — блокирую команду из предосторожности (apt install jq)" >&2; exit 2; }
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')
[ -z "$CMD" ] && exit 0
PATTERNS="${CLAUDE_PROJECT_DIR:-$(pwd)}/.claude/hooks/guard-patterns.txt"
[ -f "$PATTERNS" ] || exit 0
while IFS= read -r pat; do
  case "$pat" in ''|'#'*) continue ;; esac
  if printf '%s' "$CMD" | grep -qiE -- "$pat"; then
    echo "BLOCKED by guard.sh: команда совпала с запрещённым паттерном: $pat" >&2
    exit 2
  fi
done < "$PATTERNS"
exit 0
