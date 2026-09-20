import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectLogWindow } from '../services/workspace/log-window.mjs';
const stream = values => ({ status:'success', data:{resultType:'streams', result:[{values}]} });
const query = logs => async (start,end,limit) => stream(logs.filter(([t])=>BigInt(t)>=start && BigInt(t)<end).slice(0,limit));
test('multiple pages retain tied timestamps exactly once and complete the window', async()=>{
 const logs=[['1','error'],['2','timeout'],['2','timeout'],['2','timeout'],['3','permission denied'],['4','error']];
 const r=await inspectLogWindow(query(logs),1n,5n,{limit:4});
 assert.equal(r.complete,true); assert.equal(r.entries,6); assert.equal(r.pages,3);
 assert.equal(r.patterns.get('timeout'),3); assert.equal(r.patterns.get('application error'),2);
});
test('saturated timestamp remains incomplete without dropping observed failures',async()=>{
 const r=await inspectLogWindow(query(Array.from({length:7},()=>['1','error'])),1n,5n,{limit:4});
 assert.equal(r.complete,false); assert.equal(r.entries,4); assert.equal(r.pages,1);
});
test('query budget cannot claim completion',async()=>{
 const r=await inspectLogWindow(query(Array.from({length:20},(_,i)=>[String(i),'error'])),0n,21n,{limit:4,budget:2});
 assert.equal(r.complete,false); assert.equal(r.pages,2); assert.equal(r.entries,6);
});
test('empty successful stream completes error inspection, source presence checked separately',async()=>{
 assert.equal((await inspectLogWindow(query([]),0n,10n)).complete,true);
});
test('half-open interval includes start and excludes end',async()=>{
 const r=await inspectLogWindow(query([['0','error'],['1','timeout'],['2','error']]),1n,2n);
 assert.equal(r.entries,1); assert.equal(r.patterns.get('timeout'),1);
});
test('unordered streams use global last timestamp and fixed classification priority',async()=>{
 const r=await inspectLogWindow(async()=>stream([['3','oom timeout'],['1','connection reset'],['2','unauthorized']]),0n,5n);
 assert.equal(r.patterns.get('memory exhaustion'),1); assert.equal(r.patterns.get('connection failure'),1);
 assert.equal(r.patterns.get('authorization failure'),1);
});
test('failed, malformed and out-of-window responses never verify coverage',async()=>{
 for(const response of [{status:'error'}, {status:'success',data:{resultType:'matrix',result:[]}},stream([['9','error']]),stream([['bad','error']])])
  await assert.rejects(inspectLogWindow(async()=>response,0n,5n));
});
