import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectionThreshold} from '../services/workspace/metric-threshold.mjs';
test('existing percent and certificate limits stay unchanged',()=>{
 for(const [id,unit,expected] of [['cpu','percent',90],['raspberry-memory','percent',90],['backend-vps-disk','percent',85],['fantasy-database','percent',99],['showalgo-availability','percent',99],['fantasy-certificate','s',604800]])
 assert.equal(inspectionThreshold({id,unit}),expected);
});
test('bytes and throughput cannot trigger percentage warnings',()=>{
 for(const [id,unit] of [['raspberry-memory-available','bytes'],['raspberry-disk-write','Bps'],['mookie-disk-read','Bps'],['disk','bytes'],['cpu','short']])
 assert.equal(inspectionThreshold({id,unit}),null);
});
test('registered operational targets apply across hosts including zero',()=>{
 for(const id of ['mookie-throttling','raspberry-throttling','backend-vps-custom'])assert.equal(inspectionThreshold({id,unit:'short',inspectionThreshold:0}),0);
 assert.equal(inspectionThreshold({id:'raspberry-temperature',unit:'celsius',inspectionThreshold:80}),80);
});
