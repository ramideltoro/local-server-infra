const url = process.env.LOCAL_AI_URL || "https://ai.nutsnews.com";
const key = process.env.LOCAL_AI_API_KEY;
if (!key) throw Error("LOCAL_AI_API_KEY is required");
const health = await fetch(url + "/health", {
  signal: AbortSignal.timeout(15000),
});
const h = await health.json();
if (!health.ok || !h.ok || !h.availableModels?.includes("qwen2.5:3b"))
  throw Error("Production Qwen health/model check failed");
const r = await fetch(url + "/translate", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-nutsnews-ai-key": key },
  body: JSON.stringify({
    title: "Community garden opens",
    summary: "Volunteers opened a community garden for their neighbors.",
    language_code: "fr",
    model: "qwen2.5:3b",
  }),
  signal: AbortSignal.timeout(120000),
});
const j = await r.json();
if (
  !r.ok ||
  j.provider !== "local" ||
  j.model !== "qwen2.5:3b" ||
  !j.title ||
  !j.summary
)
  throw Error("Production Qwen inference failed; fallback is not accepted");
console.log(
  JSON.stringify({
    ok: true,
    provider: j.provider,
    model: j.model,
    durationMs: j.duration_ms,
    timestamp: new Date().toISOString(),
  }),
);
