#!/usr/bin/env bash
set -euo pipefail
release="${1:?Release identifier required}"
[[ "$release" =~ ^[a-f0-9]{40}$ ]] || exit 2
root=/opt/local-server-observability
previous=$(readlink "$root/current" || true)
new="$root/releases/$release"
test -f "$new/server/index.mjs"
ai_pid=$(systemctl show nutsnews-local-ai --property=MainPID --value)
# Restart even when portal code is unchanged: runtime configuration and the
# coordinated infrastructure/wiki release manifest may have changed.
rollback() {
  if [[ -n "$previous" && -d "$previous" ]]; then
    ln -sfn "$previous" "$root/current.next"
    mv -Tf "$root/current.next" "$root/current"
    systemctl restart local-server-observability
  fi
}
trap rollback ERR
ln -sfn "$new" "$root/current.next"
mv -Tf "$root/current.next" "$root/current"
systemctl daemon-reload
systemctl enable --now local-server-observability >/dev/null
systemctl restart local-server-observability
for attempt in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:4310/healthz >/dev/null; then break; fi
  sleep 1
done
curl -fsS http://127.0.0.1:4310/healthz | jq -e '.ok == true' >/dev/null
curl -fsS http://127.0.0.1:8788/health | jq -e '.ok == true and .defaultModel == "qwen2.5:3b"' >/dev/null
test "$ai_pid" = "$(systemctl show nutsnews-local-ai --property=MainPID --value)"
if [[ -n "$previous" && "$previous" != "$new" ]]; then printf '%s\n' "$previous" > "$root/previous"; fi
printf 'Portal activated; production AI process preserved.\n'
