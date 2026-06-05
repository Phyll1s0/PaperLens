import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverSource = await readFile(path.join(rootDir, "server.js"), "utf8");
const appSource = await readFile(path.join(rootDir, "public", "app.js"), "utf8");

assert.match(serverSource, /const MAX_WEAK_ANALYSIS_REPAIR_PASSES = readIntegerEnv/);
assert.match(serverSource, /function needsWeakAnalysisRepair\(paragraph\)/);
assert.match(serverSource, /queueWeakAnalysisRepairItems\(job\)/);
assert.match(serverSource, /await queueWeakAnalysisRepairItems\(job\)/);
assert.match(serverSource, /job\.weakRepairActive = true/);
assert.match(serverSource, /buildWeakAnalysisRepairContext\(paragraph\)/);
assert.match(serverSource, /弱分析修复要求/);
assert.match(serverSource, /repairWeakOnly: Boolean\(repairWeakOnly\)/);
assert.match(serverSource, /hasMissingAnalysisOutput\(paragraph\)/);
assert.doesNotMatch(
  serverSource,
  /const incompleteWritebacks = updatedParagraphs\s+\.filter\(\(paragraph\) => needsParagraphAnalysis\(paragraph\)\)/,
);

assert.match(appSource, /repairWeakOnly: Boolean\(payload\.repairWeakOnly\)/);
assert.match(appSource, /Boolean\(paragraph\.weakAnalysis\)/);
