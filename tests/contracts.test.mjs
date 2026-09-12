import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
const host = JSON.parse(fs.readFileSync("config/host.json"));
test("production AI contract is stable", () => {
  assert.equal(host.ai.hostname, "ai.nutsnews.com");
  assert.equal(host.ai.model, "qwen2.5:3b");
  assert.equal(host.ai.authenticationHeader, "x-nutsnews-ai-key");
});
test("deployment scripts do not restart production AI", () => {
  for (const f of ["scripts/activate.sh", "scripts/rollback.sh"]) {
    const s = fs.readFileSync(f, "utf8");
    assert(!/systemctl\s+(restart|stop)\s+(ollama|nutsnews-local-ai)/.test(s));
  }
});
test("AI probe accepts local Qwen and rejects fallback or another model", () => {
  for (const [provider, model, accepted] of [
    ["local", "qwen2.5:3b", true],
    ["openai", "qwen2.5:3b", false],
    ["local", "another-model", false],
  ]) {
    const script = `globalThis.fetch=async url=>({ok:true,json:async()=>String(url).endsWith('/health')?{ok:true,availableModels:['qwen2.5:3b']}:{provider:${JSON.stringify(provider)},model:${JSON.stringify(model)},title:'fixture',summary:'fixture'}}); await import('./scripts/qwen-check.mjs');`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {env:{...process.env,LOCAL_AI_API_KEY:"fixture-only"},encoding:"utf8"});
    assert.equal(result.status===0,accepted);
  }
});
