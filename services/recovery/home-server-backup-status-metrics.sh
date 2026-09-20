#!/usr/bin/env bash
set -Eeuo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export RCLONE_CONFIG="/home/rami/.config/rclone/rclone.conf"

METRICS_DIR="/var/lib/node_exporter/textfile_collector"
METRICS_FILE="${METRICS_DIR}/home_server_backup.prom"
TMP_FILE="${METRICS_FILE}.tmp"

mkdir -p "$METRICS_DIR"

read_existing_metric() {
  local metric="$1"
  local fallback="$2"

  if [[ -f "$METRICS_FILE" ]]; then
    awk -v m="$metric" '$1 == m {print $2; found=1} END {if (!found) exit 1}' "$METRICS_FILE" 2>/dev/null || echo "$fallback"
  else
    echo "$fallback"
  fi
}

parse_backup_timestamp() {
  local backup_name="$1"
  local parsed

  parsed="$(echo "$backup_name" | sed -E 's/^.*-([0-9]{4}-[0-9]{2}-[0-9]{2})_([0-9]{2})-([0-9]{2})-([0-9]{2})$/\1 \2:\3:\4/')"

  if [[ "$parsed" == "$backup_name" ]]; then
    echo "0"
  else
    TZ=America/New_York date -d "$parsed" +%s 2>/dev/null || echo "0"
  fi
}

get_next_run_timestamp() {
  local next_raw
  next_raw="$(systemctl show -P NextElapseUSecRealtime home-server-image-backup.timer 2>/dev/null || true)"

  if [[ -z "$next_raw" || "$next_raw" == "n/a" ]]; then
    echo "0"
  else
    date -d "$next_raw" +%s 2>/dev/null || echo "0"
  fi
}

timer_enabled_value() {
  if systemctl is-enabled home-server-image-backup.timer >/dev/null 2>&1; then
    echo "1"
  else
    echo "0"
  fi
}

timer_active_value() {
  if systemctl is-active home-server-image-backup.timer >/dev/null 2>&1; then
    echo "1"
  else
    echo "0"
  fi
}

service_active_value() {
  if systemctl is-active home-server-image-backup.service >/dev/null 2>&1; then
    echo "1"
  else
    echo "0"
  fi
}

NOW_TS="$(date +%s)"

CLOUD_BACKUPS="$(rclone lsf homebackup: --dirs-only 2>/dev/null | while IFS= read -r name; do
  name="${name%/}"
  prefix="$(hostname -s)-"
  [[ "$name" == "$prefix"* ]] || continue
  suffix="${name#"$prefix"}"
  [[ "$suffix" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}-[0-9]{2}$ ]] || continue
  printf '%s\n' "$name"
done | sort || true)"
CLOUD_COUNT="$(printf '%s\n' "$CLOUD_BACKUPS" | sed '/^$/d' | wc -l | tr -d ' ')"
LATEST_BACKUP="$(printf '%s\n' "$CLOUD_BACKUPS" | sed '/^$/d' | sort | tail -n 1)"

EXISTING_LAST_SUCCESS="$(read_existing_metric home_server_backup_last_success 0)"
EXISTING_LAST_RUN_TS="$(read_existing_metric home_server_backup_last_run_timestamp_seconds 0)"
EXISTING_LAST_SIZE_BYTES="$(read_existing_metric home_server_backup_last_size_bytes 0)"
EXISTING_LAST_FILE_COUNT="$(read_existing_metric home_server_backup_last_file_count 0)"
EXISTING_LAST_DURATION="$(read_existing_metric home_server_backup_last_duration_seconds 0)"

LATEST_CLOUD_SIZE_BYTES="0"
LATEST_CLOUD_FILE_COUNT="0"
LATEST_CLOUD_BACKUP_TS="0"

if [[ -n "$LATEST_BACKUP" ]]; then
  LATEST_CLOUD_BACKUP_TS="$(parse_backup_timestamp "$LATEST_BACKUP")"

  SIZE_JSON="$(rclone size "homebackup:${LATEST_BACKUP}" --json 2>/dev/null || echo '{}')"
  LATEST_CLOUD_SIZE_BYTES="$(printf '%s' "$SIZE_JSON" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("bytes", 0))' 2>/dev/null || echo 0)"
  LATEST_CLOUD_FILE_COUNT="$(printf '%s' "$SIZE_JSON" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("count", 0))' 2>/dev/null || echo 0)"

  if [[ "$EXISTING_LAST_RUN_TS" == "0" ]]; then
    EXISTING_LAST_RUN_TS="$LATEST_CLOUD_BACKUP_TS"
  fi

  if [[ "$EXISTING_LAST_SIZE_BYTES" == "0" ]]; then
    EXISTING_LAST_SIZE_BYTES="$LATEST_CLOUD_SIZE_BYTES"
  fi

  if [[ "$EXISTING_LAST_FILE_COUNT" == "0" ]]; then
    EXISTING_LAST_FILE_COUNT="$LATEST_CLOUD_FILE_COUNT"
  fi

  if [[ "$EXISTING_LAST_SUCCESS" == "0" && "$LATEST_CLOUD_FILE_COUNT" != "0" ]]; then
    EXISTING_LAST_SUCCESS="1"
  fi
