#!/usr/bin/env bash
set -Eeuo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export RCLONE_CONFIG="/home/rami/.config/rclone/rclone.conf"

SERVER_NAME="$(hostname -s)"
BACKUP_DATE="$(date +%Y-%m-%d_%H-%M-%S)"
BACKUP_NAME="${SERVER_NAME}-${BACKUP_DATE}"
BASE_DIR="/srv/home-server-backups/image-backup"
BACKUP_DIR="${BASE_DIR}/${BACKUP_NAME}"
REMOTE_NAME="homebackup"
REMOTE_PATH="${REMOTE_NAME}:${BACKUP_NAME}"
LOG_FILE="/var/log/home-server-image-backup.log"
STATE_DIR="/var/lib/home-server-backup"
METRICS_FILE="/var/lib/node_exporter/textfile_collector/home_server_backup.prom"

START_TS="$(date +%s)"
STATUS="failed"
SIZE_BYTES="0"
FILE_COUNT="0"

log() {
  echo "$(date --iso-8601=seconds) | $*" | tee -a "$LOG_FILE"
}

write_metrics() {
  local end_ts duration success
  end_ts="$(date +%s)"
  duration="$((end_ts - START_TS))"

  if [[ "$STATUS" == "success" ]]; then
    success="1"
  else
    success="0"
  fi

  cat > "${METRICS_FILE}.tmp" <<METRICS
# HELP home_server_backup_last_success Whether the last image backup succeeded. 1 means success, 0 means failure.
# TYPE home_server_backup_last_success gauge
home_server_backup_last_success ${success}

# HELP home_server_backup_last_run_timestamp_seconds Unix timestamp of the last image backup run.
# TYPE home_server_backup_last_run_timestamp_seconds gauge
home_server_backup_last_run_timestamp_seconds ${end_ts}

# HELP home_server_backup_last_duration_seconds Duration of the last image backup run in seconds.
# TYPE home_server_backup_last_duration_seconds gauge
home_server_backup_last_duration_seconds ${duration}

# HELP home_server_backup_last_size_bytes Size of the last local backup before upload and cleanup.
# TYPE home_server_backup_last_size_bytes gauge
home_server_backup_last_size_bytes ${SIZE_BYTES}

# HELP home_server_backup_last_file_count Number of files in the last backup folder.
# TYPE home_server_backup_last_file_count gauge
home_server_backup_last_file_count ${FILE_COUNT}
METRICS

  mv "${METRICS_FILE}.tmp" "$METRICS_FILE"

  cat > "${STATE_DIR}/latest.env" <<STATE
STATUS=${STATUS}
SERVER_NAME=${SERVER_NAME}
BACKUP_NAME=${BACKUP_NAME}
REMOTE_PATH=${REMOTE_PATH}
SIZE_BYTES=${SIZE_BYTES}
FILE_COUNT=${FILE_COUNT}
START_TS=${START_TS}
END_TS=${end_ts}
DURATION_SECONDS=${duration}
STATE
}

on_error() {
  local rc="$?"
  STATUS="failed"
  log "ERROR: Backup failed with exit code ${rc}"
  write_metrics
  exit "$rc"
}

trap on_error ERR

log "Starting backup: ${BACKUP_NAME}"

mkdir -p "$BACKUP_DIR/metadata" "$BACKUP_DIR/efi" "$BACKUP_DIR/root"

log "Checking rclone encrypted remote..."
rclone lsd "${REMOTE_NAME}:" >/dev/null

log "Saving restore metadata..."
echo "$BACKUP_NAME" > "$BACKUP_DIR/metadata/backup-name.txt"
hostnamectl > "$BACKUP_DIR/metadata/hostnamectl.txt"
uname -a > "$BACKUP_DIR/metadata/uname.txt"
lsblk -o NAME,SIZE,TYPE,FSTYPE,UUID,PARTUUID,MOUNTPOINTS,MODEL > "$BACKUP_DIR/metadata/lsblk.txt"
df -h > "$BACKUP_DIR/metadata/df-h.txt"
findmnt > "$BACKUP_DIR/metadata/findmnt.txt"
blkid > "$BACKUP_DIR/metadata/blkid.txt"
sfdisk -d /dev/nvme0n1 > "$BACKUP_DIR/metadata/sfdisk-nvme0n1.dump"
sgdisk --backup="$BACKUP_DIR/metadata/gpt-nvme0n1.backup" /dev/nvme0n1
cp /etc/fstab "$BACKUP_DIR/metadata/fstab"
dpkg --get-selections > "$BACKUP_DIR/metadata/dpkg-selections.txt"
systemctl list-unit-files > "$BACKUP_DIR/metadata/systemd-unit-files.txt"
crontab -l > "$BACKUP_DIR/metadata/root-crontab.txt" 2>/dev/null || true
sudo -u rami crontab -l > "$BACKUP_DIR/metadata/rami-crontab.txt" 2>/dev/null || true

