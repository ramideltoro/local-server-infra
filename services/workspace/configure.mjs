import { createHmac } from "node:crypto";
import fs from "node:fs/promises";
const cloudResponse=await fetch(process.env.GRAFANA_URL.replace(/\/$/,'')+'/api/datasources',{headers:{Authorization:'Bearer '+process.env.GRAFANA_SERVICE_ACCOUNT_TOKEN},signal:AbortSignal.timeout(15000)});
if(!cloudResponse.ok)throw Error('Cloud datasource discovery failed');
const ownerSources=(await cloudResponse.json()).filter(d=>['prometheus','loki','tempo','graphite','grafana-pyroscope-datasource'].includes(d.type)).map(d=>({name:d.name,uid:d.uid,type:d.type,access:'proxy',url:process.env.GRAFANA_URL.replace(/\/$/,'')+'/api/datasources/proxy/uid/'+encodeURIComponent(d.uid),isDefault:d.uid===process.env.PROMETHEUS_UID,editable:false,jsonData:{httpHeaderName1:'Authorization',httpMethod:'GET'},secureJsonData:{httpHeaderValue1:'Bearer '+process.env.GRAFANA_SERVICE_ACCOUNT_TOKEN}}));
const data = "/var/lib/local-server-observability";
for (const scope of ["public", "owner"]) {
  const home = `${data}/grafana-${scope}`,
    prefix = scope === "public" ? "/grafana" : "/owner/grafana";
  const config = `/etc/local-server-observability/grafana-${scope}`;
  await fs.mkdir(config + "/provisioning/datasources", {
    recursive: true,
    mode: 0o755,
  });
  await fs.mkdir(config + "/provisioning/dashboards", {
    recursive: true,
    mode: 0o755,
  });
  const settings = `[paths]\ndata = ${home}\nlogs = ${home}/logs\nplugins = ${home}/plugins\nprovisioning = ${config}/provisioning\n[server]\nhttp_addr = 127.0.0.1\nhttp_port = ${scope === "public" ? 4320 : 4321}\nroot_url = https://observe.ramideltoro.com${prefix}/\nserve_from_sub_path = true\n[security]\n${scope === "owner" ? "secret_key = " + createHmac("sha256", process.env.SESSION_SECRET).update("owner-grafana").digest("hex") + "\n" : ""}allow_embedding = true\ncookie_secure = true\ndisable_initial_admin_creation = true\n[auth]\ndisable_login_form = true\ndisable_signout_menu = true\n[auth.anonymous]\nenabled = ${scope === "public"}\norg_role = Viewer\n[auth.proxy]\nenabled = ${scope === "owner"}\nheader_name = X-WEBAUTH-USER\nheader_property = username\nauto_sign_up = true\nwhitelist = 127.0.0.1\n[users]\nallow_sign_up = false\nauto_assign_org_role = Editor\n[analytics]\nreporting_enabled = false\ncheck_for_updates = false\n[unified_alerting]\nenabled = false\n[feature_toggles]\nenable =\n[plugins]\npreinstall_disabled = true\npreinstall_auto_update = false\nplugin_admin_enabled = false\n[live]\nmax_connections = 0\n`;
  await fs.writeFile(config + "/grafana.ini", settings, {
    mode: scope === "owner" ? 0o600 : 0o644,
  });
  const sources =
    scope === "public"
      ? [
          {
            name: "Approved public metrics",
            uid: "public-metrics",
            type: "prometheus",
            access: "proxy",
            url: "http://127.0.0.1:4312",
            isDefault: true,
            editable: false,
            jsonData: { httpMethod: "POST", timeInterval: "60s" },
          },
        ]
      : ownerSources;
  await fs.writeFile(
    config + "/provisioning/datasources/sources.yaml",
    JSON.stringify({ apiVersion: 1, datasources: sources }),
    { mode: scope === "owner" ? 0o600 : 0o644 },
  );
  await fs.writeFile(
    config + "/provisioning/dashboards/source.yaml",
    JSON.stringify({
      apiVersion: 1,
      providers: [
        {
          name: "Synced originals",
          folder: "Synced originals",
          type: "file",
          disableDeletion: true,
          allowUiUpdates: false,
          updateIntervalSeconds: 30,
          options: { path: home + "/dashboards" },
        },
      ],
    }),
    { mode: 0o644 },
  );
}
