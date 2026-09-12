import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const host=JSON.parse(fs.readFileSync('config/host.json'));
test('production AI contract is stable',()=>{assert.equal(host.ai.hostname,'ai.nutsnews.com');assert.equal(host.ai.model,'qwen2.5:3b');assert.equal(host.ai.authenticationHeader,'x-nutsnews-ai-key')});
test('deployment scripts do not restart production AI',()=>{for(const f of ['scripts/activate.sh','scripts/rollback.sh']){const s=fs.readFileSync(f,'utf8');assert(!/systemctl\s+(restart|stop)\s+(ollama|nutsnews-local-ai)/.test(s))}});
test('AI probe rejects fallback',()=>{const s=fs.readFileSync('scripts/qwen-check.mjs','utf8');assert(s.includes("j.provider!=='local'"));assert(s.includes("j.model!=='qwen2.5:3b'"))});
