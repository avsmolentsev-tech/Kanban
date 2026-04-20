#!/usr/bin/env bash
# Daily mirror of /var/www/kanban-app/vault/user_2/*.md → Slava's Google Drive "Obsidian" folder.
# Append + update semantics: never deletes files from Drive.
set -euo pipefail

SRC="/var/www/kanban-app/vault/user_2"
DST_ROOT="1UJ_GSCrisPe-SPV_7aDKihlfgATCCwtP"
CACHE_DIR="/var/lib/backup-obsidian"
FOLDERS_CACHE="$CACHE_DIR/folder-map.tsv"
FILES_CACHE="$CACHE_DIR/file-times.tsv"
LOG="/var/log/backup-obsidian-md.log"
ACCOUNT="avsmolentsev@gmail.com"

mkdir -p "$CACHE_DIR"
touch "$FOLDERS_CACHE" "$FILES_CACHE"

if [ -z "${GOG_KEYRING_PASSWORD:-}" ] && [ -f /root/.openclaw/.env ]; then
  GOG_KEYRING_PASSWORD="$(grep '^GOG_KEYRING_PASSWORD=' /root/.openclaw/.env | tail -n1 | cut -d= -f2-)"
  export GOG_KEYRING_PASSWORD
fi

log() { echo "[$(date -u +%FT%TZ)] $*" >> "$LOG"; }

ensure_folder() {
  local rel="$1"
  if [ -z "$rel" ] || [ "$rel" = "." ]; then echo "$DST_ROOT"; return; fi
  local cached
  cached="$(awk -F'\t' -v r="$rel" '$1==r{print $2}' "$FOLDERS_CACHE" | head -1)"
  if [ -n "$cached" ]; then echo "$cached"; return; fi
  local parent_rel parent_id name id
  parent_rel="$(dirname "$rel")"
  [ "$parent_rel" = "." ] && parent_rel=""
  parent_id="$(ensure_folder "$parent_rel")"
  name="$(basename "$rel")"
  id="$(gog drive mkdir "$name" --parent "$parent_id" --account "$ACCOUNT" --plain 2>>"$LOG" | awk 'NR==1{print $1}')"
  if [ -z "$id" ]; then
    log "ERROR: mkdir failed for '$rel'"
    exit 1
  fi
  printf "%s\t%s\n" "$rel" "$id" >> "$FOLDERS_CACHE"
  echo "$id"
}

upload_file() {
  local abs="$1" rel="$2"
  local mtime
  mtime="$(stat -c '%Y' "$abs")"
  local cached
  cached="$(awk -F'\t' -v r="$rel" '$1==r{print $2"\t"$3}' "$FILES_CACHE" | head -1)"
  local cached_id cached_mtime
  cached_id="$(echo "$cached" | cut -f1)"
  cached_mtime="$(echo "$cached" | cut -f2)"
  if [ -n "$cached_id" ] && [ "$cached_mtime" = "$mtime" ]; then
    return
  fi
  local parent_rel parent_id
  parent_rel="$(dirname "$rel")"
  [ "$parent_rel" = "." ] && parent_rel=""
  parent_id="$(ensure_folder "$parent_rel")"
  if [ -n "$cached_id" ]; then
    gog drive rm "$cached_id" --account "$ACCOUNT" --plain -y >>"$LOG" 2>&1 || true
  fi
  local new_id
  new_id="$(gog drive upload "$abs" --parent "$parent_id" --account "$ACCOUNT" --plain 2>>"$LOG" | awk 'NR==1{print $1}')"
  if [ -z "$new_id" ]; then
    log "ERROR: upload failed for '$rel'"
    return
  fi
  grep -v -P "^$(printf '%s' "$rel" | sed 's/[][\.^$*?|(){}\\]/\\&/g')\t" "$FILES_CACHE" > "$FILES_CACHE.tmp" || true
  mv "$FILES_CACHE.tmp" "$FILES_CACHE"
  printf "%s\t%s\t%s\n" "$rel" "$new_id" "$mtime" >> "$FILES_CACHE"
  log "UPLOADED $rel"
}

log "backup start"
if [ ! -d "$SRC" ]; then log "FATAL: src not found: $SRC"; exit 1; fi

while IFS= read -r dir; do
  rel="${dir#$SRC}"; rel="${rel#/}"
  case "$rel" in .git|.git/*|.trash|.trash/*|.obsidian|.obsidian/*) continue ;; esac
  ensure_folder "$rel" > /dev/null
done < <(find "$SRC" -type d \( -name .git -o -name .trash -o -name .obsidian \) -prune -o -type d -print)

while IFS= read -r f; do
  rel="${f#$SRC/}"
  upload_file "$f" "$rel"
done < <(find "$SRC" -type d \( -name .git -o -name .trash -o -name .obsidian \) -prune -o -type f -name '*.md' -print)

log "backup done"
