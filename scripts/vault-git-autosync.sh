#!/bin/bash
# Vault → GitHub auto-sync.
# Commits any new/changed vault files and pushes them to the private obsidian-vault
# repo, which is what the user's Obsidian pulls from. This mechanism lived as an
# ad-hoc cron on the old server and was lost during the May 2026 Russia migration,
# which silently stopped meeting transcriptions from reaching Obsidian for ~7 weeks.
# Kept in the repo so it survives future server moves (installed by deploy.yml).
#
# The server and the user's Obsidian are two writers of the same repo, so we
# reconcile before pushing and, on conflict, prefer the remote (the user's manual
# Obsidian edits win) — the server only needs to contribute newly generated files.
set -uo pipefail

VAULT_DIR="${VAULT_DIR:-/var/www/kanban-app/vault}"
LOG="/var/log/vault-git-autosync.log"
GA=(-c user.email=server@clarity-space.ru -c user.name="Clarity Space Server")

exec 9>/tmp/vault-git-autosync.lock
flock -n 9 || { echo "$(date '+%F %T') busy, skip" >> "$LOG"; exit 0; }

cd "$VAULT_DIR" || { echo "$(date '+%F %T') no vault: $VAULT_DIR" >> "$LOG"; exit 1; }

# 1. Commit local (server-generated) changes
if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git "${GA[@]}" commit -m "auto-sync $(date +%Y-%m-%d_%H:%M)" >> "$LOG" 2>&1 || true
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"

# 2. Reconcile with remote; on conflict prefer remote (user's Obsidian edits win).
#    If the merge still fails, abort cleanly and retry next run rather than corrupt.
git fetch origin --quiet 2>>"$LOG"
if [ -n "$(git rev-list HEAD..origin/"$BRANCH" 2>/dev/null)" ]; then
  git "${GA[@]}" merge --no-edit -X theirs "origin/$BRANCH" >> "$LOG" 2>&1 || {
    git merge --abort 2>/dev/null
    echo "$(date '+%F %T') merge aborted, will retry" >> "$LOG"
    exit 0
  }
fi

# 3. Push if we are ahead
if [ -n "$(git rev-list origin/"$BRANCH"..HEAD 2>/dev/null)" ]; then
  if git push origin "$BRANCH" >> "$LOG" 2>&1; then
    echo "$(date '+%F %T') pushed to origin/$BRANCH" >> "$LOG"
  else
    echo "$(date '+%F %T') push FAILED (check token/network)" >> "$LOG"
  fi
fi
