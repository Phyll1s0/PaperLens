import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../server.js", import.meta.url), "utf8");

assert.match(source, /function inferSegmentedPaperTitle\(paper, paragraphs, structureMap = null, paperMemory = null\) \{/);
assert.match(source, /structureMap\?\.paperTitle/);
assert.match(source, /paperMemory\?\.paperTitle/);
assert.match(source, /function isLikelyFilenameTitle\(title, filename = ""\) \{/);
assert.match(source, /const upgradedTitle = upgradePaperTitleFromPlanning\(paper\);/);
assert.match(source, /title: inferSegmentedPaperTitle\(paper, paragraphs, structureMap, paperMemory\)/);

