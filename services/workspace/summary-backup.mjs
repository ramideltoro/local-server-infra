import fs from 'node:fs/promises';
const state=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
for(const i of state.issues)delete i.evidence;
for(const r of state.reports)for(const c of r.checks)delete c.failures;
await fs.writeFile(process.argv[3],JSON.stringify(state),{mode:0o600});
