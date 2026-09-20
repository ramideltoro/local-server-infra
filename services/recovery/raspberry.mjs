import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {run,json} from './lib.mjs';
export const ids=['raspberry'];
export const intervalMs=86400000, expiryMs=97200000;
// Backup readiness only. A full Pi boot/application restore is not implemented
// here and must never receive restore credit from archive verification.
const ssh=['-i','/etc/observe-recovery/raspberry-key','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile=/etc/observe-recovery/raspberry-known-hosts','-o','ConnectTimeout=15','piadmin@192.168.1.77'];
export function verifyMembers(text){
 const members=new Set(text.trim().split('\n').map(p=>p.replace(/^\.\//,'')));
 for(const name of ['boot/firmware/config.txt','boot/firmware/cmdline.txt','etc/fstab','etc/os-release','usr/bin/readsb','usr/lib/systemd/system/readsb.service','var/lib/dpkg/status'])if(!members.has(name))throw Error('Required Raspberry recovery component missing');
 if([...members].some(p=>p.startsWith('/')||p.split('/').includes('..')))throw Error('Unsafe Raspberry archive member');
 return true;
}
export async function revision(){const value=(await run('ssh',[...ssh,'revision'])).trim();if(!/^[a-f0-9]{64}$/.test(value))throw Error('Raspberry configuration revision unavailable');return value;}
export async function capture(id,revision,dir){
 const child=spawn('ssh',[...ssh,'archive'],{stdio:['ignore','pipe','pipe']});child.stderr.resume();
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('Raspberry backup stream failed')));});
 const timeout=setTimeout(()=>child.kill('SIGKILL'),1800000);
 try{await Promise.all([pipeline(child.stdout,createWriteStream(dir+'/root.tar.gz',{mode:0o600})),done]);}finally{clearTimeout(timeout);}
 await json(dir+'/deployment.json',{id,revision,scope:'Root filesystem, boot files, installed packages and service configuration; volatile files, caches and swap content excluded. Hardware boot restoration remains unverified.'});
}
export async function verifyBackup(id,dir){verifyMembers(await run('tar',['tzf',dir+'/root.tar.gz'],{timeout:900000}));}
