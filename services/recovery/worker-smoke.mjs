// Executed only in the recovery controller's private network/PID/mount namespace.
import fs from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
const name=process.argv[2];
assert(['fetcher','canonicalizer','enrichment','approval','persistence','publication'].includes(name));
const children=[],logs=[];const baseEnv={PATH:'/usr/lib/postgresql/18/bin:/usr/local/bin:/usr/bin:/bin',HOME:'/tmp',LANG:'C.UTF-8'};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function start(cmd,args,extra={},cwd='/work'){const p=spawn(cmd,args,{cwd,env:{...baseEnv,...extra},stdio:['ignore','pipe','pipe']});p.on('error',e=>logs.push(e.message));p.stdout.on('data',b=>logs.push(b.toString()));p.stderr.on('data',b=>logs.push(b.toString()));children.push(p);return p;}
function exec(cmd,args){const r=spawnSync(cmd,args,{env:baseEnv,encoding:'utf8',timeout:300000,maxBuffer:30*1024*1024});if(r.status){logs.push(r.stderr||'');throw Error(cmd+' failed');}return r.stdout.trim();}
async function ready(url){for(let n=0;n<120;n++){try{const r=await fetch(url,{signal:AbortSignal.timeout(1000)});if(r.ok)return r;}catch{}await pause(500);}throw Error('Restored dependency not ready: '+url);}
function parseEnv(text){return Object.fromEntries(text.split('\n').filter(l=>/^[A-Z][A-Z0-9_]*=/.test(l)).map(l=>{const i=l.indexOf('=');let v=l.slice(i+1);if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);return [l.slice(0,i),v];}));}
function localUrl(value,port,password){const u=new URL(value);u.hostname='127.0.0.1';u.port=String(port);if(password)u.password=password;return u.toString();}
let connection,pool;
try{
 const dev=await fs.readFile('/proc/net/dev','utf8');assert(!/^\s*(eth|en|wl)/m.test(dev));assert.equal(await fs.stat('/run/postgresql').catch(()=>null),null);
 const original=JSON.parse(await fs.readFile('/work/environment.json'));const env=Object.fromEntries(original.map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)];}));
 const pg='/usr/lib/postgresql/18/bin/';exec(pg+'initdb',['-D','/work/pgdata','-A','trust','--no-locale','-U','postgres']);
 start(pg+'postgres',['-D','/work/pgdata','-k','/tmp','-h','127.0.0.1','-p','55432']);
 for(let n=0;n<100;n++){try{exec(pg+'pg_isready',['-h','127.0.0.1','-p','55432']);break;}catch{}await pause(100);}
 const args=['-X','-h','127.0.0.1','-p','55432','-U','postgres','-v','ON_ERROR_STOP=1'];
 await fs.writeFile('/work/roles.restore.sql',(await fs.readFile('/work/roles.sql','utf8')).replace(/^CREATE ROLE postgres;\r?$/m,''));
 exec(pg+'psql',[...args,'-d','postgres','-f','/work/roles.restore.sql']);
 exec(pg+'createdb',['-h','127.0.0.1','-p','55432','-U','postgres','nutsnews_primary_shadow']);
 exec(pg+'pg_restore',['--exit-on-error','-h','127.0.0.1','-p','55432','-U','postgres','-d','nutsnews_primary_shadow','/work/database.dump']);
 const sql=q=>exec(pg+'psql',[...args,'-d','nutsnews_primary_shadow','-Atc',q]);
 const schema='worker_uplift_'+name;const count=Number(sql('SELECT count(*) FROM '+schema+'.inbox'));assert(count>0,'Actual restored worker state required');
 let row=JSON.parse(sql("SELECT row_to_json(x) FROM (SELECT * FROM "+schema+".inbox WHERE status='processed' ORDER BY id DESC LIMIT 1) x"));
 let storedCarrier;
 if(name==='persistence'){
  const saved=sql("SELECT json_build_object('row',row_to_json(i),'carrier',o.diagnostic_metadata) FROM worker_uplift_persistence.inbox i JOIN (SELECT idempotency_key,diagnostic_metadata FROM worker_uplift_translation.outbox UNION ALL SELECT idempotency_key,diagnostic_metadata FROM worker_uplift_approval.outbox) o USING (idempotency_key) WHERE i.status='processed' AND jsonb_typeof(o.diagnostic_metadata->'payload')='object' AND o.diagnostic_metadata->'envelope'->>'messageId'=i.message_id::text ORDER BY i.id DESC LIMIT 1");
  assert(saved,'A completed persistence message with its original backed-up payload is required');const pair=JSON.parse(saved);row=pair.row;storedCarrier=pair.carrier;
 }
 const password=randomBytes(24).toString('hex');const definitions=JSON.parse(await fs.readFile('/work/definitions.json'));delete definitions.x_nutsnews_sanitized;
 for(const u of definitions.users){delete u.password_hash;delete u.hashing_algorithm;u.password=password;}
 definitions.users.push({name:'observe_restore',password,tags:['administrator']});definitions.permissions.push({user:'observe_restore',vhost:'nutsnews-worker-uplift',configure:'.*',write:'.*',read:'.*'});
 await fs.writeFile('/work/definitions.local.json',JSON.stringify(definitions));
 for(const d of ['broker-data','broker-log'])await fs.mkdir('/work/'+d);
 await fs.writeFile('/work/rabbitmq.conf','listeners.tcp.default = 5672\nmanagement.tcp.port = 15672\nmanagement.tcp.ip = 127.0.0.1\ndefinitions.import_backend = local_filesystem\ndefinitions.local.path = /work/definitions.local.json\nloopback_users.guest = true\n');
 start('/opt/rabbitmq/sbin/rabbitmq-server',[],{PATH:'/opt/erlang/bin:/opt/rabbitmq/sbin:'+baseEnv.PATH,HOME:'/work/broker-data',LD_LIBRARY_PATH:'/work/broker/lib:/work/broker/usr/lib:/opt/openssl/lib',RABBITMQ_NODENAME:'rabbit@localhost',RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS:'+S 2:2 +SDcpu 1 +SDio 1',RABBITMQ_MNESIA_BASE:'/work/broker-data/mnesia',RABBITMQ_LOG_BASE:'/work/broker-log',RABBITMQ_PID_FILE:'/work/broker-data/rabbit.pid',RABBITMQ_PLUGINS_EXPAND_DIR:'/work/broker-data/plugins',RABBITMQ_ENABLED_PLUGINS_FILE:'/work/broker/etc/rabbitmq/enabled_plugins',RABBITMQ_CONFIG_FILE:'/work/rabbitmq'});
 for(let n=0;n<120;n++){try{const r=await fetch('http://127.0.0.1:15672/api/overview',{headers:{Authorization:'Basic '+Buffer.from('observe_restore:'+password).toString('base64')},signal:AbortSignal.timeout(1000)});if(r.ok)break;}catch{}if(n===119)throw Error('Restored broker not ready');await pause(500);}
 for(const [k,v]of Object.entries(env)){if(k.endsWith('_DATABASE_URL'))env[k]=localUrl(v,55432);if(k.endsWith('_RABBITMQ_URL'))env[k]=localUrl(v,5672,password);if(k.endsWith('_BACKEND_API_BASE_URL'))env[k]='http://127.0.0.1:8093';if(k.endsWith('_HTTP_HOST'))env[k]='127.0.0.1';if(k.endsWith('_HTTP_PORT'))env[k]='8080';if(k.endsWith('_QWEN_BASE_URL'))env[k]='http://127.0.0.1:8788';}
 if(['persistence','publication'].includes(name)){const backend=parseEnv(await fs.readFile('/work/backend.env','utf8'));Object.assign(backend,{PYTHONPATH:'/work/python',NUTSNEWS_WORKER_DB_API_DB_HOST:'127.0.0.1',NUTSNEWS_WORKER_DB_API_DB_PORT:'55432'});start('/usr/bin/python3',['/work/backend/nutsnews_worker_db_api.py'],backend);await ready('http://127.0.0.1:8093/readyz');}
 if(name==='approval'){const {model}=JSON.parse(await fs.readFile('/work/qwen/model.json'));start('/work/qwen/ollama',['serve'],{OLLAMA_HOST:'127.0.0.1:11434',OLLAMA_MODELS:'/work/qwen/models',OLLAMA_NUM_PARALLEL:'1',OLLAMA_MAX_LOADED_MODELS:'1',CUDA_VISIBLE_DEVICES:'-1',ROCR_VISIBLE_DEVICES:'-1',OLLAMA_VULKAN:'0',OLLAMA_LLM_LIBRARY:'cpu',LD_LIBRARY_PATH:'/work/qwen/lib/ollama'});await ready('http://127.0.0.1:11434/api/tags');const answer=await(await fetch('http://127.0.0.1:11434/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model,prompt:'Respond with READY.',stream:false,keep_alive:0,options:{num_ctx:512,num_predict:8,num_thread:2,temperature:0}}),signal:AbortSignal.timeout(300000)})).json();assert(answer.done&&answer.response?.trim()&&answer.eval_count>0,'Isolated Qwen inference required');start('node',['server.mjs'],{PORT:'8788',TELEMETRY_PORT:'8791',OLLAMA_URL:'http://127.0.0.1:11434',OLLAMA_MODEL:model,LOCAL_AI_API_KEY:env.NUTSNEWS_APPROVAL_QWEN_API_KEY||'isolated-only'},'/work/qwen/app');await ready('http://127.0.0.1:8788/health');}
 start('node',['dist/src/index.js'],env,'/work/app');await ready('http://127.0.0.1:8080/readyz');
 const {default:amqp}=await import('/work/app/node_modules/amqplib/channel_api.js');connection=await amqp.connect('amqp://observe_restore:'+password+'@127.0.0.1:5672/nutsnews-worker-uplift');const channel=await connection.createConfirmChannel();
 const stage={fetcher:'fetch',canonicalizer:'canonicalization'}[name]||name;const contracts=await import('/work/app/node_modules/@ramideltoro/nutsnews-worker-contracts/dist/index.js');const route=contracts.getWorkerRoute(stage);
 const at=new Date().toISOString();let envelope={schemaId:'nutsnews.worker.envelope.v1',schemaVersion:1,route:stage,messageId:row.message_id,causationId:row.source_message_id,correlationId:row.pipeline_run_id,traceparent:'00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',idempotencyKey:row.idempotency_key,aggregate:{type:row.entity_kind,id:row.entity_id,version:row.operation_version},occurredAt:at,attempt:{count:1,max:contracts.WORKER_DELIVERY_BEHAVIOR.maxAttempts,firstAttemptAt:at},producer:{name:row.source_stage,version:'1.0.0'},payloadRef:{kind:'backend-record',uri:row.payload_ref,mediaType:'application/json',sizeBytes:2,digest:/^[a-f0-9]{64}$/.test(row.payload_digest)?'sha256:'+row.payload_digest:row.payload_digest}};
 assert(contracts.validateWorkerEnvelope(envelope).ok,'Restored message envelope must validate');
 const fixture=contracts.STAGE_PAYLOAD_FIXTURES.find(f=>contracts.validateStagePayload(f.payload).definition?.consumer===route.consumer);assert(fixture,'Replay carrier schema required');let payload={...fixture.payload,pipelineRunId:row.pipeline_run_id,sourceMessageId:row.source_message_id,idempotencyKey:row.idempotency_key};if(storedCarrier){envelope=storedCarrier.envelope;payload=storedCarrier.payload;assert.equal(envelope.idempotencyKey,row.idempotency_key);assert(contracts.validateWorkerEnvelope(envelope).ok);const {sha256Digest}=await import('/work/app/dist/src/digest.js');assert.equal(sha256Digest({aggregate:envelope.aggregate,payload}),row.payload_digest,'Original backed-up message fingerprint must match');}assert(contracts.validateStagePayload(payload).ok);
 channel.publish(route.exchange,route.routingKey,Buffer.from(JSON.stringify({envelope,payload})),{persistent:true,contentType:'application/json',messageId:envelope.messageId});await channel.waitForConfirms();
 for(let n=0;n<120&&!logs.some(s=>s.includes('runtime.message.duplicate'));n++)await pause(250);
 assert(logs.some(s=>s.includes('runtime.message.duplicate')),'Restored worker must recognize completed work, not process it twice');
 assert.equal(Number(sql('SELECT count(*) FROM '+schema+'.inbox')),count);const after=JSON.parse(sql('SELECT row_to_json(x) FROM (SELECT * FROM '+schema+'.inbox WHERE id='+Number(row.id)+') x'));assert.deepEqual(after,row,'Replay must preserve the original completed record');
 const q=await channel.checkQueue(route.mainQueue.name);assert.equal(q.messageCount,0);await channel.close();await connection.close();connection=null;
 await fs.writeFile('/work/result.json',JSON.stringify({worker:name,restoredInboxRows:count,readiness:true,duplicateReplay:true,recordPreserved:true,scope:'Restored deployed worker and dependencies; replay of completed backed-up work'}));
}finally{try{await connection?.close();}catch{}for(const p of children)p.kill('SIGTERM');await fs.writeFile('/work/application.log',logs.join(''));}
