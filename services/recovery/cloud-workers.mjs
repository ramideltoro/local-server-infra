import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {envFile,json,sandbox} from './lib.mjs';
import * as backend from './backend.mjs';
export const ids=['nutsnews-cloud-workers'];
export const scripts=['nutsnews-worker-0','nutsnews-worker-1','nutsnews-worker-2'];
async function client(){const c=await envFile('/etc/observe-recovery/credentials.env');return async(route,raw=false)=>{
 const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${c.CLOUDFLARE_ACCOUNT_ID}`+route,{headers:{Authorization:'Bearer '+c.CLOUDFLARE_API_TOKEN},signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('Cloudflare backup source unavailable');if(raw)return r;
 const d=await r.json();if(d.success!==true)throw Error('Cloudflare backup source unsuccessful');return d;
};}
export function validateSettings(settings){
 if(!Array.isArray(settings?.bindings)||!settings.compatibility_date)throw Error('Cloudflare configuration missing');
 if(settings.bindings.some(b=>!['plain_text','secrets_store_secret','kv_namespace'].includes(b.type)))throw Error('Unsupported durable dependency in Cloudflare deployment');
 const vars=Object.fromEntries(settings.bindings.filter(b=>b.type==='plain_text').map(b=>[b.name,b.text]));
 if(vars.NUTSNEWS_DATABASE_PROVIDER_MODE!=='backend_postgres_primary')throw Error('Recovery requires the actual backend production database provider');
 if(!settings.bindings.some(b=>b.name==='NUTSNEWS_KV'&&b.namespace_id))throw Error('Deployed KV namespace missing');
 return vars;
}
export function safeModule(name){if(typeof name!=='string'||!name||name.startsWith('/')||name.includes('\\')||name.split('/').some(p=>!p||p==='..'||p==='.')||!name.endsWith('.js'))throw Error('Unsafe or unsupported deployed module');return name;}
export async function revision(){
 const get=await client(),parts=[];
 for(const name of scripts){const d=await get('/workers/scripts/'+name+'/deployments'),s=(await get('/workers/scripts/'+name+'/settings')).result;validateSettings(s);const versions=d.result?.deployments?.[0]?.versions;if(versions?.length!==1||versions[0].percentage!==100)throw Error('Split deployment cannot establish one recovery revision');parts.push({name,versions,settings:s});}
 parts.push(await backend.revision('nutsnews-backend'));
 return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}
export async function capture(id,rev,dir){
 await backend.capture('nutsnews-backend',await backend.revision('nutsnews-backend'),dir);
 const get=await client(),deployments=[],namespaces={};await fs.mkdir(dir+'/cloud');
 for(const name of scripts){
  const settings=(await get('/workers/scripts/'+name+'/settings')).result;validateSettings(settings);
  const source=await get('/workers/scripts/'+name,true),entrypoint=safeModule(source.headers.get('cf-entrypoint'));
  const form=await source.formData(),moduleDir=dir+'/cloud/'+name;await fs.mkdir(moduleDir);
  let count=0;for(const [module,value]of form){safeModule(module);await fs.mkdir(path.dirname(moduleDir+'/'+module),{recursive:true});await fs.writeFile(moduleDir+'/'+module,typeof value==='string'?value:Buffer.from(await value.arrayBuffer()),{mode:0o600});count++;}
  if(!count)throw Error('Deployed worker code missing');await fs.access(moduleDir+'/'+entrypoint);
  const ns=settings.bindings.find(b=>b.name==='NUTSNEWS_KV').namespace_id;
  if(!namespaces[ns]){
   const listed=await get('/storage/kv/namespaces/'+ns+'/keys?limit=1000');
   if(listed.result_info?.cursor||!listed.result?.length)throw Error('KV backup incomplete or empty');
   const entries=[];let bytes=0;
   for(const key of listed.result){const value=Buffer.from(await(await get('/storage/kv/namespaces/'+ns+'/values/'+encodeURIComponent(key.name),true)).arrayBuffer());bytes+=value.length;if(bytes>32*1024*1024)throw Error('KV backup exceeds bounded snapshot capacity');entries.push({name:key.name,metadata:key.metadata,expiration:key.expiration,value:value.toString('base64')});}
   namespaces[ns]=entries;
  }
  deployments.push({name,settings,entrypoint,namespace:ns});
 }
 await json(dir+'/cloud/deployments.json',deployments);await json(dir+'/cloud/kv.json',namespaces);
 await fs.mkdir(dir+'/runtime');for(const file of ['package.json','package-lock.json'])await fs.copyFile(new URL('./cloud-runtime/'+file,import.meta.url),dir+'/runtime/'+file);
 await json(dir+'/deployment.json',{id,revision:rev,scope:'Three deployed production ingestion shards, their real KV state, production backend configuration and nonempty database. Isolated duplicate replay and public-feed behavior; production throughput remains separate.'});
}
export async function prepare(id,dir){
 // Only dependency manifests are exposed to package installation networking.
 await sandbox(dir+'/runtime',['npm','ci','--no-audit','--no-fund'],{network:true,timeout:900000});
}
export async function restore(id,dir){await fs.copyFile(new URL('./cloud-smoke.mjs',import.meta.url),dir+'/cloud-smoke.mjs');await sandbox(dir,['node','/work/smoke.mjs',id],{postgres:true,timeout:900000});}
