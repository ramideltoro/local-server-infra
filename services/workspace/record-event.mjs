import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
const [operation, outcome, run, revision] = process.argv.slice(2);
if (
  !["deploy", "restore", "rollback", "automatic-rollback"].includes(
    operation,
  ) ||
  !["success", "failure"].includes(outcome) ||
  !/^\d+$/.test(run) ||
  !/^[a-f0-9]{40}$/.test(revision)
)
  throw Error("Invalid release event");
const file =
  (process.env.DATA_DIR || "/var/lib/local-server-observability") +
  "/operations.db";
if (fs.existsSync(file)) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA busy_timeout=5000");
  const event = {
    id: "pipeline-operation:" + run + ":" + operation,
    system: "observability",
    at: Date.now(),
    kind: operation.includes("rollback") ? "rollback" : "configuration",
    title:
      operation === "rollback"
        ? "Portal rollback completed"
        : operation === "automatic-rollback"
          ? "Activation or verification failed; inspect workflow for rollback outcome"
          : "Coordinated " + operation + " " + outcome,
    outcome,
    revision: revision.slice(0, 12),
    url:
      "https://github.com/ramideltoro/local-server-infra/actions/runs/" + run,
  };
  db.prepare("INSERT OR REPLACE INTO events VALUES (?,?,?,?,?)").run(
    event.id,
    event.system,
    event.at,
    event.kind,
    JSON.stringify(event),
  );
  db.close();
  console.log("Operational release event recorded.");
} else
  console.log(
    "Operational history not initialized; workflow remains the release record.",
  );
