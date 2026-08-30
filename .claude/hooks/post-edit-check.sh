#!/usr/bin/env bash
# PostToolUse hook: lint/format edited files (Write|Edit).
set -u
INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')
[ -z "$FILE" ] && exit 0
[ -f "$FILE" ] || exit 0

case "$FILE" in
  *.py)
    if ! command -v ruff >/dev/null 2>&1; then
      echo "post-edit-check: ruff не установлен, пропускаю проверку $FILE" >&2
      exit 0
    fi
    OUT=$(ruff check "$FILE" 2>&1)
    if [ $? -ne 0 ]; then
      echo "post-edit-check: ruff check провалился для $FILE:" >&2
      printf '%s\n' "$OUT" >&2
      exit 2
    fi
    ruff format "$FILE" >/dev/null 2>&1
    exit 0
    ;;
  *.ts|*.tsx|*.js|*.jsx)
    if ! command -v npx >/dev/null 2>&1; then
      echo "post-edit-check: npx не найден, пропускаю проверку $FILE" >&2
      exit 0
    fi
    # prettier: best-effort — сначала проверяем доступность, никогда не блокируем (exit 2) из-за prettier
    if npx --no-install prettier --version >/dev/null 2>&1; then
      npx --no-install prettier --write "$FILE" >/dev/null 2>&1 \
        || echo "post-edit-check: prettier упал на $FILE, пропускаю форматирование" >&2
    else
      echo "post-edit-check: prettier не установлен в проекте, пропускаю форматирование $FILE" >&2
    fi
    # eslint: сначала проверяем доступность; если не установлен — мягкий пропуск
    if ! npx --no-install eslint --version >/dev/null 2>&1; then
      echo "note: eslint not in project, skip $FILE" >&2
      exit 0
    fi
    ESLINT_OUT=$(npx --no-install eslint "$FILE" 2>&1)
    if [ $? -ne 0 ]; then
      echo "post-edit-check: eslint провалился для $FILE:" >&2
      printf '%s\n' "$ESLINT_OUT" >&2
      exit 2
    fi
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
