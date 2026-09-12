#!/usr/bin/env bash
set -euo pipefail
install -d -m 700 "$HOME/.ssh"
printf '%s\n' "$DEPLOY_SSH_KEY" > "$HOME/.ssh/local-server"
chmod 600 "$HOME/.ssh/local-server"
printf '%s\n' "$SSH_KNOWN_HOSTS" > "$HOME/.ssh/known_hosts"
cat > "$HOME/.ssh/config" <<'CONFIG'
Host localserver.ramideltoro.com
  User infra-deploy
  IdentityFile ~/.ssh/local-server
  IdentitiesOnly yes
  StrictHostKeyChecking yes
  ConnectTimeout 20
  ServerAliveInterval 15
  ProxyCommand cloudflared access ssh --hostname %h
CONFIG
