import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(rootDir, "server.js"), "utf8");

assert.match(source, /from "\.\/lib\/deep-paper-plan\.js"/);
assert.match(source, /prepareDeepPaperAnalysisContext\(paper, settings\);/);
assert.match(source, /buildBatchSectionDigestContext\(paper, paragraphs, settings\)/);
assert.match(source, /buildBatchSectionDraftContext\(paper, paragraphs, settings\)/);
assert.match(source, /formatSectionDigestForPrompt\(digest/);
assert.match(source, /formatSectionDraftForPrompt\(draft/);
assert.match(source, /formatDeepPaperPlanForPrompt\(paper\.deepPaperPlan/);
assert.match(source, /copyPaperDeepAnalysisFields\(targetPaper, paper\)/);
assert.match(source, /sectionDraftFingerprint/);
assert.match(source, /paragraph\.analysisCoverage = normalizeAnalysisCoverage\(result\.coverage\)/);
assert.match(source, /verifyBatchAnalysisResults\(paper, paragraphs, parsed/);
assert.match(source, /applyAnalysisVerification\(paper, paragraph, parsed/);
assert.match(source, /paragraph\.weakAnalysis = Boolean\(paragraph\.analysisVerification\?\.weak\)/);
assert.match(source, /"mentionsSectionRole": true/);
assert.match(source, /normalizeAnalysisProfile\(settings\.analysisProfile\) !== "fast"/);