fi

NEXT_RUN_TS="$(get_next_run_timestamp)"
TIMER_ENABLED="$(timer_enabled_value)"
TIMER_ACTIVE="$(timer_active_value)"
SERVICE_ACTIVE="$(service_active_value)"

cat > "$TMP_FILE" <<METRICS
# HELP home_server_backup_last_success Whether the last image backup succeeded. 1 means success, 0 means failure.
# TYPE home_server_backup_last_success gauge
home_server_backup_last_success ${EXISTING_LAST_SUCCESS}

# HELP home_server_backup_last_run_timestamp_seconds Unix timestamp of the last image backup run.
# TYPE home_server_backup_last_run_timestamp_seconds gauge
home_server_backup_last_run_timestamp_seconds ${EXISTING_LAST_RUN_TS}

# HELP home_server_backup_last_duration_seconds Duration of the last image backup run in seconds.
# TYPE home_server_backup_last_duration_seconds gauge
home_server_backup_last_duration_seconds ${EXISTING_LAST_DURATION}

# HELP home_server_backup_last_size_bytes Size of the last successful backup in bytes.
# TYPE home_server_backup_last_size_bytes gauge
home_server_backup_last_size_bytes ${EXISTING_LAST_SIZE_BYTES}

# HELP home_server_backup_last_file_count Number of files in the last successful backup.
# TYPE home_server_backup_last_file_count gauge
home_server_backup_last_file_count ${EXISTING_LAST_FILE_COUNT}

# HELP home_server_backup_cloud_available_count Number of encrypted backup folders currently available in OneDrive.
# TYPE home_server_backup_cloud_available_count gauge
home_server_backup_cloud_available_count ${CLOUD_COUNT}

# HELP home_server_backup_latest_cloud_size_bytes Size of the latest encrypted cloud backup in bytes.
# TYPE home_server_backup_latest_cloud_size_bytes gauge
home_server_backup_latest_cloud_size_bytes ${LATEST_CLOUD_SIZE_BYTES}

# HELP home_server_backup_latest_cloud_file_count Number of files in the latest encrypted cloud backup.
# TYPE home_server_backup_latest_cloud_file_count gauge
home_server_backup_latest_cloud_file_count ${LATEST_CLOUD_FILE_COUNT}

# HELP home_server_backup_latest_cloud_backup_timestamp_seconds Timestamp parsed from the latest encrypted cloud backup folder name.
# TYPE home_server_backup_latest_cloud_backup_timestamp_seconds gauge
home_server_backup_latest_cloud_backup_timestamp_seconds ${LATEST_CLOUD_BACKUP_TS}

# HELP home_server_backup_next_run_timestamp_seconds Unix timestamp of the next scheduled image backup run.
# TYPE home_server_backup_next_run_timestamp_seconds gauge
home_server_backup_next_run_timestamp_seconds ${NEXT_RUN_TS}

# HELP home_server_backup_timer_enabled Whether the backup timer is enabled. 1 means enabled.
# TYPE home_server_backup_timer_enabled gauge
home_server_backup_timer_enabled ${TIMER_ENABLED}

# HELP home_server_backup_timer_active Whether the backup timer is active. 1 means active.
# TYPE home_server_backup_timer_active gauge
home_server_backup_timer_active ${TIMER_ACTIVE}

# HELP home_server_backup_service_active Whether the backup service is currently running. 1 means running.
# TYPE home_server_backup_service_active gauge
home_server_backup_service_active ${SERVICE_ACTIVE}

# HELP home_server_backup_status_metrics_last_update_timestamp_seconds Unix timestamp when backup status metrics were last refreshed.
# TYPE home_server_backup_status_metrics_last_update_timestamp_seconds gauge
home_server_backup_status_metrics_last_update_timestamp_seconds ${NOW_TS}
METRICS

mv "$TMP_FILE" "$METRICS_FILE"
chmod 644 "$METRICS_FILE"

