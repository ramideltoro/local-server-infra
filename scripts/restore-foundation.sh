#!/usr/bin/env bash
set -euo pipefail
# Explicit missing-component recovery on an already enrolled Ubuntu host.
# No formatting, password rotation, model deletion, or overwrite of existing files.
test "$(id -u)" = 0
archive="${1:?Restricted baseline archive required}"
test -f "$archive"
apt-get update -qq
apt-get install -y ca-certificates curl jq tar zstd cron
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
fetch() { curl -fsSL --retry 3 "$1" -o "$scratch/$2"; echo "$3  $scratch/$2" | sha256sum -c -; }
if ! test -x /usr/bin/node; then
  curl -fsSL https://nodejs.org/dist/v22.22.1/node-v22.22.1-linux-x64.tar.xz -o "$scratch/node.tar.xz"
  curl -fsSL https://nodejs.org/dist/v22.22.1/SHASUMS256.txt -o "$scratch/SHA256SUMS"
  expected=$(awk '$2 == "node-v22.22.1-linux-x64.tar.xz" {print $1}' "$scratch/SHA256SUMS")
  test -n "$expected"
  echo "$expected  $scratch/node.tar.xz" | sha256sum -c -
  tar -xJf "$scratch/node.tar.xz" --strip-components=1 -C /usr/local
  ln -s /usr/local/bin/node /usr/bin/node
fi
if ! command -v cloudflared >/dev/null; then
  fetch https://github.com/cloudflare/cloudflared/releases/download/2026.6.1/cloudflared-linux-amd64 cloudflared 5861a10a438fe8ddcfebb3b830f83966cbf193edafce0fe2eeb198fbae1f7a22
  install -m 755 "$scratch/cloudflared" /usr/bin/cloudflared
fi
if ! test -x /usr/bin/alloy; then
  fetch https://github.com/grafana/alloy/releases/download/v1.14.2/alloy-1.14.2-1.amd64.deb alloy.deb a7203c024aa04b588325aaf85d943a7d4f82c720944e12c8f8ce5ab09d01d548
  apt-get install -y "$scratch/alloy.deb"
fi
if ! command -v ollama >/dev/null; then
  fetch https://github.com/ollama/ollama/releases/download/v0.30.10/ollama-linux-amd64.tar.zst ollama.tar.zst 046d8f28e58d58477a49558d8d1bcb2e81ca8b287f93c44b12ff919c10d178dd
  tar --zstd -xf "$scratch/ollama.tar.zst" -C /usr
fi
id ollama >/dev/null 2>&1 || useradd -r -s /bin/false -U -m -d /usr/share/ollama ollama
id rami >/dev/null 2>&1 || useradd -m -s /bin/bash rami
# GNU tar skips existing files, preserving the adopted live configuration.
tar --skip-old-files -xzf "$archive" -C /
chown -R ollama:ollama /usr/share/ollama
systemctl daemon-reload
systemctl enable --now ollama nutsnews-local-ai cloudflared alloy
if ! curl -fsS http://127.0.0.1:11434/api/tags | jq -e '.models[] | select(.name=="qwen2.5:3b")' >/dev/null; then
  ollama pull qwen2.5:3b
fi
for unit in /etc/systemd/system/nutsnews*.timer /etc/systemd/system/home-server*.timer; do
  test -e "$unit" || continue
  systemctl enable --now "$(basename "$unit")"
done
curl -fsS http://127.0.0.1:8788/health | jq -e '.ok' >/dev/null
echo 'Missing foundation components restored; existing files preserved.'
