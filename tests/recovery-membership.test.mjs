import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveryMembership } from '../services/recovery/membership.mjs';
const inventory={servers:[{id:'local'},{id:'external'}],applications:[{id:'observability'}],retired:[{id:'mookie'}]};
const config={systems:[{id:'observability'},{id:'local'}]};
test('restored membership follows the archived fleet after retirement',()=>{
 assert.deepEqual(recoveryMembership(config,inventory,config),['local','observability']);
});
test('same-count replacement, missing and duplicate restored identities fail',()=>{
 for(const ids of [['local','mookie'],['local'],['local','local']]) assert.throws(()=>recoveryMembership(config,inventory,{systems:ids.map(id=>({id}))}));
 assert.throws(()=>recoveryMembership({systems:[{id:'local'}]},inventory));
 assert.throws(()=>recoveryMembership(config,{...inventory,applications:[{id:'mookie'}]}));
 assert.throws(()=>recoveryMembership({systems:[]},{servers:[],applications:[],retired:[]}));
});
