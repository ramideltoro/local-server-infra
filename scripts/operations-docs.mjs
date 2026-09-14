import fs from "node:fs";
const [portal, wiki] = process.argv.slice(2),
  config = JSON.parse(fs.readFileSync(portal + "/config/operations.json"));
const file = wiki + "/src/data/topics.json",
  topics = JSON.parse(fs.readFileSync(file));
const targets = config.systems
  .filter((s) => s.objective)
  .map(
    (s) =>
      `- ${s.name}: ${s.objective.availability}% availability over ${s.objective.windowDays} days${s.objective.provisional ? " (provisional)" : ""}.`,
  )
  .join("\n");
const thresholds = config.systems
  .flatMap((s) =>
    s.checks
      .filter((c) => c.fail !== undefined)
      .map(
        (c) =>
          `- ${s.name} / ${c.title}: warning ${c.warn ?? "not configured"}, failure ${c.fail}; direction ${c.direction || "at or above"}.`,
      ),
  )
  .join("\n");
const topic = {
  slug: "operational-targets",
  title: "Operational targets",
  group: "Operations",
  icon: "target",
  description: "Git-managed availability objectives and check thresholds.",
  summary:
    "## Availability targets\n" +
    targets +
    "\n\nTargets are operational goals, not guarantees. Missing checks reduce verified health.",
  technical:
    "## Availability objectives\n" +
    targets +
    "\n\n## Registered thresholds\n" +
    thresholds,
  expert:
    "## Target ownership\n" +
    targets +
    "\n\nChanges are validated owner proposals in Git. Existing Cloud alert evaluators retain ownership of notifications and timing. Threshold changes affect future scoring; historical health snapshots are preserved. Missing data cannot be classified as passing.",
};
const index = topics.findIndex((t) => t.slug === topic.slug);
if (index < 0) topics.push(topic);
else topics[index] = topic;
fs.writeFileSync(file, JSON.stringify(topics, null, 2) + "\n");
