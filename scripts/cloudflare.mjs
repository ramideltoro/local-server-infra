import fs from "node:fs";
const e = process.env,
  account = e.CLOUDFLARE_ACCOUNT_ID;
if (!account || !e.CLOUDFLARE_API_TOKEN)
  throw Error("Cloudflare credentials required");
async function api(route, method = "GET", body) {
  const r = await fetch("https://api.cloudflare.com/client/v4/" + route, {
    method,
    headers: {
      Authorization: "Bearer " + e.CLOUDFLARE_API_TOKEN,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok || !j.success)
    throw Error(`Cloudflare ${method} ${route}: ${JSON.stringify(j.errors)}`);
  return j.result;
}
const zones = await api("zones?name=ramideltoro.com");
if (zones.length !== 1) throw Error("Expected ramideltoro.com zone");
const zone = zones[0].id;
const tunnels = await api(`accounts/${account}/cfd_tunnel?is_deleted=false`);
const tunnel = tunnels.find((t) => t.name === "nutsnews-home-ai");
if (!tunnel) throw Error("Existing production AI tunnel not found");
const route = `accounts/${account}/cfd_tunnel/${tunnel.id}/configurations`;
const old = await api(route);
const originalAI = old.config.ingress.find(
  (i) => i.hostname === "ai.nutsnews.com",
);
if (!originalAI || originalAI.service !== "http://localhost:8788")
  throw Error(
    "Production AI route differs from adopted contract; refusing update",
  );
const ingress = old.config.ingress.filter(
  (i) =>
    !["localserver.ramideltoro.com", "observe.ramideltoro.com"].includes(
      i.hostname,
    ),
);
const fallback = ingress.pop();
ingress.push(
  { hostname: "localserver.ramideltoro.com", service: "ssh://localhost:22" },
  { hostname: "observe.ramideltoro.com", service: "http://localhost:4310" },
  fallback,
);
if (
  JSON.stringify(ingress.find((i) => i.hostname === "ai.nutsnews.com")) !==
  JSON.stringify(originalAI)
)
  throw Error("AI route must remain unchanged");
if (JSON.stringify(ingress) !== JSON.stringify(old.config.ingress))
  await api(route, "PUT", { config: { ...old.config, ingress } });
async function dns(name, content, proxied) {
  const records = await api(`zones/${zone}/dns_records?name=${name}`);
  if (records.length > 1) throw Error("Ambiguous DNS record " + name);
  const desired = { type: "CNAME", name, content, proxied, ttl: 1 };
  const current = records[0];
  if (!current) await api(`zones/${zone}/dns_records`, "POST", desired);
  else if (
    current.type !== "CNAME" ||
    current.content !== content ||
    current.proxied !== proxied
  )
    await api(`zones/${zone}/dns_records/${current.id}`, "PUT", desired);
}
await dns("localserver.ramideltoro.com", tunnel.id + ".cfargotunnel.com", true);
await dns("observe.ramideltoro.com", tunnel.id + ".cfargotunnel.com", true);
await dns("localserver.wiki.ramideltoro.com", "ramideltoro.github.io", false);
const apps = await api(`accounts/${account}/access/apps`);
async function app(name, domain) {
  let current = apps.find((a) => a.domain === domain);
  if (!current)
    current = await api(`accounts/${account}/access/apps`, "POST", {
      name,
      domain,
      type: "self_hosted",
      session_duration: "12h",
      app_launcher_visible: false,
    });
  return current;
}
async function policy(application, name, decision, include) {
  const route = `accounts/${account}/access/apps/${application.id}/policies`;
  const ps = await api(route);
  const current = ps.find((p) => p.name === name);
  const body = {
    name,
    decision,
    include,
    exclude: [],
    require: [],
    precedence: 1,
  };
  if (!current) await api(route, "POST", body);
  else if (
    JSON.stringify(current.include) !== JSON.stringify(include) ||
    current.decision !== decision
  )
    await api(route + "/" + current.id, "PUT", body);
}
const sshApp = await app(
  "Local server GitHub deployment",
  "localserver.ramideltoro.com",
);
let tokenId = e.ACCESS_SERVICE_TOKEN_ID;
let token;
if (!tokenId) {
  const tokens = await api(`accounts/${account}/access/service_tokens`);
  const existing = tokens.find((t) => t.name === "local-server-github-actions");
  if (existing) tokenId = existing.id;
  else {
    token = await api(`accounts/${account}/access/service_tokens`, "POST", {
      name: "local-server-github-actions",
      duration: "8760h",
    });
    tokenId = token.id;
  }
}
await policy(sshApp, "GitHub Actions machine access", "non_identity", [
  { service_token: { token_id: tokenId } },
]);
const emails =
  (e.OWNER_EMAILS || e.ADMIN_EMAILS || "").match(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  ) || [];
if (!emails.length) throw Error("Owner email configuration required");
// Only retire the portal edge login after the Google-authenticated release is healthy.
if (e.RETIRE_PORTAL_ACCESS === "true") {
  const health = await fetch("https://observe.ramideltoro.com/healthz").then(
    (r) => r.json(),
  );
  if (health.authentication !== "google")
    throw Error("Google authentication is not active; retaining portal Access");
  for (const a of apps.filter((a) =>
    [
      "observe.ramideltoro.com/owner",
      "observe.ramideltoro.com/api/owner",
    ].includes(a.domain),
  )) {
    await api(`accounts/${account}/access/apps/${a.id}`, "DELETE");
  }
}
const out = {
  OWNER_EMAILS: emails.join(","),
  ACCESS_SERVICE_TOKEN_ID: tokenId,
  ...(token
    ? {
        CF_ACCESS_CLIENT_ID: token.client_id,
        CF_ACCESS_CLIENT_SECRET: token.client_secret,
      }
    : {}),
};
if (e.BOOTSTRAP_OUTPUT)
  fs.writeFileSync(e.BOOTSTRAP_OUTPUT, JSON.stringify(out), { mode: 0o600 });
console.log(
  "Cloudflare routes and access policies reconciled; production AI ingress preserved.",
);
