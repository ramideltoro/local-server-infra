export default {
 async fetch(request,env){
  if(request.method!=='POST'||request.headers.get('Authorization')!=='Bearer '+env.PROBE_TOKEN)return new Response('Not found',{status:404});
  try{
   const r=await fetch('https://ai.nutsnews.com/translate',{method:'POST',headers:{'Content-Type':'application/json','x-nutsnews-ai-key':env.LOCAL_AI_API_KEY},body:JSON.stringify({title:'Community garden opens',summary:'Volunteers opened a community garden for their neighbors.',language_code:'fr',model:'qwen2.5:3b'}),signal:AbortSignal.timeout(120000)});
   const j=await r.json();const ok=r.ok&&j.provider==='local'&&j.model==='qwen2.5:3b'&&Boolean(j.title)&&Boolean(j.summary);
   return Response.json({ok,runtime:'cloudflare-workers',provider:j.provider,model:j.model,durationMs:j.duration_ms},{status:ok?200:502,headers:{'Cache-Control':'no-store'}});
  }catch{return Response.json({ok:false,runtime:'cloudflare-workers',error:'Production Qwen connection failed'},{status:502})}
 }
};