log "Backing up EFI partition..."
tar --xattrs --acls -czf "$BACKUP_DIR/efi/boot-efi-files.tar.gz" -C /boot/efi .
dd if=/dev/nvme0n1p1 bs=64M status=none | gzip -1 > "$BACKUP_DIR/efi/nvme0n1p1-efi.img.gz"
sha256sum "$BACKUP_DIR/efi/"* > "$BACKUP_DIR/efi/SHA256SUMS"

log "Backing up root filesystem..."
tar \
  --numeric-owner \
  --acls \
  --xattrs \
  --xattrs-include='*' \
  --one-file-system \
  --exclude='./srv/home-server-backups' \
  --exclude='./proc' \
  --exclude='./sys' \
  --exclude='./dev' \
  --exclude='./run' \
  --exclude='./var/log/journal' \
  --exclude='./var/lib/observe-recovery/staging' \
  --exclude='./tmp' \
  --exclude='./var/tmp' \
  --exclude='./var/cache/apt/archives' \
  -cpf - \
  -C / . | zstd -T2 -6 -o "$BACKUP_DIR/root/nvme0n1p2-root.tar.zst"

sha256sum "$BACKUP_DIR/root/nvme0n1p2-root.tar.zst" > "$BACKUP_DIR/root/SHA256SUMS"

log "Creating manifest..."
find "$BACKUP_DIR" -type f -printf '%P\n' | sort > "$BACKUP_DIR/metadata/file-list.txt"
du -sb "$BACKUP_DIR" > "$BACKUP_DIR/metadata/backup-size-bytes.txt"
du -sh "$BACKUP_DIR" > "$BACKUP_DIR/metadata/backup-size-human.txt"

find "$BACKUP_DIR" -type f \
  ! -path "$BACKUP_DIR/metadata/full-backup-SHA256SUMS" \
  -print0 | sort -z | xargs -0 sha256sum > "$BACKUP_DIR/metadata/full-backup-SHA256SUMS"

SIZE_BYTES="$(du -sb "$BACKUP_DIR" | awk '{print $1}')"
FILE_COUNT="$(find "$BACKUP_DIR" -type f | wc -l)"

log "Uploading encrypted backup to OneDrive: ${REMOTE_PATH}"
rclone copy "$BACKUP_DIR" "$REMOTE_PATH" \
  --transfers 2 \
  --checkers 4 \
  --log-file "$LOG_FILE" \
  --log-level INFO

log "Verifying encrypted OneDrive upload..."
rclone check "$BACKUP_DIR" "$REMOTE_PATH" \
  --one-way \
  --log-file "$LOG_FILE" \
  --log-level INFO

log "Deleting older cloud backups, keeping only: ${BACKUP_NAME}"
while IFS= read -r cloud_dir; do
  cloud_dir="${cloud_dir%/}"
  # This encrypted remote is shared with database and application archives.
  [[ "$cloud_dir" == "${SERVER_NAME}-"* ]] || continue
  suffix="${cloud_dir#"${SERVER_NAME}-"}"
  [[ "$suffix" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}-[0-9]{2}$ ]] || continue
  [[ "$cloud_dir" == "$BACKUP_NAME" ]] && continue

  log "Deleting old cloud backup: ${cloud_dir}"
  rclone purge "${REMOTE_NAME}:${cloud_dir}" \
    --log-file "$LOG_FILE" \
    --log-level INFO
done < <(rclone lsf "${REMOTE_NAME}:" --dirs-only)

log "Deleting local backup folder from server: ${BACKUP_DIR}"
rm -rf "$BACKUP_DIR"

log "Cleaning old local backup folders, if any..."
find "$BASE_DIR" -mindepth 1 -maxdepth 1 -type d -name "${SERVER_NAME}-*" -exec rm -rf {} +

STATUS="success"
write_metrics

log "Backup completed successfully: ${BACKUP_NAME}"

