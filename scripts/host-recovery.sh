#!/usr/bin/env bash
# Chingadera-specific recovery. Never probe by starving the live watchdog.
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo 'Run as root' >&2; exit 1; }
[[ $(hostname) == chingadera ]] || { echo 'Only supported on chingadera' >&2; exit 1; }
modprobe sp5100_tco
[[ $(cat /sys/class/watchdog/watchdog0/identity) == 'SP5100 TCO timer' ]]
install -d -m 755 /etc/modules-load.d /etc/sysctl.d /etc/systemd/system.conf.d /etc/systemd/journald.conf.d /etc/systemd/system/sysstat-collect.timer.d
printf 'sp5100_tco\n' > /etc/modules-load.d/local-server-watchdog.conf
cat > /etc/systemd/system.conf.d/90-local-server-watchdog.conf <<'CONF'
[Manager]
RuntimeWatchdogSec=60s
WatchdogDevice=/dev/watchdog0
RebootWatchdogSec=10min
CONF
cat > /etc/sysctl.d/90-local-server-lockup-recovery.conf <<'CONF'
# Capture detectable kernel lockups through kdump, then recover.
kernel.hardlockup_panic = 1
kernel.softlockup_panic = 1
kernel.panic = 30
CONF
sysctl -p /etc/sysctl.d/90-local-server-lockup-recovery.conf
cat > /etc/systemd/journald.conf.d/90-local-server-crash-evidence.conf <<'CONF'
[Journal]
Storage=persistent
SyncIntervalSec=30s
CONF
cat > /etc/systemd/system/sysstat-collect.timer.d/90-local-server-evidence.conf <<'CONF'
[Timer]
OnCalendar=
OnCalendar=*-*-* *:*:00
AccuracySec=5s
CONF
systemctl restart systemd-journald
systemctl daemon-reexec
systemctl restart sysstat-collect.timer
[[ $(cat /sys/class/watchdog/watchdog0/state) == active ]]
[[ $(cat /sys/class/watchdog/watchdog0/timeout) == 60 ]]
ls -l /proc/1/fd | grep /dev/watchdog0
systemctl show -p RuntimeWatchdogUSec -p WatchdogDevice
