import test from 'node:test';
import assert from 'node:assert/strict';
import {retireMookieAlerts,retiredMookieAlerts} from '../scripts/retired-alerts.mjs';
test('retirement deletes only explicitly owned Mookie alerts and is repeatable',async()=>{
 const deleted=[];const present=new Set(retiredMookieAlerts);
 const api=async(path,method)=>{const uid=path.split('/').at(-1);if(method==='DELETE'){deleted.push(uid);present.delete(uid);return;}if(!present.has(uid))throw Object.assign(Error(),{status:404});return {uid,folderUID:'local-server-central',labels:{managed_by:'local-server-infra',server:'mookie',application:'mookie'}};};
 await retireMookieAlerts(api);await retireMookieAlerts(api);assert.deepEqual(deleted,retiredMookieAlerts);
});
test('retirement refuses mismatched ownership and propagates authentication failures',async()=>{
 let deleted=false;await assert.rejects(retireMookieAlerts(async(p,m)=>{if(m==='DELETE')deleted=true;return {uid:retiredMookieAlerts[0],folderUID:'other'};}),/ownership/);assert.equal(deleted,false);
 await assert.rejects(retireMookieAlerts(async()=>{throw Object.assign(Error('unauthorized'),{status:401})}),/unauthorized/);
});
