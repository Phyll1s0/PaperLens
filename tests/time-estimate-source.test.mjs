import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverSource = await readFile(path.join(rootDir, "server.js"), "utf8");
const appSource = await readFile(path.join(rootDir, "public", "app.js"), "utf8");

assert.ok(
  serverSource.includes("timeEstimate: buildJobTimeEstimate(job)"),
  "serialized jobs should expose a timeEstimate payload",
);
assert.ok(
  serverSource.includes("function getStaticSegmentationTimeEstimate(job)") &&
    serverSource.includes("Paper Memory") &&
    serverSource.includes("getHistoricalJobTotalSeconds(job)"),
  "server should estimate segmentation time from phases and calibrate with history",
);
assert.ok(
  appSource.includes("formatJobEtaStatus") &&
    appSource.includes("慢于预期") &&
    appSource.includes("formatJobDurationLabel(job)"),
  "client should render ETA, slow-run warning, and job history durations",
);
