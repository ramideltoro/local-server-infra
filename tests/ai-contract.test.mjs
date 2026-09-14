import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
test("instrumented AI preserves authenticated JSON contract, concurrency and timeout behavior", async () => {
  const inputs = [];
  let slow = false;
  const ollama = http.createServer(async (req, res) => {
    if (req.url === "/api/tags") {
      res.end(JSON.stringify({ models: [{ name: "qwen2.5:3b" }] }));
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const value = JSON.parse(raw);
    inputs.push(value);
    await new Promise((resolve) => setTimeout(resolve, slow ? 500 : 40));
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        message: {
          content: JSON.stringify({
            language_code: "fr",
            title: "Une bonne nouvelle",
            summary: "Une communauté partage de bonnes nouvelles.",
          }),
        },
        prompt_eval_count: 3,
        eval_count: 4,
      }),
    );
  });
  await new Promise((resolve) => ollama.listen(18734, "127.0.0.1", resolve));
  const child = spawn(process.execPath, ["services/local-ai/server.mjs"], {
    env: {
      ...process.env,
      PORT: "18788",
      TELEMETRY_PORT: "18791",
      OLLAMA_URL: "http://127.0.0.1:18734",
      LOCAL_AI_API_KEY: "contract-test-key",
      REQUEST_TIMEOUT_MS: "200",
    },
    stdio: "pipe",
  });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.once("data", resolve);
      child.once("exit", () => reject(Error("AI exited")));
      setTimeout(() => reject(Error("AI startup timeout")), 5000).unref();
    });
    const url = "http://127.0.0.1:18788";
    assert.equal((await fetch(url + "/health")).status, 200);
    assert.equal(
      (await fetch(url + "/translate", { method: "POST", body: "{}" })).status,
      401,
    );
    const input = {
      language_code: "fr",
      title: "Good news",
      summary: "People help each other.",
      stream: true,
    };
    const request = () =>
      fetch(url + "/translate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-nutsnews-ai-key": "contract-test-key",
        },
        body: JSON.stringify(input),
      });
    const responses = await Promise.all([request(), request()]);
    for (const response of responses) {
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.provider, "local");
      assert.equal(body.language_code, "fr");
      assert.equal(body.model, "qwen2.5:3b");
      assert.equal(body.total_tokens, 7);
    }
    assert(inputs.every((i) => i.stream === false));
    slow = true;
    assert.equal((await request()).status, 500);
    const metrics = await fetch("http://127.0.0.1:18791/metrics").then((r) =>
      r.text(),
    );
    assert.match(
      metrics,
      /requests_total\{operation="translate",workload="production"\} 3/,
    );
    assert.match(
      metrics,
      /errors_total\{operation="translate",workload="production"\} 1/,
    );
    assert(!metrics.includes("Good news"));
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    await new Promise((resolve) => ollama.close(resolve));
  }
});
