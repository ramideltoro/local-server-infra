#!/usr/bin/env bash
set -euo pipefail
root=/opt/local-server-observability
previous=$(cat "$root/previous")
[[ "$previous" == "$root/releases/"* ]] && test -d "$previous"
current=$(readlink "$root/current")
ln -sfn "$previous" "$root/current.next"
mv -Tf "$root/current.next" "$root/current"
systemctl restart local-server-observability
sleep 2
curl -fsS http://127.0.0.1:4310/healthz | jq -e '.ok' >/dev/null
curl -fsS http://127.0.0.1:8788/health | jq -e '.ok' >/dev/null
printf '%s\n' "$current" > "$root/previous"
echo 'Previous application release restored; AI endpoint healthy.'
