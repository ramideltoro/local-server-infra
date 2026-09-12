import fs from 'node:fs';
const e=process.env,account=e.CLOUDFLARE_ACCOUNT_ID,name='local-server-qwen-compatibility';
const base=`https://api.cloudflare.com/client/v4/accounts/${account}/workers`;
async function api(path,method='GET',body,form=false){const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+e.CLOUDFLARE_API_TOKEN,...(form?{}:{'Content-Type':'application/json'})},body:body?(form?body:JSON.stringify(body)):undefined});const j=await r.json();if(!r.ok||!j.success)throw Error('Worker probe API failed: '+r.status);return j.result}
if(process.argv.includes('--provision')){
 const form=new FormData();form.set('metadata',JSON.stringify({main_module:'qwen-worker.mjs',compatibility_date:'2026-09-01',bindings:[]}));form.set('qwen-worker.mjs',new Blob([fs.readFileSync(new URL('./qwen-worker.mjs',import.meta.url))],{type:'application/javascript+module'}),'qwen-worker.mjs');
 await api('/scripts/'+name,'PUT',form,true);
 for(const [key,value]of Object.entries({LOCAL_AI_API_KEY:e.LOCAL_AI_API_KEY,PROBE_TOKEN:e.WORKER_PROBE_TOKEN})){if(!value)throw Error('Probe secret is missing');await api('/scripts/'+name+'/secrets','PUT',{name:key,text:value,type:'secret_text'})}
 await api('/scripts/'+name+'/subdomain','POST',{enabled:true,previews_enabled:false});
}
const subdomain=await api('/subdomain');const response=await fetch(`https://${name}.${subdomain.subdomain}.workers.dev`,{method:'POST',headers:{Authorization:'Bearer '+e.WORKER_PROBE_TOKEN},signal:AbortSignal.timeout(150000)});let result;try{result=await response.json()}catch{throw Error('Worker probe is not yet reachable; retry after DNS propagation')}
if(!response.ok||!result.ok||result.provider!=='local'||result.model!=='qwen2.5:3b')throw Error('Qwen compatibility failed from Cloudflare Workers');
console.log(JSON.stringify(result));
