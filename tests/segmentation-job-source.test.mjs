import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(rootDir, "server.js"), "utf8");

const segmentPaperWithAiMatch = source.match(/async function segmentPaperWithAi\(paper, settings, options = \{\}\) \{[\s\S]*?\n\}\n\nfunction getSegmentationChunkOptions/);
assert.ok(segmentPaperWithAiMatch, "segmentPaperWithAi source should be discoverable");

const segmentPaperWithAiSource = segmentPaperWithAiMatch[0];
assert.ok(
  segmentPaperWithAiSource.includes("reusedStructureMap: reuseStructureMap"),
  "structure-done progress should pass the declared reuseStructureMap flag",
);
assert.equal(
  /phase:\s*"structure-done"[\s\S]{0,120}\breusedStructureMap\s*,/.test(segmentPaperWithAiSource),
  false,
  "structure-done progress must not use an undeclared reusedStructureMap shorthand",
);
