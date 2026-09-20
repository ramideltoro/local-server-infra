#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

export RCLONE_CONFIG="/home/rami/.config/rclone/rclone.conf"

CONFIG_FILE="/etc/nutsnews-backup/nutsnews-db-backup.env"
LOG_FILE="/var/log/nutsnews-db-backup.log"
METRICS_DIR="/var/lib/node_exporter/textfile_collector"
METRICS_FILE="${METRICS_DIR}/nutsnews_db_backup.prom"
METRICS_TMP_FILE="${METRICS_FILE}.tmp"
SIZE_BYTES="0"
FILE_COUNT="0"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "ERROR: Missing config file: $CONFIG_FILE" >&2
  exit 1
fi

set -a
source "$CONFIG_FILE"
set +a

: "${DATABASE_URL:?Missing DATABASE_URL}"
: "${REMOTE_NAME:?Missing REMOTE_NAME}"
: "${REMOTE_PATH:?Missing REMOTE_PATH}"
: "${LOCAL_BACKUP_DIR:?Missing LOCAL_BACKUP_DIR}"
: "${KEEP_DAILY_DAYS:?Missing KEEP_DAILY_DAYS}"
: "${KEEP_WEEKLY_WEEKS:?Missing KEEP_WEEKLY_WEEKS}"
: "${KEEP_MONTHLY_MONTHS:?Missing KEEP_MONTHLY_MONTHS}"

START_TS="$(date +%s)"
BACKUP_TS="$(date +%Y-%m-%d_%H-%M-%S)"
BACKUP_NAME="nutsnews-db-${BACKUP_TS}"
WORK_DIR="${LOCAL_BACKUP_DIR}/${BACKUP_NAME}"
REMOTE_BASE="${REMOTE_NAME}:${REMOTE_PATH}"
REMOTE_DIR="${REMOTE_BASE}/${BACKUP_NAME}"

mkdir -p "$LOCAL_BACKUP_DIR"
mkdir -p "$WORK_DIR/metadata"

exec > >(tee -a "$LOG_FILE") 2>&1

log() {
  echo "[$(date --iso-8601=seconds)] $*"
}

write_metrics() {
  local success="$1"
  local end_ts
  local duration
  local cloud_backups
  local cloud_count
  local latest_backup
  local latest_backup_ts
  local next_raw
  local next_ts
  local timer_enabled
  local timer_active
  local service_active

  end_ts="$(date +%s)"
  duration="$((end_ts - START_TS))"

  mkdir -p "$METRICS_DIR"

  cloud_backups="$(rclone lsf "$REMOTE_BASE" --dirs-only 2>/dev/null | awk '{ sub(/\/$/, ""); print }' | sort || true)"
  cloud_count="$(printf "%s\n" "$cloud_backups" | sed "/^$/d" | wc -l | tr -d " ")"
  latest_backup="$(printf "%s\n" "$cloud_backups" | sed "/^$/d" | sort | tail -n 1)"

  latest_backup_ts="0"
  if [[ -n "$latest_backup" ]]; then
    latest_backup_ts="$(
      printf "%s" "$latest_backup"         | sed -E "s/^nutsnews-db-([0-9]{4}-[0-9]{2}-[0-9]{2})_([0-9]{2})-([0-9]{2})-([0-9]{2})$/\1 \2:\3:\4/"         | xargs -I{} date -d "{}" +%s 2>/dev/null || echo 0
    )"
  fi

  next_raw="$(systemctl show -P NextElapseUSecRealtime nutsnews-db-backup.timer 2>/dev/null || true)"
  next_ts="0"
  if [[ -n "$next_raw" && "$next_raw" != "n/a" ]]; then
    next_ts="$(date -d "$next_raw" +%s 2>/dev/null || echo 0)"
  fi

  if systemctl is-enabled nutsnews-db-backup.timer >/dev/null 2>&1; then
    timer_enabled="1"
  else
    timer_enabled="0"
  fi

  if systemctl is-active nutsnews-db-backup.timer >/dev/null 2>&1; then
    timer_active="1"
  else
    timer_active="0"
  fi

  if systemctl is-active nutsnews-db-backup.service >/dev/null 2>&1; then
    service_active="1"
  else
    service_active="0"
  fi

  cat > "$METRICS_TMP_FILE" <<METRICS
# HELP nutsnews_db_backup_last_success Whether the last NutsNews database backup succeeded. 1 means success, 0 means failure.
# TYPE nutsnews_db_backup_last_success gauge
nutsnews_db_backup_last_success ${success}

