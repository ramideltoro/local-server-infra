import { inspectionThreshold } from "./metric-threshold.mjs";
import { inspectLogWindow } from "./log-window.mjs";
import { logSelector } from "./log-scope.mjs";
import { inspectionWindow } from "./window.mjs";
import { summarizeWithQwen } from "./summarize.mjs";
import fs from "node:fs/promises";
const root =
  process.env.PORTAL_ROOT || "/opt/local-server-observability/current";
const { readState, writeState } = await import(root + "/server/store.mjs");
const { reconcile, summarize } = await import(root + "/server/issues.mjs");
const { publicMetrics } = await import(root + "/server/core.mjs");
const inventory = JSON.parse(
  await fs.readFile(root + "/config/inventory.json", "utf8"),
);
const state = await readState(),
  at = new Date().toISOString(),
  end = Date.now() / 1000;
const inspection = inspectionWindow(state.lastSuccess, end);
const { requestedStart, start } = inspection,
  checks = [];
const base = process.env.GRAFANA_URL.replace(/\/$/, "");
async function get(route) {
  const r = await fetch(base + route, {
    headers: {
      Authorization: "Bearer " + process.env.GRAFANA_SERVICE_ACCOUNT_TOKEN,
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw Error("Source unavailable");
  return r.json();
}
async function metric(expr) {
  const p = new URLSearchParams({
    query: expr,
    start: String(start),
    end: String(end),
    step: String(Math.max(60, Math.ceil((end - start) / 300))),
  });
  const j = await get(
    "/api/datasources/proxy/uid/" +
      process.env.PROMETHEUS_UID +
      "/api/v1/query_range?" +
      p,
  );
  if (j.status !== "success") throw Error("Query failed");
  return j.data.result;
}
async function run(system, id, fn) {
  const c = { system, id, complete: false, failures: [] };
  try {
    Object.assign(c, await fn());
  } catch {
    c.note = "Source inaccessible; existing issues remain unverified";
  }
  checks.push(c);
}
for (const m of publicMetrics) {
  const system = m.id.startsWith("backend-vps")
    ? "backend-vps"
    : m.id.startsWith("nutsnews-vps")
      ? "nutsnews-vps"
      : m.id.startsWith("nutsnews")
        ? "nutsnews"
        : m.id.split("-")[0];
  await run(
    ["cpu", "memory", "disk", "load", "network", "uptime"].includes(system)
      ? "local"
      : system,
    m.id,
    async () => {
      const data = await metric(m.expr),
        values = data
          .flatMap((s) => s.values || [])
          .filter((v) => Number.isFinite(Number(v[1])));
      if (!values.length)
        return { note: "Missing instrumentation or no samples" };
      const latest = Math.max(...values.map((v) => Number(v[0]))),
        complete = latest > end - 300 && start === requestedStart;
      let failures = [];
      const recent = values
        .filter((v) => Number(v[0]) > end - 900)
        .map((v) => Number(v[1]));
      const threshold = inspectionThreshold(m);
      if (
        threshold !== null &&
        recent.length &&
        recent.every((v) =>
          /certificate|availability|database/.test(m.id)
            ? v < threshold
            : v > threshold,
        )
      )
        failures = [
          {
            signature: "threshold",
            severity: "warning",
            summary: m.title + " exceeded its inspection threshold",
            evidence: [
              {
                metric: m.id,
                threshold,
                minimum: Math.min(...recent),
                maximum: Math.max(...recent),
              },
            ],
          },
        ];
      return {
        complete,
        failures,
        note: complete
          ? "Samples inspected"
          : "Telemetry stale or inspection window truncated",
        samples: values.length,
      };
    },
  );
}
const instances = {
  local: "chingadera",
  "backend-vps": "backend.nutsnews.com",
  "nutsnews-vps": "vps.nutsnews.com",
  raspberry: "rpi4",
  mookie: "mookie",
};
for (const server of inventory.servers) {
  for (const service of server.services)
    await run(server.id, "service:" + service, async () => {
      const expr =
        server.id === "local"
          ? `local_server_service_active{service="${service}.service"}`
          : `node_systemd_unit_state{instance="${instances[server.id]}",name="${service}.service",state="active"}`;
      const data = await metric(expr),
        v = data
          .flatMap((s) => s.values || [])
          .filter((v) => Number(v[0]) > end - 300);
      if (!v.length)
        return {
          note: "Expected service listed; service exporter has no fresh samples",
        };
      return {
        complete: true,
        failures: v.every((v) => Number(v[1]) < 1)
          ? [
              {
                signature: "inactive",
                summary: service + " is not active",
                severity: "critical",
              },
            ]
          : [],
      };
    });
  for (const source of server.sources)
    if (source === "logs")
      await run(server.id, "recurring-errors", async () => {
        const stop = BigInt(Math.floor(end)) * 1000000000n;
        const { complete, entries: total, pages, patterns } = await inspectLogWindow(
          async (cursor, stop, limit) => {
            const p = new URLSearchParams({
              query: logSelector(server.id, instances[server.id]) + ' |~ "(?i)error|fatal|panic|failed"',
              start: String(cursor), end: String(stop), limit: String(limit), direction: "forward",
            });
            return get("/api/datasources/proxy/uid/" + process.env.LOKI_UID + "/loki/api/v1/query_range?" + p);
          }, BigInt(Math.floor(start)) * 1000000000n, stop,
        );
        // An empty error stream does not prove the underlying log source is present.
        const p = new URLSearchParams({
          query:
            logSelector(server.id, instances[server.id]),
          start: String(stop - 300000000000n),
          end: String(stop),
          limit: "1",
        });
        const live = await get(
          "/api/datasources/proxy/uid/" +
            process.env.LOKI_UID +
            "/loki/api/v1/query_range?" +
            p,
        );
        if (live.status !== "success" || live.data?.resultType !== "streams") throw Error("Fresh log query failed");
        const present = (live.data?.result || []).some((s) => s.values?.length);
        return {
          complete:
            complete && present && start === requestedStart,
          note: !present
            ? "No fresh log samples"
            : complete
              ? "Bounded error patterns inspected"
              : "Log budget reached; incomplete",
          entries: total,
          pages,
          failures: [...patterns]
            .filter(([, n]) => n >= 3)
            .map(([signature, count]) => ({
              signature,
              count,
              summary: "Recurring " + signature,
              severity: "warning",
              evidence: [{ classification: signature, count }],
            })),
        };
      });
  for (const app of server.applications)
    checks.push({
      system: app,
      id: "hosting:" + server.id,
      complete: !server.limitation,
      failures: [],
      note: server.limitation || server.evidence,
    });
  for (const id of (server.id === "mookie" ? ["backup-freshness"] : ["restart-patterns", "backup-freshness"]))
    checks.push({
      system: server.id,
      id,
      complete: false,
      failures: [],
      note: "Dedicated check not yet instrumented; existing Cloud alert evaluation remains authoritative",
    });
}
for (const [system, id, expr, threshold] of [
  [
    "local",
    "restart-patterns",
    "sum(increase(local_server_service_restarts_total[24h]))",
    3,
  ],
  [
    "local",
    "image-backup",
    '1 - max(home_server_backup_last_success{instance="chingadera"})',
    0,
  ],
  [
    "local",
    "database-backup",
    '1 - max(nutsnews_db_backup_last_success{instance="chingadera"})',
    0,
  ],
  [
    "local",
    "backup-freshness",
    'time() - max(home_server_backup_status_metrics_last_update_timestamp_seconds{instance="chingadera"})',
    1800,
  ],
  ["local", "qwen-health", "1 - min(local_server_qwen_health)", 0],
]) {
  const old = checks.findIndex((c) => c.system === system && c.id === id);
  if (old >= 0) checks.splice(old, 1);
  await run(system, id, async () => {
    const data = await metric(expr),
      values = data
        .flatMap((s) => s.values || [])
        .filter((v) => Number(v[0]) > end - 300);
    if (!values.length) return { note: "No fresh samples" };
    const maximum = Math.max(...values.map((v) => Number(v[1])));
    return {
      complete: true,
      note: "Existing exporter inspected",
      failures:
        maximum > threshold
          ? [
              {
                signature: "threshold",
                summary: id + " exceeded threshold",
                evidence: [{ maximum, threshold }],
                severity: "warning",
              },
            ]
          : [],
    };
  });
}
await run("fleet", "cloud-alert-source", async () => {
  const { alertCatalog } = await import(root + "/server/alerts.mjs");
  const [rules, groups, instances] = await Promise.all([
    get("/api/v1/provisioning/alert-rules"),
    get("/api/prometheus/grafana/api/v1/rules"),
    get("/api/alertmanager/grafana/api/v2/alerts"),
  ]);
  for (const rule of alertCatalog(rules, groups, instances).rules) {
    const failed = [
      "firing",
      "alerting",
      "evaluation-error",
      "no-data",
    ].includes(rule.state);
    checks.push({
      system: rule.system,
      id: "alert:" + rule.id,
      complete:
        rule.enabled &&
        rule.state !== "unknown" &&
        rule.state !== "evaluation-error" &&
        rule.state !== "no-data",
      note: rule.paused
        ? "Rule paused"
        : rule.silenced
          ? "Cloud evaluation inspected; notifications silenced"
          : "Existing Cloud evaluation inspected",
      failures: failed
        ? [
            {
              signature: rule.state,
              summary: rule.name,
              severity: rule.severity === "critical" ? "critical" : "warning",
              evidence: [
                { state: rule.state, intervalSeconds: rule.intervalSeconds },
              ],
            },
          ]
        : [],
    });
  }
  return {
    complete: true,
    note: rules.length + " configured Cloud rules inspected",
  };
});
const report = {
  id: at.replace(/[^0-9]/g, ""),
  at,
  window: { start: new Date(start * 1000).toISOString(), end: at },
  requestedStart: new Date(requestedStart * 1000).toISOString(),
  delaySeconds: Math.max(0, end - requestedStart - 86400),
  schedule: inspection,
  trigger: process.env.INSPECTION_TRIGGER || "manual",
  checks,
  ai: {
    mode: "template",
    note: "AI summarization disabled until an idle-only admission check is verified",
  },
};
report.summary = summarize(report);
report.ai = await summarizeWithQwen(report);
state.issues = reconcile(state.issues, checks, at);
state.reports.unshift(report);
// Preserve summaries and coverage indefinitely, prune only detailed evidence after 90 days.
for (const r of state.reports)
  if (Date.parse(at) - Date.parse(r.at) > 90 * 86400000)
    for (const c of r.checks)
      for (const f of c.failures || []) delete f.evidence;
// Completed execution advances the cursor; per-check completeness separately controls remediation.
state.lastSuccess = at;
state.lastComplete = checks.every((c) => c.complete)
  ? at
  : state.lastComplete || null;
state.lastRun = at;
await writeState(state);
console.log(report.summary);
