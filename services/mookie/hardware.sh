#!/usr/bin/env bash
set -euo pipefail
out=/var/lib/mookie-observability/hardware.prom
umask 022
tmp=$(mktemp "${out}.XXXXXX")
trap 'rm -f "$tmp"' EXIT
printf 'mookie_collector_timestamp_seconds %s\n' "$(date +%s)" > "$tmp"
if [ -r /sys/class/thermal/thermal_zone0/temp ]; then
  awk '{printf "mookie_temperature_celsius %.3f\n", $1/1000}' /sys/class/thermal/thermal_zone0/temp >> "$tmp"
fi
if command -v vcgencmd >/dev/null; then
  raw=$(vcgencmd get_throttled)
  bits=${raw#*=}
  [[ "$bits" =~ ^0x[0-9a-fA-F]+$ ]]
  printf 'mookie_undervoltage %s\nmookie_throttled %s\nmookie_hardware_warning_since_boot %s\n' "$((bits & 1))" "$(((bits >> 2) & 1))" "$(((bits >> 16) != 0))" >> "$tmp"
fi
chmod 644 "$tmp"
mv "$tmp" "$out"
logger -t mookie-observability 'Server telemetry heartbeat'
