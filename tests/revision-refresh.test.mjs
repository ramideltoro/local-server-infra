import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {startRevisionRefresh} from '../services/recovery/revision-refresh.mjs';
test('long refreshes cannot overlap and stop waits for the in-flight probe',async()=>{
 let active=0,max=0,calls=0;
 const stop=startRevisionRefresh(async()=>{active++;max=Math.max(max,active);calls++;await delay(25);active--;},5);
 await delay(42);await stop();const finished=calls;await delay(20);
 assert.equal(active,0);assert.equal(max,1);assert.equal(calls,finished);assert(calls>0);
});
test('a transient refresh failure is reported without disabling future probes',async()=>{
 let calls=0,errors=0;const stop=startRevisionRefresh(async()=>{if(++calls===1)throw Error('probe failure');},5,()=>errors++);
 await delay(30);await stop();assert.equal(errors,1);assert(calls>1);
});
