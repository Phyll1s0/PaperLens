import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(rootDir, "server.js"), "utf8");

const runAnalysisJobMatch = source.match(/async function runAnalysisJob\(job, signal\) \{[\s\S]*?\n\}\n\nasync function runSegmentationJob/);
assert.ok(runAnalysisJobMatch, "runAnalysisJob source should be discoverable");
assert.ok(
  runAnalysisJobMatch[0].includes("requeueDoneAnalysisItemsMissingPaperOutput(job)"),
  "analysis worker should requeue done items whose paragraph output was not written back",
);

const runAnalysisJobBatchMatch = source.match(/async function runAnalysisJobBatch\(job, items, signal, options = \{\}\) \{[\s\S]*?\n\}\n\nasync function requeueDoneAnalysisItemsMissingPaperOutput/);
assert.ok(runAnalysisJobBatchMatch, "runAnalysisJobBatch source should be discoverable");
assert.ok(
  runAnalysisJobBatchMatch[0].includes("Batch analysis writeback incomplete"),
  "batch analysis should fail and retry when paragraph writeback is incomplete",
);
