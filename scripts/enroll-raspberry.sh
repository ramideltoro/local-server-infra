#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
sudo apt-get update -qq
sudo apt-get install -y -qq sshpass
node --input-type=module - <<'NODE'
import fs from 'node:fs';
const host=JSON.parse(fs.readFileSync('config/raspberry.json'));
if(!process.env.RASPBERRY_PI_ADMIN_PASSWORD||!process.env.RASPBERRY_TELEMETRY_ENV)throw Error('Raspberry enrollment secrets are missing');
fs.appendFileSync(process.env.HOME+'/.ssh/known_hosts',host.host+' '+host.hostKey+'\n');
fs.writeFileSync(process.env.RUNNER_TEMP+'/raspberry-inventory.json',JSON.stringify({all:{hosts:{raspberry:{ansible_host:host.host,ansible_user:host.user,ansible_password:process.env.RASPBERRY_PI_ADMIN_PASSWORD,ansible_become_password:process.env.RASPBERRY_PI_ADMIN_PASSWORD,ansible_ssh_common_args:'-o StrictHostKeyChecking=yes -o ProxyJump='+host.jumpHost}}}}),{mode:0o600});
NODE
trap 'rm -f "$RUNNER_TEMP/raspberry-inventory.json"' EXIT
ansible-playbook -i "$RUNNER_TEMP/raspberry-inventory.json" ansible/raspberry.yml
