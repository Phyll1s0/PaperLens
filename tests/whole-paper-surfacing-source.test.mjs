import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appSource = await readFile(path.join(rootDir, "public", "app.js"), "utf8");
const pipelineSource = await readFile(path.join(rootDir, "lib", "pipeline-quality.js"), "utf8");
const exportQaSource = await readFile(path.join(rootDir, "lib", "export-qa.js"), "utf8");

assert.match(pipelineSource, /function buildWholePaperAnalysisMetrics/);
assert.match(pipelineSource, /sectionDigestCoveragePercent/);
assert.match(pipelineSource, /sectionDraftCoveragePercent/);
assert.match(pipelineSource, /weakAnalysisParagraphs/);
assert.match(pipelineSource, /terminologyDriftIssues/);
assert.match(pipelineSource, /analysis-reference-missing/);

assert.match(exportQaSource, /weakAnalysisParagraphs/);
assert.match(exportQaSource, /formatWeakAnalysisExportMessage/);
assert.match(exportQaSource, /missingReferenceAnalysisRisks/);

assert.match(appSource, /formatPipelineWholePaperMetric/);
assert.match(appSource, /草稿 \$\{wholePaper\.sectionDraftCoveragePercent/);
assert.match(appSource, /renderParagraphQualityBadges/);
assert.match(appSource, /paragraph-quality-badge/);
assert.match(appSource, /label: "弱分析"/);
assert.match(appSource, /repairWeakOnly: true/);
