import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../server.js", import.meta.url), "utf8");

assert.match(source, /const upgradedSourceBoxes = upgradePaperParagraphSourceBoxes\(paper\);/);
assert.match(source, /upgradedArtifacts \|\| upgradedContext \|\| upgradedTitle \|\| upgradedSourceBoxes \|\| upgradedSourceMarkdown/);
assert.match(source, /function upgradePaperParagraphSourceBoxes\(paper\) \{/);
assert.match(source, /function findSourceBoxForParagraph\(paper, paragraph, sourceText\) \{/);
assert.match(source, /mergeSourceBlockBoxes\(findSourceBlocksForParagraph\(paper, paragraph, sourceText\)\)/);
assert.match(source, /function normalizeSourceBlockMatchText\(text\) \{/);
