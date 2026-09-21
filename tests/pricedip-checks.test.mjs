import test from "node:test";
import assert from "node:assert/strict";
import {pricedipChecks} from "../services/workspace/pricedip-checks.mjs";
test("PriceDip operational failures enter existing inspection incidents without promoting unknown evidence",()=>{
  const now=Date.now();
  const h={at:new Date(now).toISOString(),systems:[{id:"pricedip",checks:[{id:"worker",title:"Worker heartbeat",status:"fail",fresh:true},{id:"source",title:"Source access",status:"unknown",fresh:false}]},{id:"other",checks:[{id:"private",status:"fail"}]}]};
  const c=pricedipChecks(h,now);assert.equal(c.length,2);assert.equal(c[0].complete,true);assert.equal(c[0].failures.length,1);assert.equal(c[1].complete,false);
  assert.equal(pricedipChecks(h,now+180001)[0].complete,false);
  assert.deepEqual(pricedipChecks({},now),[]);
});
