import http from "node:http";
export function createTelemetry() {
  const counters = new Map();
  const bounds = [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, Infinity];
  for (const operation of ["review", "translate"])
    counters.set(operation, {
      requests: 0,
      errors: 0,
      inflight: 0,
      sum: 0,
      buckets: bounds.map(() => 0),
    });
  return {
    begin(operation, res) {
      const c = counters.get(operation);
      if (!c) return;
      c.inflight++;
      const start = performance.now();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        const seconds = (performance.now() - start) / 1000;
        c.inflight--;
        c.requests++;
        console.log(JSON.stringify({event:"inference-response",operation,status:res.statusCode,completed:res.writableFinished}));
        if (res.statusCode >= 400 || !res.writableFinished) c.errors++;
        c.sum += seconds;
        bounds.forEach((b, i) => {
          if (seconds <= b) c.buckets[i]++;
        });
      };
      res.once("finish", finish);
      res.once("close", finish);
    },
    render() {
      const lines = [];
      for (const [operation, c] of counters) {
        const labels = `operation="${operation}",workload="production"`;
        for (const [name, value] of [
          ["requests_total", c.requests],
          ["errors_total", c.errors],
          ["inflight", c.inflight],
          ["duration_seconds_sum", c.sum],
          ["duration_seconds_count", c.requests],
        ])
          lines.push(`local_qwen_${name}{${labels}} ${value}`);
        bounds.forEach((b, i) =>
          lines.push(
            `local_qwen_duration_seconds_bucket{${labels},le="${b === Infinity ? "+Inf" : b}"} ${c.buckets[i]}`,
          ),
        );
      }
      return lines.join("\n") + "\n";
    },
  };
}
export function startTelemetry(telemetry, port = 8791) {
  const server = http.createServer((req, res) => {
    if (req.method !== "GET" || req.url !== "/metrics") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
    res.end(telemetry.render());
  });
  server.listen(port, "127.0.0.1");
  return server;
}
