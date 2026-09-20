// Run through the shared recovery lock and the 2 CPU / 8 GiB systemd limit.
import fs from 'node:fs/promises';import path from 'node:path';import {run,envFile,base,hash,writable,sandbox,seal,json} from './lib.mjs';
const e=await envFile('/etc/nutsnews-backup/nutsnews-db-backup.env'),env={...process.env,RCLONE_CONFIG:'/home/rami/.config/rclone/rclone.conf'},remote=e.REMOTE_NAME+':'+e.REMOTE_PATH;
const latest=(await run('rclone',['lsf',remote,'--dirs-only'],{env})).trim().split('\n').sort().at(-1).replace(/\/$/,'');const dir=base+'/staging/cloud-complete-'+Date.now();await fs.mkdir(dir,{mode:0o700});
await run('rclone',['copy',remote+'/'+latest,dir],{env,timeout:900000});for(const line of (await fs.readFile(dir+'/SHA256SUMS','utf8')).trim().split('\n')){const [expected,name]=line.split(/\s+/);const relative=name.includes('/metadata/')?'metadata/'+path.basename(name):path.basename(name);if(await hash(dir+'/'+relative)!==expected)throw Error('Downloaded checksum mismatch');}
await fs.writeFile(dir+'/restore.sh',`set -euo pipefail
export PATH=/usr/lib/postgresql/18/bin:$PATH
initdb -D /work/pgdata -A trust --no-locale >/work/init.log 2>&1
pg_ctl -D /work/pgdata -l /work/postgres.log -o "-k /tmp -h 127.0.0.1 -p 55432" start
trap 'pg_ctl -D /work/pgdata -m immediate stop' EXIT
createdb -h /tmp -p 55432 restore
sed -n '/^CREATE ROLE /p' /work/metadata/roles.sql > /work/role-names.sql
psql -X -h /tmp -p 55432 -d restore -v ON_ERROR_STOP=1 -f /work/role-names.sql > /work/roles.log 2>&1
psql -X -h /tmp -p 55432 -d restore -v ON_ERROR_STOP=1 -f /work/metadata/auth-schema.sql > /work/auth.log 2>&1
zcat /work/nutsnews-db-public-tables.sql.gz | /usr/bin/mawk '{print; if ($0 == "CREATE SCHEMA public;") {while ((getline line < "/work/metadata/extensions.sql") > 0) print line}}' | psql -X -h /tmp -p 55432 -d restore -v ON_ERROR_STOP=1 > /work/restore.log 2>&1
psql -X -h /tmp -p 55432 -d restore -Atc 'select count(*) from public.articles' > /work/restored-articles.count
`);await writable(dir);try{await sandbox(dir,['/bin/bash','/work/restore.sh'],{postgres:true});const count=Number(await fs.readFile(dir+'/restored-articles.count','utf8'));if(!Number.isInteger(count)||count<1)throw Error('Restored articles missing');await json(dir+'/result.json',{backup:latest,restoredArticles:count,passed:true,at:new Date().toISOString()});console.log('Cloud database restore passed: '+latest+'; restored articles='+count);}catch(error){console.log(error.message);for(const f of ['roles.log','extensions.log','auth.log','restore.log']){const t=await fs.readFile(dir+'/'+f,'utf8').catch(()=>'');console.log(t.split('\n').filter(l=>/ERROR|FATAL/.test(l)).join('\n'));}process.exitCode=1;}finally{const verification=dir+'/verification';await fs.mkdir(verification);for(const name of ['result.json','roles.log','auth.log','extensions.log','restore.log','restored-articles.count']){try{await fs.copyFile(dir+'/'+name,verification+'/'+name);}catch(e){if(e.code!=='ENOENT')throw e;}}const tar=dir+'.tar';await run('tar',['cf',tar,'-C',verification,'.']);await seal(tar,base+'/private/local-database-'+Date.now()+'.enc',await fs.readFile('/etc/observe-recovery/key'));await fs.rm(tar);await fs.rm(dir,{recursive:true});}
