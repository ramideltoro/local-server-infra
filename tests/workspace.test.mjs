import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
test("encrypted backups roundtrip and reject tampering", async () => {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), "observe-backup-"));
  try {
    const plain = JSON.stringify({
      issues: [{ history: [{ status: "New" }] }],
      reports: [],
    });
    await fs.writeFile(d + "/in", plain);
    const env = {
      ...process.env,
      REPORT_BACKUP_KEY: randomBytes(32).toString("base64"),
    };
    const run = (...args) =>
      execFileSync(
        process.execPath,
        ["services/workspace/backup.mjs", ...args],
        { env, stdio: "pipe" },
      );
    run("encrypt", d + "/in", d + "/enc");
    run("decrypt", d + "/enc", d + "/out");
    assert.equal(await fs.readFile(d + "/out", "utf8"), plain);
    const bytes = await fs.readFile(d + "/enc");
    bytes[40] ^= 1;
    await fs.writeFile(d + "/enc", bytes);
    assert.throws(() => run("decrypt", d + "/enc", d + "/bad"));
  } finally {
    await fs.rm(d, { recursive: true });
  }
});
import { summarizeWithQwen } from "../services/workspace/summarize.mjs";
test("busy and failed AI preserves deterministic fallback", async () => {
  let called = false;
  const request = async () => {
    called = true;
    throw Error("offline");
  };
  const report = {
    checks: [
      { system: "local", id: "cpu", failures: [{ summary: "CPU pressure" }] },
    ],
  };
  assert.equal(
    (await summarizeWithQwen(report, { idle: async () => false, request }))
      .mode,
    "template",
  );
  assert.equal(called, false);
  assert.equal(
    (await summarizeWithQwen(report, { idle: async () => true, request })).mode,
    "template",
  );
});
import { inspectionWindow } from "../services/workspace/window.mjs";
test("missed schedules and budget-capped inspection windows are explicit", () => {
  const now = Date.parse("2026-09-13T10:00:00Z") / 1000;
  const w = inspectionWindow("2026-09-01T09:00:00Z", now);
  assert.equal(w.truncated, true);
  assert.equal(w.end - w.start, 7 * 86400);
  assert.equal(w.scheduleDelaySeconds, 3600);
  assert.equal(w.missedWindows, 11);
  assert.throws(() => inspectionWindow("invalid", now));
});
