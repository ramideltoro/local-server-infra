# Local Server Infrastructure

GitHub-managed configuration for the local Ubuntu server, production Qwen compatibility, and the central observability portal. The pipeline adopts the running machine in place: it does not format disks, remove models, or replace the production AI contract.

## Architecture

GitHub Actions → Cloudflare Access → `localserver.ramideltoro.com` → SSH → Ansible and versioned releases.

- **Production AI:** `ai.nutsnews.com`, Qwen `qwen2.5:3b`; existing authentication and worker interfaces remain unchanged.
- **Portal:** [observe.ramideltoro.com](https://observe.ramideltoro.com), built in [local-server-observability](https://github.com/ramideltoro/local-server-observability).
- **Wiki:** [localserver.wiki.ramideltoro.com](https://localserver.wiki.ramideltoro.com), sourced from [local-server-wiki](https://github.com/ramideltoro/local-server-wiki).

## What this repository owns

`ansible/site.yml` manages the local host's portal runtime and bounded telemetry additions. `config/host.json` records the adopted contract. `scripts/cloudflare.mjs` reconciles new DNS and Access routes while preserving the existing AI ingress. Existing NutsNews VPS and cloud resources retain their current owners.

## Pipeline

The deployment workflow resolves exact source revisions, checks wiki fingerprints, validates/builds the portal, tests real Qwen inference, applies the host configuration, activates an immutable release, and repeats compatibility checks. All host deployments share one concurrency group. Manual workflows support status and rollback; normal changes run through pull requests and validated default-branch releases.

## Secrets

Use GitHub repository secrets for deployment SSH identity, pinned host keys, Cloudflare machine authentication, Grafana read credentials, owner access configuration, and the existing local AI API key. Credentials and baseline archives never belong in Git. Production credentials are never passed to untrusted pull-request jobs.

## Validation and recovery

Run `node --test tests/*.test.mjs`, `ansible-playbook --syntax-check -i ansible/inventory.ini ansible/site.yml`, and the portal tests before release. Production verification requires local Qwen inference; an OpenAI fallback is not accepted. Restore the previous portal release with the rollback workflow. The independent wiki explains recovery when SSH or the tunnel is unavailable.

## Documentation contract

Behavior changes require updated Summary, Technical, and Expert wiki topics and a matching source fingerprint. CI blocks deployment when documentation is stale. See the wiki for operating procedures, limitations, and the complete dependency map.

## Public workspace and daily inspection

The infrastructure pipeline provisions two isolated, resource-limited Grafana 13.2.1 processes and the Git-managed jobs in `services/workspace`. The public process has no Cloud datasource credentials. Daily inspection runs at 09:00 UTC through `inspect.yml`, publishes deterministic issue history and coverage, and encrypts report backups with `REPORT_BACKUP_KEY`. A backup roundtrip is verified on each run. Summaries and transitions persist indefinitely; detailed evidence artifacts expire after 90 days.

Google-authenticated manual dispatch and validated dashboard publishing use the existing automation credential, held only in the private portal runtime configuration. No email or messaging notifications are added. Read the [daily-report operations guide](https://localserver.wiki.ramideltoro.com/technical/daily-reports/) and [dashboard editing guide](https://localserver.wiki.ramideltoro.com/technical/workspace-editing/) before changing policy.

### Mookie retirement
Mookie was removed from the fleet by its owner on September 20, 2026. Deployments no longer enroll or contact it; reconciliation removes only its ten explicitly owned alert rules. Historical enrollment assets and reports are retained. Do not run the archived enrollment scripts against a potentially reused address. See the [retirement record](https://localserver.wiki.ramideltoro.com/technical/mookie/).

## Operational health workspace

The portal provides explainable 0–100 verified health and coverage for every canonical system, deployment events, dependencies, objectives, Qwen workload telemetry, capacity estimates, incidents, recovery readiness, command search, owner favorites, and shared time ranges. Missing evidence remains visible and reduces verified health. Minute collection and daily 09:00 UTC inspection preserve history in an additive SQLite database with encrypted backup verification.

See the [health guide](https://localserver.wiki.ramideltoro.com/technical/verified-health/), [workspace guide](https://localserver.wiki.ramideltoro.com/technical/operational-workspace/), and [storage recovery guide](https://localserver.wiki.ramideltoro.com/expert/operational-storage/) for scoring, scope, limitations, and recovery. Google authentication protects all changes; deployment remains GitHub-managed. Qwen instrumentation preserves production routing and uses an idle-gated wrapper upgrade with compatibility checks.
