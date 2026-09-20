import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createReadStream,createWriteStream} from 'node:fs';
import {createHash,createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
export const base='/var/lib/observe-recovery';
export async function run(cmd,args=[],options={}) {
  return new Promise((resolve,reject)=>{const p=spawn(cmd,args,{stdio:['ignore','pipe','pipe'],...options});let out='',err='';
    p.stdout?.on('data',b=>out+=b);p.stderr?.on('data',b=>{err=(err+b).slice(-20000)});
    const timer=setTimeout(()=>p.kill('SIGKILL'),options.timeout||120000);p.on('error',reject);p.on('close',code=>{clearTimeout(timer);code===0?resolve(out):reject(Object.assign(Error(`${cmd} exited ${code}`),{detail:err}));});
  });
}
export async function envFile(p){const s=await fs.readFile(p,'utf8');return Object.fromEntries(s.split('\n').filter(l=>/^[A-Z_][A-Z0-9_]*=/.test(l)).map(l=>{const n=l.indexOf('=');let v=l.slice(n+1);if((v[0]==='"'&&v.at(-1)==='"')||(v[0]==="'"&&v.at(-1)==="'"))v=v.slice(1,-1);return [l.slice(0,n),v]}));}
export async function hash(p){const h=createHash('sha256');for await(const c of createReadStream(p))h.update(c);return h.digest('hex')}
export async function seal(input,output,key){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);await fs.writeFile(output,Buffer.concat([Buffer.from('OR01'),iv]),{mode:0o600});await pipeline(createReadStream(input),c,createWriteStream(output,{flags:'a'}));await fs.appendFile(output,c.getAuthTag());}
export async function unseal(input,output,key){const f=await fs.open(input);const header=Buffer.alloc(16),tag=Buffer.alloc(16),size=(await f.stat()).size;await f.read(header,0,16,0);await f.read(tag,0,16,size-16);await f.close();if(header.subarray(0,4).toString()!=='OR01')throw Error('Invalid archive');const c=createDecipheriv('aes-256-gcm',key,header.subarray(4));c.setAuthTag(tag);await pipeline(createReadStream(input,{start:16,end:size-17}),c,createWriteStream(output,{mode:0o600}));}
export async function sandbox(work,command,{network=false,timeout=600000,postgres=false}={}) {
  const a=['--unshare-all','--die-with-parent','--new-session','--clearenv','--ro-bind','/usr','/usr','--symlink','usr/bin','/bin','--symlink','usr/lib','/lib','--symlink','usr/lib64','/lib64','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--tmpfs','/run','--dir','/etc','--ro-bind','/etc/passwd','/etc/passwd','--ro-bind','/etc/group','/etc/group','--ro-bind','/etc/hosts','/etc/hosts','--bind',work,'/work','--chdir','/work','--setenv','HOME','/tmp','--setenv','PATH','/usr/local/bin:/usr/bin:/bin','--setenv','LANG','C.UTF-8','--uid','65534','--gid','65534','--cap-drop','ALL'];
  if(network){a.push('--share-net','--ro-bind','/etc/resolv.conf','/etc/resolv.conf','--ro-bind','/etc/ssl','/etc/ssl');}
  if(postgres)a.push('--ro-bind',base+'/runtime/pg/usr/lib/postgresql/18','/usr/lib/postgresql/18','--ro-bind',base+'/runtime/pg/usr/share/postgresql/18','/usr/share/postgresql/18');
  return run('bwrap',[...a,...command],{timeout});
}
export async function copy(from,to){await fs.cp(from,to,{recursive:true,dereference:true});}
export async function sqliteBackup(from,to){await run('sqlite3',[from,`.backup '${to.replaceAll("'","''")}'`]);const r=await run('sqlite3',[to,'PRAGMA integrity_check;']);if(r.trim()!=='ok')throw Error('SQLite integrity failed');}
export async function writable(dir){await run('chown',['-R','root:root',dir]);}
export async function json(p,value){await fs.writeFile(p,JSON.stringify(value,null,2)+'\n',{mode:0o600});}
