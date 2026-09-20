import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {spawn} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import {run,json,sandbox,writable} from './lib.mjs';
export const ids=['nutsnews-backend','fantasy'];
const args=['-i','/etc/observe-recovery/backend-key','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile=/etc/observe-recovery/backend-known-hosts','-o','ConnectTimeout=15','observe-recovery-export@65.75.201.18'];
async function read(action){return run('ssh',[...args,action]);}
async function download(action,file){const p=spawn('ssh',[...args,action],{stdio:['ignore','pipe','pipe']});let error='';p.stderr.on('data',b=>error=(error+b).slice(-4000));const completed=new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',c=>c===0?resolve():reject(Error('Backend export failed: '+action)));});const timeout=setTimeout(()=>p.kill('SIGKILL'),600000);try{await Promise.all([pipeline(p.stdout,createWriteStream(file,{mode:0o600})),completed]);}finally{clearTimeout(timeout);}}
export async function revision(id){const value=(await read(id==='fantasy'?'fantasy-revision':'backend-revision')).trim();if(!/^(sha256:)?[a-f0-9]{64}$/.test(value))throw Error('Deployed revision unavailable');return value;}
export async function capture(id,revision,dir){const prefix=id==='fantasy'?'fantasy':'backend';await download(prefix+'-database',dir+'/database.dump');await download(prefix+'-app',dir+'/app.tar');await download(prefix+'-config',dir+'/configuration');await fs.mkdir(dir+'/app');await run('tar',['xf',dir+'/app.tar','--no-same-owner','-C',dir+'/app']);
 if(id==='nutsnews-backend'){await download('backend-dependencies',dir+'/python.tar');await fs.mkdir(dir+'/python');await run('tar',['xf',dir+'/python.tar','--no-same-owner','-C',dir+'/python']);}
 await json(dir+'/deployment.json',{id,revision,backup:'consistent-logical-export-or-saved-application-backup'});
}
export async function prepare(id,dir){await writable(dir);if(id==='fantasy')await sandbox(dir+'/app',['/bin/bash','-c','npm ci --ignore-scripts --no-audit --no-fund'],{network:true,timeout:900000});}
export async function restore(id,dir){await sandbox(dir,['node','/work/smoke.mjs',id],{postgres:true,timeout:900000});}
