import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSettings,safeModule,scripts} from '../services/recovery/cloud-workers.mjs';
const valid=()=>({compatibility_date:'2026-06-25',bindings:[{name:'NUTSNEWS_DATABASE_PROVIDER_MODE',type:'plain_text',text:'backend_postgres_primary'},{name:'NUTSNEWS_KV',type:'kv_namespace',namespace_id:'snapshot'}]});
test('only the three active production shards are included',()=>assert.deepEqual(scripts,['nutsnews-worker-0','nutsnews-worker-1','nutsnews-worker-2']));
test('missing configuration, an alternate database or unsupported dependencies cannot pass',()=>{
 assert.equal(validateSettings(valid()).NUTSNEWS_DATABASE_PROVIDER_MODE,'backend_postgres_primary');
 for(const edit of [s=>delete s.compatibility_date,s=>s.bindings.pop(),s=>s.bindings[0].text='supabase_primary',s=>s.bindings.push({name:'QUEUE',type:'queue'})]){const s=valid();edit(s);assert.throws(()=>validateSettings(s));}
});
test('deployed module paths cannot escape the recovery directory',()=>{
 assert.equal(safeModule('index.js'),'index.js');assert.equal(safeModule('parts/module.js'),'parts/module.js');
 for(const value of [null,'','/index.js','../index.js','parts/../index.js','parts\\index.js','index.wasm'])assert.throws(()=>safeModule(value));
});
