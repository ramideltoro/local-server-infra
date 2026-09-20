import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {envFile,base,json} from './lib.mjs';
export const services=['nutsnews-worker-0','nutsnews-worker-1','nutsnews-worker-2'];
export async function observe(credentials,fetcher=fetch,now=Date.now()){
 const timestamps=[];
 if(!credentials.CLOUDFLARE_ACCOUNT_ID||!credentials.CLOUDFLARE_API_TOKEN)throw Error('Cloud log credential unavailable');
 for(const service of services){
  const response=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${credentials.CLOUDFLARE_ACCOUNT_ID}/workers/observability/telemetry/query`,{method:'POST',headers:{Authorization:'Bearer '+credentials.CLOUDFLARE_API_TOKEN,'Content-Type':'application/json'},signal:AbortSignal.timeout(10000),body:JSON.stringify({queryId:'observe-production-log-presence',dry:true,view:'events',limit:1,timeframe:{from:now-3600000,to:now},parameters:{datasets:['cloudflare-workers'],filters:[{key:'$metadata.service',operation:'eq',type:'string',value:service}],filterCombination:'and',orderBy:{value:'timestamp',order:'desc'}}})});
  if(!response.ok)throw Error('Cloud log query failed');
  const document=await response.json();
  if(document.success!==true)throw Error('Cloud log query unsuccessful');
  const rows=document.result?.events?.events||[];
  const valid=rows.filter(row=>row.$metadata?.service===service&&Number.isFinite(row.timestamp)&&row.timestamp<=now&&row.timestamp>now-3600000);
  if(!valid.length)throw Error('Fresh production application logs unavailable');
  timestamps.push(Math.max(...valid.map(row=>row.timestamp)));
 }
 return {version:1,observedAt:new Date(now).toISOString(),systems:{nutsnews:{at:new Date(Math.min(...timestamps)).toISOString(),scope:'Production Cloudflare ingestion shards 0–2'}}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let document;
 try{document=await observe(await envFile('/etc/observe-recovery/credentials.env'));}catch{document={version:1,observedAt:new Date().toISOString(),systems:{}};}
 await fs.mkdir(base+'/public',{recursive:true,mode:0o755});
 const tmp=base+'/public/cloud-logs.tmp';await json(tmp,document);await fs.chmod(tmp,0o644);await fs.rename(tmp,base+'/public/cloud-logs.json');
 console.log(document.systems.nutsnews?'Production log presence verified':'Production log presence remains unverified');
}
