import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {seal,unseal,hash} from '../services/recovery/lib.mjs';
test('streamed recovery archives restore exact bytes and reject corrupt or missing cloud copies',async()=>{const d=await fs.mkdtemp(path.join(os.tmpdir(),'restore-archive-'));try{const key=randomBytes(32),data=randomBytes(1024*1024);await fs.writeFile(d+'/source',data);await seal(d+'/source',d+'/sealed',key);await unseal(d+'/sealed',d+'/restored',key);assert.equal(await hash(d+'/source'),await hash(d+'/restored'));const encrypted=await fs.readFile(d+'/sealed');encrypted[30]^=1;await fs.writeFile(d+'/corrupt',encrypted);await assert.rejects(unseal(d+'/corrupt',d+'/rejected',key));await assert.rejects(unseal(d+'/missing',d+'/rejected',key));}finally{await fs.rm(d,{recursive:true,force:true});}});
