import fs from 'node:fs/promises';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
export function safePath(p) {
  if(typeof p!=='string'||!p.startsWith('/')||p.startsWith('//')||p.includes('\\')||p.includes('\0')||p.includes('?')||p.includes('#')||p.split('/').some(x=>x==='.'||x==='..')) throw Error('Unsafe Firebase file path');
  return p.slice(1);
}
// Fail closed when a deployment adds serving features this drill cannot reproduce.
export function validateConfig(config) {
  if(Object.keys(config).some(k=>k!=='headers')) throw Error('Unsupported Firebase serving configuration');
  for(const rule of config.headers||[]){
    if(Object.keys(rule).some(k=>!['glob','headers'].includes(k))||!['**/*','static/**','**/*.@(css|js)','sw.js','page-data/**'].includes(rule.glob)||!rule.headers||Object.entries(rule.headers).some(([k,v])=>k.toLowerCase()!=='cache-control'||typeof v!=='string'||/[\r\n]/.test(v))) throw Error('Unsupported Firebase header configuration');
  }
}
export function headersFor(config,p){const result={};for(const {glob,headers} of config.headers||[])if(glob==='**/*'||glob==='static/**'&&p.startsWith('/static/')||glob==='**/*.@(css|js)'&&/\.(css|js)$/.test(p)||glob==='sw.js'&&p==='/sw.js'||glob==='page-data/**'&&p.startsWith('/page-data/'))Object.assign(result,headers);return result;}
export function verifyBytes(bytes,expected){if(!/^[a-f0-9]{64}$/.test(expected)||createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('Firebase deployment checksum mismatch');return gunzipSync(bytes,{maxOutputLength:50*1024*1024});}
export async function verify(dir){
 const manifest=JSON.parse(await fs.readFile(dir+'/deployment.json'));validateConfig(manifest.configuration);
 assert.equal(manifest.files.length,Number(manifest.fileCount));assert(manifest.files.some(f=>f.path==='/index.html'));const files=new Map();
 for(const f of manifest.files){safePath(f.path);assert(!files.has(f.path));files.set(f.path,verifyBytes(await fs.readFile(dir+'/compressed'+f.path),f.hash));}
 const server=http.createServer((req,res)=>{let p;try{p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400);res.end();return;}if(p.endsWith('/'))p+='index.html';else if(!files.has(p)&&files.has(p+'/index.html')){res.writeHead(301,{Location:p+'/'});res.end();return;}const bytes=files.get(p);if(!bytes){res.writeHead(404);res.end();return;}res.writeHead(200,headersFor(manifest.configuration,p));res.end(bytes);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 try{for(const [p,bytes] of files){const r=await fetch(origin+p.split('/').map(encodeURIComponent).join('/'));assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes);for(const[k,v]of Object.entries(headersFor(manifest.configuration,p)))assert.equal(r.headers.get(k),v);}
 for(const p of [...files.keys()].filter(p=>p.endsWith('/index.html'))){const r=await fetch(origin+p.slice(0,-10));assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),files.get(p));}
 assert.equal((await fetch(origin+'/__observe_missing_recovery_file__')).status,404);
 await fs.writeFile(dir+'/result.json',JSON.stringify({verifiedFiles:files.size,scope:manifest.scope,revision:manifest.revision}));
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await verify(process.argv[2]||'/work');
