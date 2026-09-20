import test from 'node:test';
import assert from 'node:assert/strict';
import {fantasyWorkload} from '../services/recovery/fantasy-workload.mjs';
const now = Date.parse('2026-09-20T16:00:00Z');
const row = (overrides = {}) => JSON.stringify({_SYSTEMD_UNIT:'fantasy-qwen.service',_PID:'1501',__REALTIME_TIMESTAMP:String((now-1000)*1000),MESSAGE:'[GIN] 2026/09/20 - 12:00:00 | 200 | 42.751104111s | 127.0.0.1 | POST     "/api/chat"',...overrides});
const sample = extra => [...Array.from({length:5},()=>row()),...(extra||[])].join('\n');
test('real production completions satisfy the documented request deadline',()=>{
 const got=fantasyWorkload(sample(),1501,now); assert.equal(got.met,1);assert.equal(got.count,5);assert.equal(got.maxSeconds,42.751104111);
});
test('deadline breach and failed requests remain failures',()=>{
 for(const message of ['[GIN] date | 200 | 3m40s | 127.0.0.1 | POST "/api/chat"','[GIN] date | 500 | 10ms | 127.0.0.1 | POST "/api/chat"']) assert.equal(fantasyWorkload(sample([row({MESSAGE:message})]),1501,now).met,0);
});
test('health probes, recovery processes and idle services cannot earn credit',()=>{
 assert.equal(fantasyWorkload(Array(5).fill(row({MESSAGE:'[GIN] date | 200 | 1ms | 127.0.0.1 | GET "/api/tags"'})).join('\n'),1501,now),null);
 assert.equal(fantasyWorkload(sample(),999,now),null);
 assert.equal(fantasyWorkload(Array(5).fill(row({_SYSTEMD_UNIT:'observe-recovery.service'})).join('\n'),1501,now),null);
 assert.equal(fantasyWorkload(row(),1501,now),null);
});
test('stale, future, malformed and unsupported timings remain unverified',()=>{
 assert.equal(fantasyWorkload(sample(),1501,now+901000),null);
 assert.equal(fantasyWorkload(sample([row({__REALTIME_TIMESTAMP:String((now+1)*1000)})]),1501,now),null);
 assert.equal(fantasyWorkload(sample(['invalid']),1501,now),null);
 assert.equal(fantasyWorkload(sample([row({MESSAGE:'[GIN] date | 200 | unknown | local | POST "/api/chat"'})]),1501,now),null);
});

test('collector reads the fixed production unit and refuses an inactive process', async()=>{
 const {collectFantasyWorkload}=await import('../services/recovery/fantasy-workload.mjs');
 const calls=[];const fresh=Array(5).fill(row({__REALTIME_TIMESTAMP:String((Date.now()-1000)*1000)})).join('\n');
 const result=await collectFantasyWorkload(async(command,args)=>{calls.push({command,args});return {stdout:command==='systemctl'?'1501\n':fresh};});
 assert.equal(result.met,1);assert.equal(calls[1].command,'journalctl');assert.ok(calls[1].args.includes('fantasy-qwen.service'));assert.ok(calls[1].args.includes('1 hour ago'));
 let count=0;assert.equal(await collectFantasyWorkload(async()=>{count++;return {stdout:'0\n'};}),null);assert.equal(count,1);
});
