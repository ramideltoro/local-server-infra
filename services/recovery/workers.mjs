import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {run,json,sandbox} from './lib.mjs';
import * as localApps from './local.mjs';
export const ids=['scheduler','fetcher','canonicalizer','enrichment','approval','translation','persistence','publication'].map(x=>'nutsnews-'+x);
const ssh=['-i','/etc/observe-recovery/backend-key','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile=/etc/observe-recovery/backend-known-hosts','-o','ConnectTimeout=15','observe-recovery-export@65.75.201.18'];
const service=id=>{if(!ids.includes(id))throw Error('Unknown worker');return id.slice(9);};
async function read(action){return run('ssh',[...ssh,action]);}
async function download(action,file){const p=spawn('ssh',[...ssh,action],{stdio:['ignore','pipe','pipe']});p.stderr.resume();const done=new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',c=>c===0?resolve():reject(Error('Worker export failed: '+action)));});const timer=setTimeout(()=>p.kill('SIGKILL'),600000);try{await Promise.all([pipeline(p.stdout,createWriteStream(file,{mode:0o600})),done]);}finally{clearTimeout(timer);}}
export async function revision(id){const rev=(await read('worker-'+service(id)+'-revision')).trim();if(!/^[a-f0-9]{64}$/.test(rev))throw Error('Worker revision unavailable');const dependencies=[rev];if(['scheduler','persistence','publication'].includes(service(id)))dependencies.push((await read('backend-revision')).trim());if(['approval','translation'].includes(service(id)))dependencies.push(await localApps.revision('qwen'));return dependencies.length===1?rev:createHash('sha256').update(JSON.stringify(dependencies)).digest('hex');}
export function emptyQueues(text){
 const rows=text.trim().split('\n').map(l=>l.trim()).filter(l=>l&&!/^name\s+messages$/.test(l));
 if(!rows.length||rows.some(l=>!/^[-a-zA-Z0-9._]+\s+0$/.test(l)))throw Error('Queue message backup required; live queues are not empty or verified');
 const names=new Set(rows.map(l=>l.split(/\s+/)[0]));
 for(const stage of ['fetch','canonicalization','enrichment','approval','persistence','publication'])if(!names.has('nutsnews.worker.'+stage+'.v1'))throw Error('Required worker queue missing');
 return rows.length;
}
export async function capture(id,rev,dir){const name=service(id);const before=await read('broker-queues');const count=emptyQueues(before);await download('worker-'+name+'-app',dir+'/app.tar');await download('worker-'+name+'-config',dir+'/environment.json');await download('worker-database',dir+'/database.dump');await download('worker-roles',dir+'/roles.sql');await download('broker-definitions',dir+'/definitions.json');await download('broker-runtime',dir+'/broker.tar');await download('backend-app',dir+'/backend.tar');await download('backend-config',dir+'/backend.env');await download('backend-dependencies',dir+'/python.tar');emptyQueues(await read('broker-queues'));
 for(const [file,target]of [['app','app'],['broker','broker'],['backend','backend'],['python','python']]){await fs.mkdir(dir+'/'+target);await run('tar',['xf',dir+'/'+file+'.tar','--no-same-owner','-C',dir+'/'+target],{timeout:600000});await fs.rm(dir+'/'+file+'.tar');}
 if(['approval','translation'].includes(name)){await fs.mkdir(dir+'/qwen');await localApps.capture('qwen',await localApps.revision('qwen'),dir+'/qwen');}
 await json(dir+'/deployment.json',{id,revision:rev,scope:'Deployed worker, durable database state and broker topology; empty production queues verified before and after capture',emptyQueues:count});
}
export async function restore(id,dir){for(const file of ['worker-smoke.mjs','worker-environment.mjs'])await fs.copyFile(new URL('./'+file,import.meta.url),dir+'/'+file);await sandbox(dir,['node','/work/worker-smoke.mjs',service(id)],{postgres:true,broker:true,timeout:900000});}