# HELP nutsnews_db_backup_last_run_timestamp_seconds Unix timestamp of the last NutsNews database backup run.
# TYPE nutsnews_db_backup_last_run_timestamp_seconds gauge
nutsnews_db_backup_last_run_timestamp_seconds ${end_ts}

# HELP nutsnews_db_backup_last_duration_seconds Duration of the last NutsNews database backup run in seconds.
# TYPE nutsnews_db_backup_last_duration_seconds gauge
nutsnews_db_backup_last_duration_seconds ${duration}

# HELP nutsnews_db_backup_last_size_bytes Size of the last local NutsNews database backup folder before upload and cleanup.
# TYPE nutsnews_db_backup_last_size_bytes gauge
nutsnews_db_backup_last_size_bytes ${SIZE_BYTES}

# HELP nutsnews_db_backup_last_file_count Number of files in the last NutsNews database backup folder.
# TYPE nutsnews_db_backup_last_file_count gauge
nutsnews_db_backup_last_file_count ${FILE_COUNT}

# HELP nutsnews_db_backup_cloud_available_count Number of NutsNews database backup folders currently available in OneDrive.
# TYPE nutsnews_db_backup_cloud_available_count gauge
nutsnews_db_backup_cloud_available_count ${cloud_count}

# HELP nutsnews_db_backup_latest_cloud_backup_timestamp_seconds Timestamp parsed from the latest NutsNews database cloud backup folder name.
# TYPE nutsnews_db_backup_latest_cloud_backup_timestamp_seconds gauge
nutsnews_db_backup_latest_cloud_backup_timestamp_seconds ${latest_backup_ts}

# HELP nutsnews_db_backup_next_run_timestamp_seconds Unix timestamp of the next scheduled NutsNews database backup run.
# TYPE nutsnews_db_backup_next_run_timestamp_seconds gauge
nutsnews_db_backup_next_run_timestamp_seconds ${next_ts}

# HELP nutsnews_db_backup_timer_enabled Whether the NutsNews database backup timer is enabled. 1 means enabled.
# TYPE nutsnews_db_backup_timer_enabled gauge
nutsnews_db_backup_timer_enabled ${timer_enabled}

# HELP nutsnews_db_backup_timer_active Whether the NutsNews database backup timer is active. 1 means active.
# TYPE nutsnews_db_backup_timer_active gauge
nutsnews_db_backup_timer_active ${timer_active}

# HELP nutsnews_db_backup_service_active Whether the NutsNews database backup service is currently running. 1 means running.
# TYPE nutsnews_db_backup_service_active gauge
nutsnews_db_backup_service_active ${service_active}

# HELP nutsnews_db_backup_status_metrics_last_update_timestamp_seconds Unix timestamp when NutsNews database backup metrics were last refreshed.
# TYPE nutsnews_db_backup_status_metrics_last_update_timestamp_seconds gauge
nutsnews_db_backup_status_metrics_last_update_timestamp_seconds ${end_ts}
METRICS

  mv "$METRICS_TMP_FILE" "$METRICS_FILE"
  chmod 644 "$METRICS_FILE"
}

finish() {
  local rc=$?
  if [[ "$rc" -eq 0 ]]; then
    write_metrics 1 || true
    log "Backup completed successfully: ${BACKUP_NAME}"
  else
    write_metrics 0 || true
    log "ERROR: Backup failed with exit code ${rc}"
    log "Local backup folder kept for debugging: ${WORK_DIR}"
  fi
  exit "$rc"
}
trap finish EXIT

log "Starting NutsNews DB backup: ${BACKUP_NAME}"

log "Checking database connection..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "select now();" >/dev/null

log "Checking encrypted OneDrive remote..."
rclone mkdir "$REMOTE_BASE"
rclone lsd "$REMOTE_NAME:" >/dev/null

log "Writing metadata..."
{
  echo "backup_name=${BACKUP_NAME}"
  echo "created_at=$(date --iso-8601=seconds)"
  echo "server=$(hostname)"
  echo "remote_dir=${REMOTE_DIR}"
  echo "scope=complete public schema and data; auth schema only; roles without passwords; extension prerequisites"
} > "$WORK_DIR/metadata/backup-info.txt"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "select count(*) from public.articles;" > "$WORK_DIR/metadata/articles.count"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "select count(*) from public.rss_feeds;" > "$WORK_DIR/metadata/rss_feeds.count"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "select count(*) from public.article_ai_reviews;" > "$WORK_DIR/metadata/article_ai_reviews.count"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "select count(*) from public.article_summaries;" > "$WORK_DIR/metadata/article_summaries.count"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "select count(*) from public.ai_usage_runs;" > "$WORK_DIR/metadata/ai_usage_runs.count"

