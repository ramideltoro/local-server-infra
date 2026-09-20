import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {base,run,hash,seal,unseal,json,envFile,writable} from './lib.mjs';
import * as staticSites from './static.mjs';
import * as localApps from './local.mjs';
import * as backendApps from './backend.mjs';
import * as netlifyApps from './netlify.mjs';
import * as firebaseApps from './firebase.mjs';
import * as workers from './workers.mjs';
const tools=path.dirname(fileURLToPath(import.meta.url));
const credentials=await envFile('/etc/observe-recovery/credentials.env');
const key=await fs.readFile('/etc/observe-recovery/key');
const keyId=await hash('/etc/observe-recovery/key');
const cloudEnv={PATH:process.env.PATH,RCLONE_CONFIG:'/home/rami/.config/rclone/rclone.conf'};
const cloud='homebackup:observe-recovery';
await fs.mkdir(base+'/public',{recursive:true,mode:0o755});
await fs.chmod(base,0o711);
let evidence;try{evidence=JSON.parse(await fs.readFile(base+'/public/evidence.json','utf8'));}catch{evidence={version:1,systems:{}};}
const selected=process.argv.slice(2).filter(a=>!a.startsWith('--'));
const allIds=[...Object.keys(staticSites.sites),...localApps.ids,...backendApps.ids,...netlifyApps.ids,...firebaseApps.ids,...workers.ids];
const ids=selected.length?selected:allIds;
async function publish(){const tmp=base+'/public/evidence.tmp';await json(tmp,evidence);await fs.chmod(tmp,0o644);await fs.rename(tmp,base+'/public/evidence.json');}
// Re-probe deployment identities between serialized drills so long weekly runs
// cannot let earlier applications' current-revision observations expire.
async function refreshDeployments(){
for(const id of allIds){evidence.systems[id]??={};const provider=staticSites.sites[id]?staticSites:backendApps.ids.includes(id)?backendApps:netlifyApps.ids.includes(id)?netlifyApps:firebaseApps.ids.includes(id)?firebaseApps:workers.ids.includes(id)?workers:localApps;try{evidence.systems[id].revision=await provider.revision(id,credentials.GITHUB_TOKEN);evidence.systems[id].observedAt=new Date().toISOString();}catch{evidence.systems[id].revision=null;}}
await publish();
}
await run('rclone',['copyto','/etc/observe-recovery/key',cloud+'/keys/'+keyId+'.key'],{env:cloudEnv});
for(const id of ids){const provider=staticSites.sites[id]?staticSites:backendApps.ids.includes(id)?backendApps:netlifyApps.ids.includes(id)?netlifyApps:firebaseApps.ids.includes(id)?firebaseApps:workers.ids.includes(id)?workers:localApps;if(!staticSites.sites[id]&&!localApps.ids.includes(id)&&!backendApps.ids.includes(id)&&!netlifyApps.ids.includes(id)&&!firebaseApps.ids.includes(id)&&!workers.ids.includes(id))throw Error('Unknown application');
 const previous=evidence.systems[id]||{};let revision;
 try{revision=await provider.revision(id,credentials.GITHUB_TOKEN);evidence.systems[id]={...previous,revision,observedAt:new Date().toISOString()};await publish();}catch{evidence.systems[id]={...previous,revision:null,observedAt:new Date().toISOString()};await publish();console.log(id+': deployment unavailable');continue;}
 if(!process.argv.includes('--force')&&previous.restore?.testedRevision===revision&&Date.now()-Date.parse(previous.restore.verifiedAt)<(previous.restore.outcome==='pass'?7*86400000:6*3600000))continue;
 // A single service and flock serialize every capture/build/restore under 2 CPU / 8 GiB.
 const stamp=Date.now(),work=base+'/staging/'+id+'-'+stamp,archive=base+'/archives/'+id+'-'+stamp+'-'+keyId.slice(0,12)+'.enc';
 await fs.mkdir(work,{recursive:true,mode:0o700});let backupReference='';let tests={};let failure;
 try{
  await provider.capture(id,revision,work,credentials.GITHUB_TOKEN);
  await fs.copyFile(tools+'/smoke.mjs',work+'/smoke.mjs');
  await fs.copyFile(tools+'/membership.mjs',work+'/membership.mjs');
  await json(work+'/manifest.json',{id,revision,capturedAt:new Date().toISOString()});
  const tar=work+'.tar';await run('tar',['cf',tar,'-C',work,'.'],{timeout:900000});await seal(tar,archive,key);await fs.rm(tar);
  backupReference=await hash(archive);
  await run('rclone',['copyto',archive,cloud+'/'+path.basename(archive)],{env:cloudEnv,timeout:900000});
  const downloaded=archive+'.download';await run('rclone',['copyto',cloud+'/'+path.basename(archive),downloaded],{env:cloudEnv,timeout:900000});if(await hash(downloaded)!==backupReference)throw Error('Cloud archive mismatch');
  // Delete the source snapshot before unpacking the downloaded encrypted copy.
  await fs.rm(work,{recursive:true});await fs.mkdir(work,{mode:0o700});await unseal(downloaded,tar,key);await run('tar',['xf',tar,'--no-same-owner','-C',work],{timeout:900000});await fs.rm(tar);await fs.rm(downloaded);
  tests={'archive-integrity':true,'required-components':true};const at=new Date().toISOString();evidence.systems[id].readiness={outcome:'pass',testedRevision:revision,backupReference,verifiedAt:at,expiresAt:new Date(Date.parse(at)+8*86400000).toISOString(),tests:{...tests}};await publish();
  await writable(work);if(provider.prepare)await provider.prepare(id,work);
  await provider.restore(id,work);
  if(await provider.revision(id,credentials.GITHUB_TOKEN)!==revision)throw Error('Deployment changed during recovery');
  tests={...tests,'isolated-network':true,'restored-data':true,'application-behavior':true};
 }catch(e){failure=e;await json(work+'/failure.json',{message:e.message,detail:e.detail||''});}
 const at=new Date().toISOString();const result={outcome:failure?'fail':'pass',testedRevision:revision,backupReference,verifiedAt:at,expiresAt:new Date(Date.parse(at)+8*86400000).toISOString(),tests};
 evidence.systems[id].restore=result;evidence.systems[id].observedAt=at;
 if(failure&&!tests['archive-integrity'])evidence.systems[id].readiness={...result};
 await publish();
 // Private output is encrypted before cleanup; no raw DB, credentials or logs leave this tree.
 await json(work+'/evidence.json',result);await fs.mkdir(work+'/verification',{recursive:true});for(const name of ['manifest.json','deployment.json','source-backup.json','evidence.json','failure.json','result.json','application.log','init.log','postgres.log','restore.log']) { try { await fs.copyFile(work+'/'+name,work+'/verification/'+name); } catch(e) { if(e.code!=='ENOENT')throw e; } }const detail=work+'.tar';await run('tar',['cf',detail,'-C',work+'/verification','.'],{timeout:900000});await seal(detail,base+'/private/'+id+'-'+stamp+'.enc',key);await fs.rm(detail);await fs.rm(work,{recursive:true});
 console.log(id+': '+result.outcome+(failure?' ('+failure.message+')':''));
 await refreshDeployments();
}


await refreshDeployments();
