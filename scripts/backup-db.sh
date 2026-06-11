#!/bin/bash
# Backup semanal de la base de datos Supabase (proyecto IFS) a iCloud.
# La password de la DB se lee del Keychain (item "Abordaje DB Backup").
# Automatizado via launchd: ~/Library/LaunchAgents/com.ifs.abordaje-db-backup.plist
# (la copia que ejecuta launchd vive en ~/bin/abordaje-backup-db.sh — este archivo
#  del repo es la fuente; si se modifica, copiarlo a ~/bin).
#
# IMPORTANTE (TCC/macOS): launchd solo tiene permiso sobre la carpeta de iCloud
# para bash/cp/cat/rm — NO para gzip ni find. Por eso el dump y la compresion
# se hacen en un staging local y a iCloud solo se copia el .gz final con cp.
set -euo pipefail

PG_DUMP="/opt/homebrew/opt/libpq/bin/pg_dump"
DB_URL="postgresql://postgres.hxjpnekzncqepbhpdkfv@aws-1-sa-east-1.pooler.supabase.com:5432/postgres"
DEST="$HOME/Library/Mobile Documents/com~apple~CloudDocs/IFS/Backups Abordaje DB"
RETENTION_DAYS=90

STAMP="$(date +%Y-%m-%d)"
STAGE="$(mktemp -d /tmp/abordaje-backup.XXXXXX)"
trap 'rm -rf "$STAGE"' EXIT

PGPASSWORD="$(security find-generic-password -a abordaje -s 'Abordaje DB Backup' -w)" \
  "$PG_DUMP" "$DB_URL" \
  --no-owner --no-privileges \
  -n public -n private -n comisiones -n patrimoniales -n auth -n supabase_migrations \
  -f "$STAGE/dump.sql"

gzip -f "$STAGE/dump.sql"
SIZE="$(du -h "$STAGE/dump.sql.gz" | cut -f1 | tr -d ' ')"

[ -d "$DEST" ] || mkdir -p "$DEST"
cp "$STAGE/dump.sql.gz" "$DEST/ifs-db_${STAMP}.sql.gz"

# Retencion por fecha en el nombre de archivo (sin find, ver nota TCC arriba)
CUTOFF="$(date -v-${RETENTION_DAYS}d +%Y-%m-%d)"
for f in "$DEST"/ifs-db_*.sql.gz; do
  [ -e "$f" ] || continue
  base="${f##*/}"; d="${base#ifs-db_}"; d="${d%.sql.gz}"
  [[ "$d" < "$CUTOFF" ]] && rm -f "$f"
done

echo "$(date '+%Y-%m-%d %H:%M:%S') OK $SIZE" >> "$DEST/backup.log"