log "Archiving schema dependencies without role passwords or authentication rows..."
pg_dumpall --database="$DATABASE_URL" --roles-only --no-role-passwords > "$WORK_DIR/metadata/roles.sql"
pg_dump "$DATABASE_URL" --schema-only --schema=auth --no-owner --no-privileges > "$WORK_DIR/metadata/auth-schema.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "SELECT 'CREATE SCHEMA IF NOT EXISTS ' || quote_ident(n.nspname) || '; CREATE EXTENSION IF NOT EXISTS ' || quote_ident(e.extname) || ' WITH SCHEMA ' || quote_ident(n.nspname) || ';' FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname IN ('pg_trgm','pgcrypto','uuid-ossp');" > "$WORK_DIR/metadata/extensions.sql"
log "Creating complete public-schema SQL backup..."
pg_dump "$DATABASE_URL" \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists \
  --schema=public \
  | gzip -9 > "$WORK_DIR/nutsnews-db-public-tables.sql.gz"

log "Validating gzip archive..."
gzip -t "$WORK_DIR/nutsnews-db-public-tables.sql.gz"

log "Writing checksums..."
find "$WORK_DIR" -type f \
  ! -name SHA256SUMS \
  -print0 | sort -z | xargs -0 sha256sum > "$WORK_DIR/SHA256SUMS"

SIZE_BYTES="$(du -sb "$WORK_DIR" | awk '{print $1}')"
FILE_COUNT="$(find "$WORK_DIR" -type f | wc -l | tr -d " ")"

log "Uploading backup to encrypted OneDrive remote: ${REMOTE_DIR}"
rclone copy "$WORK_DIR" "$REMOTE_DIR" \
  --checksum \
  --transfers 4 \
  --checkers 8

log "Verifying upload..."
rclone check "$WORK_DIR" "$REMOTE_DIR" \
  --checksum \
  --one-way

log "Applying remote retention policy..."
DELETE_LIST="$(
  rclone lsf "$REMOTE_BASE" --dirs-only 2>/dev/null \
    | awk '{ sub(/\/$/, ""); print }' \
    | KEEP_CURRENT="$BACKUP_NAME" \
      KEEP_DAILY_DAYS="$KEEP_DAILY_DAYS" \
      KEEP_WEEKLY_WEEKS="$KEEP_WEEKLY_WEEKS" \
      KEEP_MONTHLY_MONTHS="$KEEP_MONTHLY_MONTHS" \
      python3 -c '
import os
import re
import sys
from datetime import date, datetime, timedelta

current = os.environ["KEEP_CURRENT"]
daily_days = int(os.environ["KEEP_DAILY_DAYS"])
weekly_weeks = int(os.environ["KEEP_WEEKLY_WEEKS"])
monthly_months = int(os.environ["KEEP_MONTHLY_MONTHS"])

today = date.today()
daily_cutoff = today - timedelta(days=daily_days)
weekly_cutoff = today - timedelta(days=weekly_weeks * 7)
monthly_cutoff = today - timedelta(days=monthly_months * 31)

pattern = re.compile(r"^nutsnews-db-(\d{4}-\d{2}-\d{2})_\d{2}-\d{2}-\d{2}$")

for line in sys.stdin:
    name = line.strip()
    if not name or name == current:
        continue

    match = pattern.match(name)
    if not match:
        continue

    backup_date = datetime.strptime(match.group(1), "%Y-%m-%d").date()

    keep = False

    if backup_date >= daily_cutoff:
        keep = True

    if backup_date.weekday() == 6 and backup_date >= weekly_cutoff:
        keep = True

    if backup_date.day == 1 and backup_date >= monthly_cutoff:
        keep = True

    if not keep:
        print(name)
'
)"

if [[ -n "$DELETE_LIST" ]]; then
  while IFS= read -r old_backup; do
    [[ -z "$old_backup" ]] && continue
    log "Deleting expired remote backup: ${old_backup}"
    rclone purge "${REMOTE_BASE}/${old_backup}"
  done <<< "$DELETE_LIST"
else
  log "No expired remote backups to delete."
fi

log "Cleaning local backup folder from server..."
rm -rf "$WORK_DIR"

log "Cleaning old leftover local backup folders..."
find "$LOCAL_BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name "nutsnews-db-*" -mtime +2 -exec rm -rf {} +

END_TS="$(date +%s)"
DURATION="$((END_TS - START_TS))"
log "Duration seconds: ${DURATION}"

