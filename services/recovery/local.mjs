import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {base,run,copy,sqliteBackup,json,hash,envFile,sandbox} from './lib.mjs';
export const ids=['kubequest','observability','qwen','fantasy-qwen'];
const portal='/opt/local-server-observability/current',modelRoot='/usr/share/ollama/.ollama/models';
async function qwenConfig(id){return id==='qwen'?await envFile('/opt/nutsnews/local-ai-service/.env'):{OLLAMA_MODEL:'qwen2.5:3b'};}
export async function revision(id){if(id==='kubequest')return JSON.parse(await fs.readFile('/opt/kubequest/current/RELEASE.json')).revision;
 if(id==='observability')return JSON.parse(await fs.readFile(portal+'/release.json')).portal;
 const e=await qwenConfig(id),model=e.OLLAMA_MODEL;if(!/^qwen2\.5:[a-z0-9]+$/.test(model))throw Error('Unrecognized deployed model');
 const parts=[await hash(modelRoot+'/manifests/registry.ollama.ai/library/qwen2.5/'+model.split(':')[1]),await hash('/usr/local/bin/ollama'),await run('systemctl',['cat',id==='qwen'?'nutsnews-local-ai':'fantasy-qwen'])];if(id==='qwen')parts.push(await hash('/opt/nutsnews/local-ai-service/server.mjs'),await hash('/opt/nutsnews/local-ai-service/telemetry.mjs'),await hash('/opt/nutsnews/local-ai-service/.env'));return createHash('sha256').update(parts.join('\n')).digest('hex');}
export async function capture(id,revision,dir){
 if(id==='kubequest'){
  await copy('/opt/kubequest/current',dir+'/app');await fs.mkdir(dir+'/data');
  const backups=(await fs.readdir('/var/lib/kubequest/backups')).filter(n=>/^progress-.*\.sqlite$/.test(n)).sort();if(!backups.length)throw Error('No KubeQuest backup');
  const b='/var/lib/kubequest/backups/'+backups.at(-1);if(Date.now()-(await fs.stat(b)).mtimeMs>8*86400000)throw Error('KubeQuest backup stale');await copy(b,dir+'/data/kubequest.sqlite');await json(dir+'/source-backup.json',{name:backups.at(-1),hash:await hash(b)});
 }else if(id==='observability'){
  await copy(portal,dir+'/app');await fs.mkdir(dir+'/data');await fs.mkdir(dir+'/data/owner');
  await sqliteBackup('/var/lib/local-server-observability/operations.db',dir+'/data/operations.db');
  await sqliteBackup('/var/lib/local-server-observability/grafana-owner/grafana.db',dir+'/data/owner/grafana.db');
  await copy('/var/lib/local-server-observability/state.json',dir+'/data/state.json');await copy('/var/lib/local-server-observability/grafana-owner/dashboards',dir+'/data/owner/dashboards');
  await copy('/etc/local-server-observability',dir+'/configuration');await copy('/opt/observe-grafana-13.2.1',dir+'/grafana');
 }else{
  const env=await qwenConfig(id),tag=env.OLLAMA_MODEL.split(':')[1],manifest='manifests/registry.ollama.ai/library/qwen2.5/'+tag;
  await fs.mkdir(dir+'/models/manifests/registry.ollama.ai/library/qwen2.5',{recursive:true});await fs.mkdir(dir+'/models/blobs');await copy(modelRoot+'/'+manifest,dir+'/models/'+manifest);
  const m=JSON.parse(await fs.readFile(modelRoot+'/'+manifest));for(const layer of [m.config,...m.layers]){if(!/^sha256:[a-f0-9]{64}$/.test(layer.digest))throw Error('Invalid model digest');const name=layer.digest.replace(':','-');await copy(modelRoot+'/blobs/'+name,dir+'/models/blobs/'+name);if(await hash(dir+'/models/blobs/'+name)!==layer.digest.slice(7))throw Error('Corrupt model dependency');}
  await copy('/usr/local/bin/ollama',dir+'/ollama');await fs.mkdir(dir+'/lib/ollama',{recursive:true});for(const entry of await fs.readdir('/usr/local/lib/ollama',{withFileTypes:true}))if(!entry.isDirectory())await copy('/usr/local/lib/ollama/'+entry.name,dir+'/lib/ollama/'+entry.name);
  await json(dir+'/model.json',{model:env.OLLAMA_MODEL});await fs.writeFile(dir+'/service.conf',await run('systemctl',['cat',id==='qwen'?'nutsnews-local-ai':'fantasy-qwen']));
  if(id==='qwen'){await copy('/opt/nutsnews/local-ai-service',dir+'/app');await json(dir+'/configuration.json',env);}
 }
 await fs.writeFile(dir+'/revision',revision);
}
export async function restore(id,dir){await sandbox(dir,['node','/work/smoke.mjs',id],{timeout:900000});}
