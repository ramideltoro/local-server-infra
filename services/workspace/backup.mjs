import fs from 'node:fs/promises';import {createCipheriv,createDecipheriv,randomBytes,createHash}from'node:crypto';
const [operation,input,output]=process.argv.slice(2);
const key=Buffer.from(process.env.REPORT_BACKUP_KEY||'','base64');if(key.length!==32)throw Error('A 256-bit backup key is required');
const data=await fs.readFile(input);
if(operation==='encrypt'){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),encrypted=Buffer.concat([cipher.update(data),cipher.final()]);await fs.writeFile(output,Buffer.concat([Buffer.from('OBS1'),iv,cipher.getAuthTag(),encrypted]),{mode:0o600});}
else if(operation==='decrypt'){if(data.subarray(0,4).toString()!=='OBS1')throw Error('Invalid archive');const decipher=createDecipheriv('aes-256-gcm',key,data.subarray(4,16));decipher.setAuthTag(data.subarray(16,32));await fs.writeFile(output,Buffer.concat([decipher.update(data.subarray(32)),decipher.final()]),{mode:0o600});}
else throw Error('Use encrypt or decrypt');
console.log(operation+' completed');
