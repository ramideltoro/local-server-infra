import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import {createHash,createSign} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {envFile,json,sandbox} from './lib.mjs';
import {safePath,validateConfig,verifyBytes} from './firebase-verify.mjs';
export const ids=['showalgo'];
let cachedToken;
async function token(){
 if(cachedToken&&cachedToken.expires>Date.now()+60000)return cachedToken.value;
 const env=await envFile('/etc/observe-recovery/credentials.env');if(!env.SHOWALGO_FIREBASE_SERVICE_ACCOUNT_B64)throw Error('Firebase recovery credential unavailable');
 const key=JSON.parse(Buffer.from(env.SHOWALGO_FIREBASE_SERVICE_ACCOUNT_B64,'base64'));
 if(key.project_id!=='showalgo'||key.client_email!=='observe-recovery-showalgo@showalgo.iam.gserviceaccount.com')throw Error('Unexpected Firebase recovery identity');
 const now=Math.floor(Date.now()/1000),enc=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
 const data=enc({alg:'RS256',typ:'JWT'})+'.'+enc({iss:key.client_email,scope:'https://www.googleapis.com/auth/firebase.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
 const assertion=data+'.'+createSign('RSA-SHA256').update(data).sign(key.private_key,'base64url');
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error('Firebase recovery authentication failed: '+r.status);const value=await r.json();if(!value.access_token)throw Error('Firebase token missing');cachedToken={value:value.access_token,expires:Date.now()+Number(value.expires_in)*1000};return cachedToken.value;
}
async function api(route){const r=await fetch('https://firebasehosting.googleapis.com/v1beta1/'+route,{headers:{Authorization:'Bearer '+await token()},signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('Firebase recovery source unavailable: '+r.status);return r.json();}
async function current(){const data=await api('sites/showalgo/releases?pageSize=1');const release=data.releases?.[0];if(release?.type!=='DEPLOY'||release.version?.status!=='FINALIZED'||!/^sites\/showalgo\/versions\/[a-z0-9]+$/.test(release.version.name))throw Error('Firebase live deployment unavailable');return release;}
export async function revision(){return (await current()).version.name;}
export function compressedFile(bytes,encoding,expected){
 if(encoding&&encoding!=='gzip')throw Error('Unsupported Firebase content encoding');
 if(encoding!=='gzip')bytes=gzipSync(bytes,{level:9});
 verifyBytes(bytes,expected);return bytes;
}
async function download(file){safePath(file.path);const url='https://showalgo.web.app'+file.path.split('/').map(encodeURIComponent).join('/');return new Promise((resolve,reject)=>{const req=https.get(url,{headers:{'Accept-Encoding':'gzip'},timeout:60000},res=>{if(res.statusCode!==200){res.resume();reject(Error('Firebase deployment file unavailable: '+res.statusCode));return;}const chunks=[];let size=0;res.on('data',b=>{size+=b.length;if(size>50*1024*1024)req.destroy(Error('Firebase file too large'));else chunks.push(b);});res.on('error',reject);res.on('end',()=>{try{resolve(compressedFile(Buffer.concat(chunks),res.headers['content-encoding'],file.hash));}catch(e){reject(e);}});});req.on('timeout',()=>req.destroy(Error('Firebase download timed out')));req.on('error',reject);});}
export async function capture(id,revision,dir){
 const release=await current(),version=release.version;if(version.name!==revision)throw Error('Firebase deployment changed');validateConfig(version.config||{});
 const files=[];let pageToken;const seenTokens=new Set();do{const page=await api(revision+'/files?pageSize=1000'+(pageToken?'&pageToken='+encodeURIComponent(pageToken):''));files.push(...page.files||[]);pageToken=page.nextPageToken;if(pageToken&&seenTokens.has(pageToken))throw Error('Repeated Firebase inventory page');seenTokens.add(pageToken);}while(pageToken);
 if(files.length!==Number(version.fileCount)||files.length===0||files.length>20000||!files.some(f=>f.path==='/index.html')||new Set(files.map(f=>f.path)).size!==files.length||files.some(f=>f.status!=='ACTIVE'||!/^[a-f0-9]{64}$/.test(f.hash)))throw Error('Firebase deployment inventory incomplete');
 for(const f of files){const dest=path.join(dir,'compressed',safePath(f.path));const bytes=await download(f);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,bytes,{mode:0o600});}
 if(await current().then(r=>r.version.name)!==revision)throw Error('Firebase deployment changed during capture');
 await json(dir+'/deployment.json',{id,revision,provider:'firebase',site:'showalgo',releaseTime:release.releaseTime,fileCount:version.fileCount,files,configuration:version.config||{},scope:'Complete deployed static files, directory routes and hosting cache headers; no dynamic services or source rebuild claim'});
 await fs.copyFile(new URL('./firebase-verify.mjs',import.meta.url),dir+'/firebase-verify.mjs');
}
export async function restore(id,dir){await sandbox(dir,['node','/work/firebase-verify.mjs','/work']);}
