#!/usr/bin/env bash
set -euo pipefail
source_dir=${1:?Source directory required}
root=/opt/nutsnews/local-ai-service
backup=/var/lib/local-server-infra/qwen-telemetry-backup
expected=038d05f71eef64d1a72b3e4b21e716673b115232637e4d3db985e5ea4c2f5de4
incoming=$(sha256sum "$source_dir/server.mjs" | cut -d' ' -f1)
current=$(sha256sum "$root/server.mjs" | cut -d' ' -f1)
if [[ "$incoming" = "$current" ]]; then curl -fsS http://127.0.0.1:8791/metrics >/dev/null; exit 0; fi
managed=$(cat /var/lib/local-server-infra/qwen-telemetry.sha 2>/dev/null || true)
[[ "$current" = "$expected" || "$current" = "$managed" ]] || { echo 'AI source changed outside this release; preserving it.'; exit 1; }
if [[ "$current" = "$expected" && -n "$(ss -Hltn 'sport = 8791')" ]]; then echo 'Telemetry port is already occupied; preserving production.'; exit 1; fi
node --check "$source_dir/server.mjs"
node --check "$source_dir/telemetry.mjs"
# Never interrupt active inference to install observability. Continuous demand defers deployment.
idle=0
for attempt in $(seq 1 120); do
  if [[ -z "$(ss -Htn state established '( sport = 8788 or dport = 11434 or sport = 11434 )')" ]]; then idle=$((idle+1)); else idle=0; fi
  if [[ "$idle" -ge 2 ]]; then break; fi
  sleep 5
done
[[ "$idle" -ge 2 ]] || { echo 'Qwen remains busy; telemetry update deferred without changing production.'; exit 1; }
install -d -m 700 "$backup"
cp -a "$root/server.mjs" "$backup/server.mjs"
if [[ -f "$root/telemetry.mjs" ]]; then cp -a "$root/telemetry.mjs" "$backup/telemetry.mjs"; fi
rollback(){ cp -a "$backup/server.mjs" "$root/server.mjs"; if [[ -f "$backup/telemetry.mjs" ]]; then cp -a "$backup/telemetry.mjs" "$root/telemetry.mjs"; fi; systemctl restart nutsnews-local-ai; }
trap rollback ERR
install -m 644 "$source_dir/telemetry.mjs" "$root/telemetry.mjs"
install -m 644 "$source_dir/server.mjs" "$root/server.mjs"
install -d /etc/systemd/system/nutsnews-local-ai.service.d
printf '[Service]\nTimeoutStopSec=130\n' > /etc/systemd/system/nutsnews-local-ai.service.d/observability.conf
systemctl daemon-reload
systemctl restart nutsnews-local-ai
for attempt in $(seq 1 20); do if curl -fsS http://127.0.0.1:8788/health >/dev/null; then break; fi; sleep 1; done
curl -fsS http://127.0.0.1:8788/health | jq -e '.ok == true and .defaultModel == "qwen2.5:3b"' >/dev/null
curl -fsS http://127.0.0.1:8791/metrics | grep -q 'local_qwen_requests_total'
printf '%s\n' "$incoming" > /var/lib/local-server-infra/qwen-telemetry.sha
printf 'Qwen instrumentation installed after idle check; request contract preserved.\n'
