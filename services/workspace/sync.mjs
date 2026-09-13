import fs from "node:fs/promises";
import path from "node:path";
const root =
  process.env.PORTAL_ROOT || "/opt/local-server-observability/current";
const dir = process.env.DATA_DIR || "/var/lib/local-server-observability";
const { publicMetrics } = await import(root + "/server/core.mjs");
const { registeredQueries, queryKey } = await import(
  root + "/server/gateway.mjs"
);
const base = process.env.GRAFANA_URL.replace(/\/$/, "");
async function get(route) {
  const r = await fetch(base + route, {
    headers: {
      Authorization: "Bearer " + process.env.GRAFANA_SERVICE_ACCOUNT_TOKEN,
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw Error("Cloud synchronization failed: " + r.status);
  return r.json();
}
const found = await get("/api/search?type=dash-db&limit=1000");
if (found.length >= 1000) throw Error("Dashboard discovery needs pagination");
const publicDir = dir + "/grafana-public/dashboards",
  ownerDir = dir + "/grafana-owner/dashboards";
await fs.mkdir(publicDir, { recursive: true });
await fs.mkdir(ownerDir, { recursive: true });
const catalog = [];
for (const item of found) {
  const { dashboard } = await get(
    "/api/dashboards/uid/" + encodeURIComponent(item.uid),
  );
  dashboard.id = null;
  dashboard.editable = false;
  dashboard.version = 1;
  // Source originals are separate files and UIDs; workspace copies use a different folder and UID.
  await fs.writeFile(
    ownerDir + "/" + item.uid + ".json",
    JSON.stringify(dashboard),
    { mode: 0o600 },
  );
  const panels = [];
  let restricted = 0;
  function walk(items) {
    for (const p of items || []) {
      if (p.type === "row") {
        panels.push({
          id: p.id,
          type: "row",
          title: p.title,
          gridPos: p.gridPos,
          collapsed: false,
        });
        walk(p.panels);
        continue;
      }
      // Cloud definitions may contain private text, data links, transformations or queries.
      // Public publishing begins with explicit metric approval; never copy arbitrary panel contents.
      const targets = (p.targets || []).filter((t) => !t.hide);
      const approved =
        targets.length &&
        targets.every(
          (t) =>
            typeof t.expr === "string" &&
            registeredQueries.has(queryKey(t.expr)),
        );
      if (
        approved &&
        [
          "timeseries",
          "stat",
          "gauge",
          "bargauge",
          "table",
          "heatmap",
          "piechart",
          "barchart",
          "histogram",
        ].includes(p.type)
      ) {
        panels.push({
          id: p.id,
          type: p.type,
          title: p.title,
          gridPos: p.gridPos,
          datasource: { type: "prometheus", uid: "public-metrics" },
          targets: targets.map((t, i) => ({
            refId: String.fromCharCode(65 + i),
            expr: queryKey(t.expr),
            datasource: { type: "prometheus", uid: "public-metrics" },
          })),
          fieldConfig: {
            defaults: { unit: p.fieldConfig?.defaults?.unit || "short" },
            overrides: [],
          },
          options: {},
        });
        continue;
      }
      panels.push({
        id: p.id,
        type: "text",
        title: p.title || "Restricted panel",
        gridPos: p.gridPos,
        options: {
          mode: "markdown",
          content:
            "This panel needs private data or a Cloud plugin. Open the owner view for full diagnostics. Public resource charts are available in Fleet metrics.",
        },
      });
      restricted++;
    }
  }
  walk(dashboard.panels);
  const safe = {
    uid: item.uid,
    title: item.title,
    editable: false,
    schemaVersion: 39,
    panels,
    templating: { list: [] },
    annotations: { list: [] },
    time: { from: "now-1h", to: "now" },
    links: [],
  };
  await fs.writeFile(
    publicDir + "/" + item.uid + ".json",
    JSON.stringify(safe),
    { mode: 0o600 },
  );
  catalog.push({
    id: item.uid,
    title: item.title,
    source: "Grafana Cloud",
    panels: panels.filter((p) => p.type !== "row").length,
    restricted,
    publicPath: "/grafana/d/" + item.uid + "/view?theme=dark&kiosk",
    ownerPath: "/owner/grafana/d/" + item.uid + "/view",
    cloudUrl: base + "/d/" + item.uid,
    limitation:
      restricted + " panels require private data review or Cloud functionality",
  });
}
const panels = publicMetrics.map((m, i) => ({
  id: i + 1,
  type: "timeseries",
  title: m.title,
  gridPos: { x: (i % 2) * 12, y: Math.floor(i / 2) * 8, w: 12, h: 8 },
  datasource: { type: "prometheus", uid: "public-metrics" },
  targets: [
    {
      refId: "A",
      expr: "public_metric_" + i,
      datasource: { type: "prometheus", uid: "public-metrics" },
    },
  ],
  fieldConfig: {
    defaults: { unit: m.unit, color: { mode: "fixed", fixedColor: "#f5a623" } },
    overrides: [],
  },
  options: { legend: { displayMode: "hidden" }, tooltip: { mode: "single" } },
}));
await fs.writeFile(
  publicDir + "/fleet-metrics.json",
  JSON.stringify({
    uid: "fleet-metrics",
    title: "Fleet metrics",
    editable: false,
    schemaVersion: 39,
    panels,
    time: { from: "now-1h", to: "now" },
    templating: { list: [] },
    annotations: { list: [] },
  }),
  { mode: 0o600 },
);
catalog.unshift({
  id: "fleet-metrics",
  title: "Fleet metrics",
  source: "Portal",
  panels: panels.length,
  restricted: 0,
  publicPath: "/grafana/d/fleet-metrics/view?theme=dark&kiosk",
  limitation: "Approved resource and endpoint metrics; series labels removed",
});
const legacy = JSON.parse(
  await fs.readFile(root + "/config/catalog.json", "utf8"),
);
for (const d of legacy)
  if (!catalog.some((c) => c.id === d.id)) {
    const panels = d.panels.map((p, i) => ({
      id: i + 1,
      title: p.title,
      type: "timeseries",
      gridPos: { x: (i % 2) * 12, y: Math.floor(i / 2) * 8, w: 12, h: 8 },
      datasource: { type: "prometheus", uid: "public-metrics" },
      targets: p.queries
        .filter((q) => registeredQueries.has(queryKey(q)))
        .map((q, n) => ({
          refId: String.fromCharCode(65 + n),
          expr: queryKey(q),
          datasource: { type: "prometheus", uid: "public-metrics" },
        })),
      fieldConfig: { defaults: { unit: p.unit || "short" }, overrides: [] },
    }));
    await fs.writeFile(
      publicDir + "/" + d.id + ".json",
      JSON.stringify({
        uid: d.id,
        title: d.title,
        editable: false,
        schemaVersion: 39,
        panels,
        time: { from: "now-1h", to: "now" },
        templating: { list: [] },
        annotations: { list: [] },
      }),
      { mode: 0o600 },
    );
    catalog.push({
      id: d.id,
      title: d.title,
      source: "Portal",
      panels: panels.length,
      restricted: panels.filter((p) => !p.targets.length).length,
      publicPath: "/grafana/d/" + d.id + "/view?theme=dark&kiosk",
      limitation:
        "Approved metric queries, fixed server scope, anonymous series labels",
      ownerPath: "/owner/?legacy=1#" + d.application,
    });
  }
try {
  for (const file of await fs.readdir(root + "/config/published")) {
    if (!file.endsWith(".json")) continue;
    const d = JSON.parse(
      await fs.readFile(root + "/config/published/" + file, "utf8"),
    );
    await fs.writeFile(publicDir + "/" + d.uid + ".json", JSON.stringify(d), {
      mode: 0o600,
    });
    catalog.push({
      id: d.uid,
      title: d.title,
      source: "Published workspace",
      panels: d.panels.length,
      restricted: 0,
      publicPath: "/grafana/d/" + d.uid + "/view?theme=dark&kiosk",
      limitation: "Published from a validated Git pull request",
    });
  }
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
const output = {
  updatedAt: new Date().toISOString(),
  cloudCount: found.length,
  dashboards: catalog,
};
await fs.writeFile(dir + "/catalog.json.tmp", JSON.stringify(output), {
  mode: 0o600,
});
await fs.rename(dir + "/catalog.json.tmp", dir + "/catalog.json");
console.log(
  "Synchronized " +
    found.length +
    " Cloud dashboards and " +
    (catalog.length - found.length) +
    " portal dashboards",
);
