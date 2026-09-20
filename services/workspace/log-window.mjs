// Loki ranges include start and exclude end. Re-read the last timestamp of a
// full forward page: advancing by one nanosecond could silently lose tied logs.
export async function inspectLogWindow(query, start, end, { limit = 500, budget = 10 } = {}) {
  let cursor = start, pages = 0, entries = 0, complete = false;
  const patterns = new Map();
  function record(values) {
    entries += values.length;
    for (const [, line] of values) {
      const kind = /out of memory|oom/i.test(line) ? 'memory exhaustion'
        : /timeout|timed out/i.test(line) ? 'timeout'
        : /connection refused|connection reset/i.test(line) ? 'connection failure'
        : /permission denied|unauthorized/i.test(line) ? 'authorization failure'
        : 'application error';
      patterns.set(kind, (patterns.get(kind) || 0) + 1);
    }
  }
  while (pages < budget && cursor < end) {
    const response = await query(cursor, end, limit);
    pages++;
    if (response.status !== 'success' || response.data?.resultType !== 'streams' || !Array.isArray(response.data.result))
      throw Error('Invalid log response');
    const values = response.data.result.flatMap(s => {
      if (!Array.isArray(s.values)) throw Error('Invalid log stream');
      return s.values;
    });
    for (const value of values) {
      if (!Array.isArray(value) || typeof value[0] !== 'string' || !/^\d+$/.test(value[0]) || typeof value[1] !== 'string' || BigInt(value[0]) < cursor || BigInt(value[0]) >= end)
        throw Error('Invalid log entry');
    }
    if (values.length < limit) {
      record(values);
      complete = true;
      break;
    }
    if (values.length > limit) throw Error('Log limit exceeded');
    const last = values.reduce((max, [t]) => BigInt(t) > max ? BigInt(t) : max, cursor);
    if (last === cursor) {
      // A single timestamp fills the page. Keep observed failures, but do not
      // claim coverage or skip past possibly unseen logs at that timestamp.
      record(values);
      break;
    }
    record(values.filter(([t]) => BigInt(t) < last));
    cursor = last;
  }
  return { complete, entries, pages, patterns };
}
