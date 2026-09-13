const e=process.env,base=e.GRAFANA_URL.replace(/\/$/,'');
async function get(path){const r=await fetch(base+path,{headers:{Authorization:'Bearer '+e.GRAFANA_SERVICE_ACCOUNT_TOKEN},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Cloud verification unavailable');return r.json();}
for(let attempt=0;attempt<10;attempt++){
  try{
    const queries=['mookie_collector_timestamp_seconds{instance="mookie"}','node_memory_MemTotal_bytes{instance="mookie"}','count(node_systemd_unit_state{instance="mookie"})','avg(rate(node_cpu_seconds_total{instance="mookie",mode="idle"}[5m]))'];
    for(const [i,query] of queries.entries()){
      const j=await get('/api/datasources/proxy/uid/'+e.PROMETHEUS_UID+'/api/v1/query?'+new URLSearchParams({query}));
      const values=j.data?.result?.map(r=>Number(r.value[1]))||[];
      if(!values.length||values.some(v=>!Number.isFinite(v))||(i===0&&Math.max(...values)<Date.now()/1000-180))throw Error('Metrics not yet fresh');
    }
    const j=await get('/api/datasources/proxy/uid/grafanacloud-logs/loki/api/v1/query_range?'+new URLSearchParams({query:'{instance="mookie"}',start:String(BigInt(Date.now()-180000)*1000000n),limit:'1'}));
    if(!j.data?.result?.some(s=>s.values?.length))throw Error('Journal not yet fresh');
    console.log('Verified fresh Mookie CPU, memory, hardware, systemd and private journal telemetry');process.exit(0);
  }catch{console.log('Waiting for fresh Mookie telemetry, attempt '+(attempt+1));}
  if(attempt<9)await new Promise(r=>setTimeout(r,15000));
}
throw Error('Mookie Cloud telemetry verification failed');
