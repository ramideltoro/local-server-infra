import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createTelemetry } from "../services/local-ai/telemetry.mjs";
test("AI counters cover concurrent success, failure and disconnect without payload labels", () => {
  const t = createTelemetry();
  const a = new EventEmitter(),
    b = new EventEmitter();
  t.begin("review", a);
  t.begin("review", b);
  assert.match(t.render(), /inflight\{[^}]+\} 2/);
  a.statusCode = 200;
  a.writableFinished = true;
  a.emit("finish");
  a.emit("close");
  b.statusCode = 500;
  b.emit("close");
  assert.match(t.render(), /requests_total\{[^}]+\} 2/);
  assert.match(t.render(), /errors_total\{[^}]+\} 1/);
  assert.match(t.render(), /inflight\{[^}]+\} 0/);
  assert(!/prompt|token|user_id/.test(t.render()));
});
