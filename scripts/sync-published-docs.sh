#!/usr/bin/env bash
set -euo pipefail
# Narrow exception: generated dashboard catalogs, never undocumented application changes.
previous=$(curl -fsS --retry 2 --max-time 20 https://observe.ramideltoro.com/api/public/release | jq -r .portal) || exit 0
[[ "$previous" =~ ^[a-f0-9]{40}$ ]] || exit 0
[ "$previous" != "$PORTAL_SHA" ] || exit 0
git -C portal fetch origin "$previous" --depth=1
changes=$(git -C portal diff --name-only "$previous" "$PORTAL_SHA")
[ -n "$changes" ] || exit 0
while IFS= read -r file; do
  [[ "$file" == config/published/*.json ]] || exit 0
done <<< "$changes"
node wiki/scripts/source-lock.mjs check local-server-infra infra
git -C portal worktree add --detach "$RUNNER_TEMP/previous-portal" "$previous"
node wiki/scripts/source-lock.mjs check local-server-observability "$RUNNER_TEMP/previous-portal"
node infra/scripts/published-docs.mjs portal wiki
node wiki/scripts/source-lock.mjs update local-server-observability portal
(cd wiki && npm ci && npm run build)
git -C wiki config user.name 'Observability publishing pipeline'
git -C wiki config user.email '41898282+github-actions[bot]@users.noreply.github.com'
git -C wiki add sources.lock.json src/data/topics.json
git -C wiki commit -m 'Synchronize published dashboard catalog'
git -C wiki config --local --unset-all http.https://github.com/.extraheader || true
git -C wiki -c 'credential.helper=!gh auth git-credential' push origin HEAD:main
echo "WIKI_SHA=$(git -C wiki rev-parse HEAD)" >> "$GITHUB_ENV"
