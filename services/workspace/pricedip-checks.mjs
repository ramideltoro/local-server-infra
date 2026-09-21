export function pricedipChecks(health, now=Date.now()) {
  const fresh=Number.isFinite(Date.parse(health?.at)) && now>=Date.parse(health.at) && now-Date.parse(health.at)<180000;
  return (health?.systems || []).filter(s=>["pricedip","pricedip-wiki"].includes(s.id)).flatMap(system=>(system.checks || []).map(c=>({
    system:system.id,id:c.id,complete:fresh && c.fresh!==false && ["pass","warning","fail"].includes(c.status),
    note:fresh?"Registered PriceDip operational check inspected":"PriceDip operational evidence is stale",
    failures:["warning","fail"].includes(c.status)?[{signature:"operational-check",summary:c.title,severity:c.severity==="critical"?"critical":"warning",evidence:[{status:c.status}]}]:[]
  })));
}
