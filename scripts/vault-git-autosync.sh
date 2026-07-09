#!/bin/bash
# Vault → GitHub auto-sync.
# Commits any new/changed vault files and pushes them to the obsidian-vault repo,
# which is what the user's Obsidian pulls from. This mechanism lived as an ad-hoc
# cron on the old server and was lost during the May 2026 Russia migration, which
# silently stopped meeting transcriptions from reaching Obsidian. Keep it in the
# repo so it survives future server moves (installed by .github/workflows/deploy.yml).
set -euo pipefail

VAULT_DIR="${VAULT_DIR:-/var/www/kanban-app/vault}"
LOG="/var/log/vault-git-autosync.log"
LOCK="/tmp/vault-git-autosync.lock"

# Prevent overlapping runs
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "$(date '+%F %T') another run in progress, skipping" >> "$LOG"
  exit 0
fi

cd "$VAULT_DIR" || { echo "$(date '+%F %T') vault dir missing: $VAULT_DIR" >> "$LOG"; exit 1; }

# Nothing to do if the tree is clean
if [ -z "$(git status --porcelain)" ]; then
  exit 0
fi

git add -A
git commit -m "auto-sync $(date +%Y-%m-%d_%H:%M)" >> "$LOG" 2>&1 || true

# Push current branch; log failures but never exit non-zero (cron noise)
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if git push origin "$BRANCH" >> "$LOG" 2>&1; then
  echo "$(date '+%F %T') pushed to origin/$BRANCH" >> "$LOG"
else
  echo "$(date '+%F %T') push FAILED (check token/network)" >> "$LOG"
fi
