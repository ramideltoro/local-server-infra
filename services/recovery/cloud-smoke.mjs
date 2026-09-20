// Runs inside the existing network-isolated restore namespace with real restored
// PostgreSQL data. No external action, paid AI or production endpoint is allowed.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const {Miniflare,Response:MFResponse}=await import('/work/runtime/node_modules/miniflare/dist/src/index.js');
const deployments=JSON.parse(await fs.readFile('/work/cloud/deployments.json'));
const snapshots=JSON.parse(await fs.readFile('/work/cloud/kv.json'));
const feed=JSON.parse(await fs.readFile('/work/restored-feed.json'));
assert(feed.length>0,'Nonempty restored public data required');
const xml=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const rss='<rss><channel>'+feed.map(a=>`<item><title>${xml(a.title)}</title><link>${xml(a.original_url)}</link><description>${xml(a.ai_summary||a.title)}</description><pubDate>${xml(a.published_at)}</pubDate><enclosure url="${xml(a.image_url)}" type="image/jpeg"/></item>`).join('')+'</channel></rss>';
const headers={Authorization:'Bearer isolated-token','content-type':'application/json'};
const rssUrls=new Set();
for(let shardIndex=0;shardIndex<3;shardIndex++){
 const r=await fetch('http://127.0.0.1:8093/api/worker/db/load-feeds-for-shard',{method:'POST',headers,body:JSON.stringify({providerMode:'backend_postgres_primary',shardIndex,feedsPerShard:20,offset:shardIndex*20})});
 assert(r.ok,'Restored feed inventory unavailable');const rows=await r.json();assert(rows.length>0,'Each active shard needs restored feeds');for(const row of rows)rssUrls.add(row.url);
}
const denied=[],calls={rss:0,database:0};
const runtime=new Miniflare({host:'127.0.0.1',port:0,workers:deployments.map(d=>{
 const bindings=Object.fromEntries(d.settings.bindings.filter(b=>b.type==='plain_text').map(b=>[b.name,b.text]));
 for(const b of d.settings.bindings.filter(b=>b.type==='secrets_store_secret'))bindings[b.name]='';
 Object.assign(bindings,{NUTSNEWS_BACKEND_API_URL:'http://127.0.0.1:8093',NUTSNEWS_BACKEND_API_TOKEN:'isolated-token',LOCAL_AI_URL:'http://127.0.0.1:18991',LOCAL_AI_API_KEY:'isolated-only',OPENAI_API_KEY:'',NUTSNEWS_CACHE_REVALIDATION_URLS:'',CLOUDFLARE_ZONE_ID:''});
 assert.equal(bindings.NUTSNEWS_DATABASE_PROVIDER_MODE,'backend_postgres_primary');
 return {name:d.name,modules:true,scriptPath:'/work/cloud/'+d.name+'/'+d.entrypoint,compatibilityDate:d.settings.compatibility_date,compatibilityFlags:d.settings.compatibility_flags,bindings,kvNamespaces:{NUTSNEWS_KV:d.namespace},outboundService:async request=>{
  const url=new URL(request.url);
  if(rssUrls.has(request.url)){calls.rss++;return new MFResponse(rss,{headers:{'content-type':'application/rss+xml'}});}
  if(url.origin==='http://127.0.0.1:8093'&&url.pathname.startsWith('/api/worker/db/')){
   calls.database++;const r=await fetch(request.url,{method:request.method,headers:Object.fromEntries([...request.headers].filter(([name])=>!['connection','keep-alive','transfer-encoding','te','trailer','upgrade','host','content-length'].includes(name.toLowerCase()))),body:request.method==='GET'?undefined:await request.arrayBuffer(),signal:AbortSignal.timeout(30000)});return new MFResponse(await r.arrayBuffer(),{status:r.status,headers:Object.fromEntries(r.headers)});
  }
  denied.push(url.origin);throw Error('Unexpected external action blocked by isolated recovery');
 }};
})});
try{
 const restoredNamespaces=new Set();
 for(const d of deployments){
  const kv=await runtime.getKVNamespace('NUTSNEWS_KV',d.name);
  if(!restoredNamespaces.has(d.namespace)){for(const e of snapshots[d.namespace])await kv.put(e.name,Buffer.from(e.value,'base64'),e.metadata===undefined?{}:{metadata:e.metadata});restoredNamespaces.add(d.namespace);}
  const worker=await runtime.getWorker(d.name);
  const archived=JSON.parse(Buffer.from(snapshots[d.namespace].find(e=>e.name==='public-feed:snapshot:v1:latest').value,'base64'));
  assert(archived.articles.length>0,'Archived KV feed must contain actual articles');
  const response=await worker.fetch('http://restore/public-feed-snapshot?pageSize=2');assert.equal(response.status,200);const published=await response.json();assert(published.articles.length>0);assert.deepEqual(published.articles,archived.articles.slice(0,published.articles.length));
  const replay=await worker.fetch('http://restore/?limit=3');assert.equal(replay.status,200);const outcome=await replay.json();
  assert(outcome.fetchedCount>0&&outcome.alreadyReviewedCount>0,'Replay must encounter real restored articles');
  assert.equal(outcome.aiReviewedCount,0,'Duplicate replay must not request new AI work');assert.equal(outcome.acceptedCount,0);assert.equal(outcome.openAiCallCount,0);assert.equal(outcome.localAiCallCount,0);
  assert.equal(outcome.workerRunSaveOk,true,'Replay outcome must persist in restored PostgreSQL');
 }
 assert(calls.rss>0&&calls.database>0);assert.deepEqual(denied,[],'Unmapped external actions must fail the drill');
 await fs.writeFile('/work/cloud-result.json',JSON.stringify({shards:deployments.length,nonemptyRestoredData:true,publicFeed:true,duplicateReplay:true,paidAiCalls:0,externalActions:0}));
}finally{await runtime.dispose();}
