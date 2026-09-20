// Existing Fantasy importer HTTP deadline: importer/ai.ts, curl --max-time 220.
// Only real requests in the production unit/current process qualify.
export function fantasyWorkload(text, pid, now = Date.now()) {
  const requests = [];
  for (const line of text.trim().split('\n').filter(Boolean)) {
    let row;
    try { row = JSON.parse(line); } catch { return null; }
    if (row._SYSTEMD_UNIT !== 'fantasy-qwen.service' || String(row._PID) !== String(pid)) continue;
    const message = row.MESSAGE;
    if (typeof message !== 'string' || !message.startsWith('[GIN]') || !message.includes('POST') || !message.includes('"/api/chat"')) continue;
    const at = Number(row.__REALTIME_TIMESTAMP) / 1000;
    if (!Number.isFinite(at) || at > now) return null;
    if (at < now - 3600000) continue;
    const match = message.match(/\|\s*(\d{3})\s*\|\s*([\d.]+)(ns|µs|μs|us|ms|s|m)(?:(\d+(?:\.\d+)?)s)?\s*\|[^|]*\|\s*POST\s+"\/api\/chat"\s*$/);
    if (!match) return null;
    const scales = {ns: 1e-9, 'µs': 1e-6, 'μs': 1e-6, us: 1e-6, ms: .001, s: 1, m: 60};
    const seconds = Number(match[2]) * scales[match[3]] + Number(match[4] || 0);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    requests.push({at, seconds, status: Number(match[1])});
  }
  if (requests.length < 5) return null;
  const latest = Math.max(...requests.map(r => r.at));
  if (latest < now - 900000) return null;
  return {
    count: requests.length,
    latest: latest / 1000,
    maxSeconds: Math.max(...requests.map(r => r.seconds)),
    met: requests.every(r => r.status >= 200 && r.status < 300 && r.seconds < 220) ? 1 : 0,
  };
}

export async function collectFantasyWorkload(execute) {
  const pid = (await execute('systemctl', ['show', 'fantasy-qwen.service', '-p', 'MainPID', '--value'])).stdout.trim();
  if (!/^[1-9][0-9]*$/.test(pid)) return null;
  const {stdout} = await execute('journalctl', ['-u', 'fantasy-qwen.service', '--since', '1 hour ago', '-o', 'json', '--no-pager', '--grep=^\\[GIN\\]', '--output-fields=MESSAGE,__REALTIME_TIMESTAMP,_SYSTEMD_UNIT,_PID']);
  const result = fantasyWorkload(stdout, pid);
  return result ? {...result, pid} : null;
}
