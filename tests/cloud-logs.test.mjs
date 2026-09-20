import test from 'node:test';
import assert from 'node:assert/strict';
import {observe,services} from '../services/recovery/cloud-logs.mjs';
const now=1800000000000,credentials={CLOUDFLARE_ACCOUNT_ID:'account',CLOUDFLARE_API_TOKEN:'private'};
const mock=(alter=x=>x)=>async(url,options)=>{const body=JSON.parse(options.body),service=body.parameters.filters[0].value;assert.equal(body.dry,true);assert(services.includes(service));return {ok:true,json:async()=>({success:true,result:{events:{events:alter([{timestamp:now-1000,$metadata:{service},source:{secret:'must never be published'}}])}}})};};
test('requires authentic activity for every production shard and emits no log content',async()=>{const result=await observe(credentials,mock(),now);assert.equal(result.systems.nutsnews.at,new Date(now-1000).toISOString());assert(!JSON.stringify(result).includes('secret'));});
for(const [name,alter]of [['missing',()=>[]],['stale',r=>r.map(x=>({...x,timestamp:now-3600000}))],['future',r=>r.map(x=>({...x,timestamp:now+1}))],['wrong application',r=>r.map(x=>({...x,$metadata:{service:'shadow'}}))]])test(name+' logs stay unverified',async()=>{await assert.rejects(observe(credentials,mock(alter),now));});
test('provider authentication failure stays unverified',async()=>assert.rejects(observe(credentials,async()=>({ok:false}),now)));
