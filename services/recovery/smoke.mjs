import { recoveryMembership } from './membership.mjs';
// Runs only inside the network-isolated disposable root. No production env.
import fs from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
const id=process.argv[2],children=[],logs=[];
const env={PATH:process.env.PATH,HOME:'/tmp',LANG:'C.UTF-8'};
function start(cmd,args,extra={},cwd='/work'){const p=spawn(cmd,args,{cwd,env:{...env,...extra},stdio:['ignore','pipe','pipe']});p.stdout.on('data',b=>logs.push(b.toString()));p.stderr.on('data',b=>logs.push(b.toString()));children.push(p);return p;}
async function get(url,options){const r=await fetch(url,{...options,signal:AbortSignal.timeout(120000)});if(!r.ok)logs.push('http-error '+await r.text());assert(r.ok,'HTTP '+r.status);return r;}
async function ready(url){for(let n=0;n<120;n++){try{return await get(url);}catch{}await new Promise(r=>setTimeout(r,500));}throw Error('Restored application not ready');}
function execute(command,args){const r=spawnSync(command,args,{env:{...env,PATH:'/usr/lib/postgresql/18/bin:'+env.PATH},encoding:'utf8',timeout:300000,maxBuffer:10*1024*1024});if(r.status!==0){logs.push(r.stderr||'');throw Error(command+' failed');}return r.stdout.trim();}
function sqlite(p){const db=new DatabaseSync(p);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');return db;}
try{
 // Network namespace contains only loopback, and host database sockets are absent.
 const dev=await fs.readFile('/proc/net/dev','utf8');assert(!/^\s*(eth|en|wl)/m.test(dev));assert.equal(await fs.stat('/run/postgresql').catch(()=>null),null);
 if(id==='kubequest'){
  const db=sqlite('/work/data/kubequest.sqlite'),lessons=db.prepare('SELECT lesson FROM progress ORDER BY lesson').all().map(r=>r.lesson),attempts=db.prepare('SELECT count(*) AS n FROM attempts').get().n;db.close();
  const secret='isolated-recovery-session-secret-0123456789',origin='http://127.0.0.1:4340';
  start('node',['--import','tsx','server/index.ts'],{DB_PATH:'/work/data/kubequest.sqlite',PORT:'4340',PUBLIC_ORIGIN:origin,SESSION_SECRET:secret,AUTH_GOOGLE_ID:'isolated',AUTH_GOOGLE_SECRET:'isolated'},'/work/app');
  const health=await(await ready(origin+'/healthz')).json();assert.equal(health.revision,(await fs.readFile('/work/revision','utf8')).trim());
  const enc=o=>Buffer.from(JSON.stringify(o)).toString('base64url');const token=enc({alg:'HS256'})+'.'+enc({email:'rami.deltoro@gmail.com',sub:'isolated-restore',iss:origin,aud:'kubequest',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300});const jwt=token+'.'+createHmac('sha256',secret).update(token).digest('base64url');
  const p=await(await get(origin+'/api/private/progress',{headers:{cookie:'kubequest='+jwt}})).json();assert.deepEqual(p.lessons.sort(),lessons);assert.equal(p.attempts.length,Math.min(100,attempts));await get(origin+'/');
 }else if(id==='observability'){
  const db=sqlite('/work/data/operations.db'),snapshots=db.prepare('SELECT count(*) AS n FROM snapshots').get().n;assert(snapshots>0,'Restore must contain operational history');db.close();
  const owner=sqlite('/work/data/owner/grafana.db'),dashboards=owner.prepare("SELECT count(*) AS n FROM resource WHERE resource='dashboards'").get().n;assert(dashboards>0,'Owner dashboards required');owner.close();
  const config=JSON.parse(await fs.readFile('/work/app/config/operations.json'));const inventory=JSON.parse(await fs.readFile('/work/app/config/inventory.json'));recoveryMembership(config,inventory);
  start('node',['server/index.mjs'],{PORT:'4310',METRICS_PORT:'4311',DATA_DIR:'/work/data',OPERATIONS_DISABLED:'true'},'/work/app');await ready('http://127.0.0.1:4310/healthz');await get('http://127.0.0.1:4310/');const restoredHealth=await(await get('http://127.0.0.1:4310/api/public/operations/health')).json();recoveryMembership(config,inventory,restoredHealth);const release=await(await get('http://127.0.0.1:4310/api/public/release')).json();assert(JSON.stringify(release).includes((await fs.readFile('/work/revision','utf8')).trim()));
  const provisioning='/work/configuration/grafana-owner/provisioning/dashboards/source.yaml';await fs.writeFile(provisioning,(await fs.readFile(provisioning,'utf8')).replaceAll('/var/lib/local-server-observability/grafana-owner/dashboards','/work/data/owner/dashboards'));
  await fs.writeFile('/work/grafana.ini',(await fs.readFile('/work/configuration/grafana-owner/grafana.ini','utf8'))+'\n[server]\nhttp_addr=127.0.0.1\nhttp_port=4300\nroot_url=http://127.0.0.1:4300/\nserve_from_sub_path=false\n[paths]\ndata=/work/data/owner\nlogs=/work/grafana-logs\nplugins=/work/plugins\nprovisioning=/work/configuration/grafana-owner/provisioning\n[auth.anonymous]\nenabled=true\norg_role=Admin\n[analytics]\nreporting_enabled=false\ncheck_for_updates=false\n[plugins]\npreinstall_disabled=true\n');
  start('/work/grafana/bin/grafana',['server','--homepath=/work/grafana','--config=/work/grafana.ini']);await ready('http://127.0.0.1:4300/api/health');let results=[];for(let attempt=0;attempt<120;attempt++){results=await(await get('http://127.0.0.1:4300/api/search?type=dash-db&limit=1000')).json();if(results.length>=dashboards)break;await new Promise(r=>setTimeout(r,500));}logs.push('dashboard-count '+results.length+' expected '+dashboards);assert(results.length>=dashboards);await get('http://127.0.0.1:4300/api/dashboards/uid/'+results[0].uid);
 }else if(['qwen','fantasy-qwen'].includes(id)){
  const {model}=JSON.parse(await fs.readFile('/work/model.json'));
  start('/work/ollama',['serve'],{OLLAMA_HOST:'127.0.0.1:11434',OLLAMA_MODELS:'/work/models',OLLAMA_NUM_PARALLEL:'1',OLLAMA_MAX_LOADED_MODELS:'1',OLLAMA_CONTEXT_LENGTH:'512',CUDA_VISIBLE_DEVICES:'-1',ROCR_VISIBLE_DEVICES:'-1',OLLAMA_VULKAN:'0',OLLAMA_LLM_LIBRARY:'cpu',LD_LIBRARY_PATH:'/work/lib/ollama'});
  await ready('http://127.0.0.1:11434/api/tags');const answer=await(await get('http://127.0.0.1:11434/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model,prompt:'Respond with the single word READY.',stream:false,keep_alive:0,options:{num_ctx:512,num_predict:8,num_thread:2,temperature:0}})})).json();assert(answer.done&&answer.response.trim().length&&answer.eval_count>0,'Actual isolated inference required');
  if(id==='qwen'){start('node',['server.mjs'],{PORT:'8788',TELEMETRY_PORT:'8791',OLLAMA_URL:'http://127.0.0.1:11434',OLLAMA_MODEL:model,LOCAL_AI_API_KEY:'isolated-only'},'/work/app');await ready('http://127.0.0.1:8788/health');}
  }else if(['nutsnews-backend','fantasy'].includes(id)){
  const pg='/usr/lib/postgresql/18/bin/';execute(pg+'initdb',['-D','/work/pgdata','-A','trust','--no-locale']);
  const postgres=start(pg+'postgres',['-D','/work/pgdata','-k','/tmp','-h','127.0.0.1','-p','55432']);
  for(let i=0;i<60;i++){try{execute(pg+'pg_isready',['-h','127.0.0.1','-p','55432']);break;}catch{await new Promise(r=>setTimeout(r,250));}}
  execute(pg+'createdb',['-h','127.0.0.1','-p','55432','restore']);
  const sql=q=>execute(pg+'psql',['-X','-h','127.0.0.1','-p','55432','-d','restore','-v','ON_ERROR_STOP=1','-Atc',q]);
  for(const role of ['anon','authenticated','service_role','nutsnews_app','nutsnews_readonly','nutsnews_worker_api','nutsnews_migration_restore','nutsnews_migration_validation'])sql('CREATE ROLE '+role+' NOLOGIN');
  execute(pg+'pg_restore',['--exit-on-error','--no-owner','--no-acl','-h','127.0.0.1','-p','55432','-d','restore','/work/database.dump']);
  if(id==='nutsnews-backend'){
    assert(Number(sql('select count(*) from public.articles'))>0,'Restored article data required');
    start('/usr/bin/python3',['/work/app/nutsnews_worker_db_api.py'],{PYTHONPATH:'/work/python',NUTSNEWS_WORKER_DB_API_DB_HOST:'127.0.0.1',NUTSNEWS_WORKER_DB_API_DB_PORT:'55432',NUTSNEWS_WORKER_DB_API_DB_NAME:'restore',NUTSNEWS_WORKER_DB_API_DB_USER:'nobody',NUTSNEWS_WORKER_DB_API_DB_PASSWORD:'isolated',NUTSNEWS_BACKEND_API_TOKEN:'isolated-token'});
    await ready('http://127.0.0.1:8093/readyz');
    const feed=await(await get('http://127.0.0.1:8093/api/app/db/load-public-feed-snapshot',{method:'POST',headers:{Authorization:'Bearer isolated-token','content-type':'application/json'},body:JSON.stringify({providerMode:'backend_postgres_shadow',limit:2})})).json();assert(Array.isArray(feed)&&feed.length>0,'Restored feed must contain articles');const expected=sql('select original_url from public.public_feed_snapshot order by snapshot_rank asc limit 2').split('\n');assert.deepEqual(feed.map(row=>row.original_url),expected);
  }else{
    const snapshots=Number(sql('select count(*) from snapshots'));assert(snapshots>0,'Saved Fantasy snapshots required');
    start('node',['--import','tsx','server/index.ts'],{DATABASE_URL:'postgresql://nobody:isolated@127.0.0.1:55432/restore',PORT:'3100',APP_ORIGIN:'http://127.0.0.1:3100'},'/work/app');
    await ready('http://127.0.0.1:3100/healthz');const dashboard=await(await get('http://127.0.0.1:3100/api/dashboard')).json();assert(JSON.stringify(dashboard).length>100,'Restored dashboard data required');await get('http://127.0.0.1:3100/');
  }
 }else throw Error('Unknown drill');
 await fs.writeFile('/work/result.json',JSON.stringify({application:id,verified:true}));
}finally{for(const p of children)p.kill('SIGTERM');await fs.writeFile('/work/application.log',logs.join(''));}
