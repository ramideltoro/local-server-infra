const e = process.env,
  base = e.GRAFANA_URL?.replace(/\/$/, "");
async function api(p, method = "GET", body) {
  const r = await fetch(base + p, {
    method,
    headers: {
      Authorization: "Bearer " + e.GRAFANA_SERVICE_ACCOUNT_TOKEN,
      "Content-Type": "application/json",
      "X-Disable-Provenance": "true",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw Error(`Grafana ${method} ${p}: ${r.status}`);
  return r.status === 204 ? {} : r.json();
}
const folder = "local-server-central";
const folders = await api("/api/folders");
if (!folders.some((f) => f.uid === folder))
  await api("/api/folders", "POST", {
    uid: folder,
    title: "Local server central observability",
  });
const rules = [
  [
    "local-image-backup-failed",
    "Local image backup failed",
    'max(home_server_backup_last_success{instance="chingadera"})',
    "lt",
    1,
    "5m",
  ],
  [
    "local-db-backup-failed",
    "Local database backup failed",
    'max(nutsnews_db_backup_last_success{instance="chingadera"})',
    "lt",
    1,
    "5m",
  ],
  [
    "local-backup-status-stale",
    "Local backup status stale",
    'time() - max(home_server_backup_status_metrics_last_update_timestamp_seconds{instance="chingadera"})',
    "gt",
    1800,
    "5m",
  ],
  [
    "local-qwen-health",
    "Local Qwen unavailable",
    "min(local_server_qwen_health)",
    "lt",
    1,
    "2m",
  ],
  [
    "local-service-health",
    "Local required service down",
    "min(local_server_service_active)",
    "lt",
    1,
    "2m",
  ],
  [
    "local-metrics-missing",
    "Local telemetry missing",
    "absent_over_time(local_server_collector_timestamp_seconds[5m])",
    "gt",
    0,
    "1m",
  ],
  [
    "local-cpu-pressure",
    "Local CPU pressure",
    '100 * (1 - avg(rate(node_cpu_seconds_total{instance="chingadera",job="integrations/node_exporter",mode="idle"}[5m])))',
    "gt",
    90,
    "10m",
  ],
  [
    "local-memory-pressure",
    "Local memory pressure",
    '100 * (1 - max(node_memory_MemAvailable_bytes{instance="chingadera"}) / max(node_memory_MemTotal_bytes{instance="chingadera"}))',
    "gt",
    90,
    "10m",
  ],
  [
    "local-disk-pressure",
    "Local disk pressure",
    '100 * (1 - max(node_filesystem_avail_bytes{instance="chingadera",mountpoint="/"}) / max(node_filesystem_size_bytes{instance="chingadera",mountpoint="/"}))',
    "gt",
    85,
    "15m",
  ],
];
rules.push(...[
  [
    "mookie-cpu",
    "Mookie CPU utilization",
    "100*(1-avg(rate(node_cpu_seconds_total{instance=\"mookie\",mode=\"idle\"}[5m])))",
    "gt",
    90,
    "10m"
  ],
  [
    "mookie-memory",
    "Mookie Memory used",
    "100*(1-max(node_memory_MemAvailable_bytes{instance=\"mookie\"})/max(node_memory_MemTotal_bytes{instance=\"mookie\"}))",
    "gt",
    90,
    "10m"
  ],
  [
    "mookie-disk",
    "Mookie Root disk used",
    "100*(1-max(node_filesystem_avail_bytes{instance=\"mookie\",mountpoint=\"/\"})/max(node_filesystem_size_bytes{instance=\"mookie\",mountpoint=\"/\"}))",
    "gt",
    85,
    "5m"
  ],
  [
    "mookie-temperature",
    "Mookie CPU temperature",
    "max(mookie_temperature_celsius{instance=\"mookie\"})",
    "gt",
    80,
    "5m"
  ],
  [
    "mookie-undervoltage",
    "Mookie Undervoltage now",
    "max(mookie_undervoltage{instance=\"mookie\"})",
    "gt",
    0,
    "5m"
  ],
  [
    "mookie-throttled",
    "Mookie Thermal throttling now",
    "max(mookie_throttled{instance=\"mookie\"})",
    "gt",
    0,
    "5m"
  ],
  [
    "mookie-services-failed",
    "Mookie Failed services",
    "sum(node_systemd_unit_state{instance=\"mookie\",state=\"failed\"})",
    "gt",
    0,
    "5m"
  ],
  [
    "mookie-restarts",
    "Mookie Service restarts over 1 hour",
    "sum(increase(node_systemd_service_restart_total{instance=\"mookie\"}[1h]))",
    "gt",
    3,
    "5m"
  ],
  [
    "mookie-telemetry-age",
    "Mookie Hardware telemetry age",
    "time()-max(mookie_collector_timestamp_seconds{instance=\"mookie\"})",
    "gt",
    180,
    "5m"
  ],
  [
    "mookie-metrics-missing",
    "Mookie telemetry missing",
    "absent_over_time(mookie_collector_timestamp_seconds{instance=\"mookie\"}[5m])",
    "gt",
    0,
    "1m"
  ]
]);
rules.push(
 ["raspberry-metrics-missing","Raspberry telemetry missing",'absent_over_time(raspberry_collector_timestamp_seconds{instance="rpi4"}[5m])',"gt",0,"1m"],
 ["raspberry-temperature","Raspberry temperature high",'max(raspberry_temperature_celsius{instance="rpi4"})',"gt",80,"5m"],
 ["raspberry-throttling","Raspberry throttling or undervoltage",'max({__name__=~"raspberry_(undervoltage|throttled)",instance="rpi4"})',"gt",0,"5m"],
 ["raspberry-services","Raspberry receiver service unavailable",'min(node_systemd_unit_state{instance="rpi4",name=~"(lighttpd|tar1090|airplanes-feed|airplanes-mlat)\\.service",state="active"})',"lt",1,"3m"],
 ["kubequest-health","KubeQuest unavailable",'min(local_application_health{application="kubequest"})',"lt",1,"3m"],
 ["kubequest-labs","KubeQuest lab runtime unavailable",'min(local_application_capability{application="kubequest",capability="labs"})',"lt",1,"5m"],
 ["fantasy-qwen-health","Fantasy inference unavailable",'min(local_application_health{application="fantasy-qwen"})',"lt",1,"5m"]
);
for (const [uid, title, expr, op, threshold, duration] of rules) {
  const body = {
    uid,
    title,
    folderUID: folder,
    ruleGroup: "Local server health",
    condition: "C",
    for: duration,
    noDataState: uid.endsWith("metrics-missing") ? "OK" : "NoData",
    execErrState: "Error",
    annotations: {
      summary: title,
      runbook_url: "https://localserver.wiki.ramideltoro.com/technical/alerts/",
    },
    labels: {
      application: uid.startsWith("raspberry-") ? "raspberry-receiver" : uid.startsWith("kubequest-") ? "kubequest" : uid.startsWith("fantasy-qwen-") ? "fantasy-qwen" : uid.startsWith("mookie-") ? "mookie" : "local-server",
      server: uid.startsWith("raspberry-") ? "raspberry" : uid.startsWith("mookie-") ? "mookie" : "local",
      severity: "warning",
      managed_by: "local-server-infra",
    },
    data: [
      {
        refId: "A",
        relativeTimeRange: { from: 600, to: 0 },
        datasourceUid: e.PROMETHEUS_UID,
        model: {
          refId: "A",
          expr,
          instant: true,
          range: false,
          intervalMs: 60000,
          maxDataPoints: 43200,
        },
      },
      {
        refId: "C",
        relativeTimeRange: { from: 0, to: 0 },
        datasourceUid: "__expr__",
        model: {
          refId: "C",
          type: "threshold",
          expression: "A",
          conditions: [
            {
              evaluator: { type: op, params: [threshold] },
              operator: { type: "and" },
              query: { params: ["C"] },
              reducer: { type: "last", params: [] },
              type: "query",
            },
          ],
        },
      },
    ],
  };
  let exists = false;
  try {
    await api("/api/v1/provisioning/alert-rules/" + uid);
    exists = true;
  } catch {}
  await api(
    "/api/v1/provisioning/alert-rules" + (exists ? "/" + uid : ""),
    exists ? "PUT" : "POST",
    body,
  );
  console.log("Reconciled alert", title);
}
