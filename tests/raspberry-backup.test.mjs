import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as pi from '../services/recovery/raspberry.mjs';
const members=['boot/firmware/config.txt','boot/firmware/cmdline.txt','etc/fstab','etc/os-release','usr/bin/readsb','usr/lib/systemd/system/readsb.service','var/lib/dpkg/status'];
test('Pi backup requires boot, root configuration, receiver runtime and package inventory',()=>{
 assert.equal(pi.verifyMembers(members.map(n=>'./'+n).join('\n')),true);
 for(const missing of members)assert.throws(()=>pi.verifyMembers(members.filter(n=>n!==missing).join('\n')),/missing/);
 for(const unsafe of ['/etc/shadow','../outside','ok/../../outside'])assert.throws(()=>pi.verifyMembers([...members,unsafe].join('\n')),/Unsafe/);
});
test('backup-only provider never claims a restore and renews before unchanged freshness target',()=>{
 assert.equal(pi.restore,undefined);
 assert.equal(pi.intervalMs,86400000);
 assert.equal(pi.expiryMs,97200000);
});
test('exporter streams off-host and rejects arbitrary commands',async()=>{
 const script=await readFile(new URL('../services/raspberry/recovery-export.sh',import.meta.url),'utf8');
 assert.match(script,/case "\$\{1:-\}"/);assert.match(script,/\*\) exit 64/);
 assert(!/eval |bash -c|sh -c|systemctl (start|restart|enable)|rm -/.test(script));
 assert.match(script,/\.\/boot\/firmware/);assert.match(script,/--exclude='\.\/var\/swap'/);
});
test('downloaded backup verification rejects a corrupt compressed archive',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pi-backup-test-'));
 try{await fs.writeFile(dir+'/root.tar.gz','corrupt snapshot');await assert.rejects(pi.verifyBackup('raspberry',dir));}
 finally{await fs.rm(dir,{recursive:true,force:true});}
});
