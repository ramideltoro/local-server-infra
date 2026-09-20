// Explicit ownership checks prevent retirement from deleting another team's rules.
export const retiredMookieAlerts = ['cpu','memory','disk','temperature','undervoltage','throttled','services-failed','restarts','telemetry-age','metrics-missing'].map(s => 'mookie-'+s);
export async function retireMookieAlerts(api) {
  for (const uid of retiredMookieAlerts) {
    const path='/api/v1/provisioning/alert-rules/'+uid;
    let rule;
    try { rule=await api(path); } catch(error) { if(error.status===404) continue; throw error; }
    if(rule.uid!==uid || rule.folderUID!=='local-server-central' || rule.labels?.managed_by!=='local-server-infra' || rule.labels?.server!=='mookie' || rule.labels?.application!=='mookie') throw Error('Refusing to delete alert without matching retirement ownership: '+uid);
    await api(path,'DELETE');
  }
}
