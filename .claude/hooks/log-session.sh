#!/usr/bin/env bash
# log-session.sh — асинхронный Stop-хук: журнал работы агента.
# Пишет строку "YYYY-MM-DD HH:MM | <проект> | <фрагмент ответа>"
# в $HOME/logs/agent-work.log. Никогда не блокирует: любой сбой -> exit 0.
{
  input=$(cat 2>/dev/null || true)
  excerpt=$(printf "%s" "$input" | jq -r '.last_assistant_message // ""' 2>/dev/null | tr "\n" " " | cut -c1-160)
  project=$(basename "${CLAUDE_PROJECT_DIR:-$(pwd)}")
  mkdir -p "$HOME/logs"
  printf "%s | %s | %s\n" "$(date +"%Y-%m-%d %H:%M")" "$project" "$excerpt" >> "$HOME/logs/agent-work.log"
} >/dev/null 2>&1 || true
exit 0
