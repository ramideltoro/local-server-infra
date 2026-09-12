#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0
test -n "${DEPLOY_PUBLIC_KEY:?Provide the deployment public key}"
id infra-deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash infra-deploy
install -d -m 700 -o infra-deploy -g infra-deploy /home/infra-deploy/.ssh
touch /home/infra-deploy/.ssh/authorized_keys
grep -qxF "$DEPLOY_PUBLIC_KEY" /home/infra-deploy/.ssh/authorized_keys || printf '%s\n' "$DEPLOY_PUBLIC_KEY" >> /home/infra-deploy/.ssh/authorized_keys
chmod 600 /home/infra-deploy/.ssh/authorized_keys
chown infra-deploy:infra-deploy /home/infra-deploy/.ssh/authorized_keys
printf 'infra-deploy ALL=(ALL) NOPASSWD: ALL\n' > /etc/sudoers.d/local-server-infra
chmod 440 /etc/sudoers.d/local-server-infra
visudo -cf /etc/sudoers.d/local-server-infra
install -d -m 700 /etc/local-server-infra
install -d -m 755 /opt/local-server-observability/releases
printf 'Initial deployment account enrolled. Existing AI services were not restarted.\n'
