// Long cloud transfers must not let independent deployment observations expire.
// There is at most one probe in flight, and shutdown waits for it to finish.
export function startRevisionRefresh(refresh, intervalMs=300000, onError=()=>{}) {
 let pending=null,stopped=false;
 const timer=setInterval(()=>{
  if(stopped||pending)return;
  pending=Promise.resolve().then(refresh).catch(onError).finally(()=>{pending=null;});
 },intervalMs);
 timer.unref();
 return async()=>{stopped=true;clearInterval(timer);await pending;};
}
