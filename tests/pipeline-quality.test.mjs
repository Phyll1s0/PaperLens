import assert from "node:assert/strict";
import {
  PIPELINE_QUALITY_VERSION,
  buildPaperPipelineQualityReport,
} from "../lib/pipeline-quality.js";

const fixedNow = new Date("2026-06-04T08:00:00.000Z");

const riskyPaper = {
  id: "paper_quality_risky",
  title: "Risky Paper",
  pageCount: 4,
  status: "ready",
  segmentationMode: "ai",
  sections: [{ id: "s1", title: "Introduction" }],
  structureMap: {
    source: "ai",
    sections: [{ title: "Introduction", startPage: 1 }],
    segmentationPlan: [{ title: "Introduction", startPage: 1 }],
  },
  paperMemory: { summary: "A model summary." },
  segmentationPlanningSnapshot: {
    status: "partial",
    reuseLevel: "weak",
    reusable: false,
    strategy: "planning-only",
    strategyLabel: "只重建规划快照",
    summary: "规划快照部分可用",
    counts: { planItems: 1, nonBodyZones: 0 },
    flags: {
      structureReusable: true,
      memoryReusable: false,
      partialFallback: true,
    },
    sources: { structure: "ai", memory: "" },
  },
  paragraphs: [
    completeParagraph("p1", { sourceBox: { x: 10, y: 20, width: 200, height: 80 } }),
    completeParagraph("p2", { sourceBox: { x: 10, y: 120, width: 200, height: 80 } }),
    failedParagraph("p3"),
    pendingParagraph("p4"),
    pendingParagraph("p5"),
    pendingParagraph("p6"),
    pendingParagraph("p7"),
    pendingParagraph("p8"),
    {
      id: "hidden",
      kind: "paragraph",
      sectionId: "s1",
      pageNumber: 2,
      sourceText: "Code and datasets are available at https://github.com/example/m2xfp.",
      analysisEligible: false,
      recoverableFilteredBlock: {
        reason: "resource-link",
        source: "segmentation-input-filter",
      },
    },
    {
      id: "hidden_formula",
      kind: "paragraph",
      sectionId: "s1",
      pageNumber: 3,
      sourceText: "x = arg min_theta L(theta)",
      analysisEligible: false,
      recoverableFilteredBlock: {
        reason: "formula",
        source: "segmentation-input-filter",
      },
    },
  ],
  pageArtifacts: [
    {
      id: "fig-low",
      type: "caption",
      visualType: "figure",
      label: "Figure 1",
      imagePath: "/assets/paper_quality_risky/page-001.png",
      crop: { x: 10, y: 20, width: 300, height: 280, pageWidth: 612, pageHeight: 792 },
      cropQuality: { confidence: "low", oversized: true },
    },
    {
      id: "formula-bad",
      type: "formula",
      visualType: "formula",
      text: "\\begin{align}x=1\\end{equation}",
      imagePath: "",
    },
  ],
  visualQa: {
    summary: {
      totalArtifacts: 2,
      visibleArtifacts: 2,
      issueArtifacts: 2,
      missingCrops: 1,
      lowConfidence: 1,
      oversized: 1,
      figures: 1,
      formulas: 1,
      codeBlocks: 0,
    },
  },
  visualAnalysis: {
    provider: "json",
    status: "ok",
    regions: 3,
  },
};

const riskyReport = buildPaperPipelineQualityReport(riskyPaper, {
  now: () => fixedNow,
  isReadingParagraphForPaper: (_paper, paragraph) =>
    paragraph.kind === "paragraph" && paragraph.analysisEligible !== false,
  exportQa: {
    status: "error",
    summary: {
      issueCount: 3,
      errorCount: 1,
      warningCount: 2,
      unfinishedParagraphs: 6,
      brokenArtifactRefs: 1,
      latexRisks: 1,
    },
  },
  segmentationDebug: {
    issueSummary: {
      total: 4,
      categories: [
        { id: "caption-noise", severity: "high", count: 2 },
        { id: "missing-source-box", severity: "medium", count: 2 },
      ],
    },
  },
});

assert.equal(riskyReport.version, PIPELINE_QUALITY_VERSION);
assert.equal(riskyReport.generatedAt, fixedNow.toISOString());
assert.equal(riskyReport.status, "error");
assert.equal(riskyReport.summary.readingParagraphs, 8);
assert.equal(riskyReport.summary.planningStatus, "partial");
assert.equal(riskyReport.summary.planningReuseLevel, "weak");
assert.equal(riskyReport.summary.planningFallback, true);
assert.equal(riskyReport.metrics.paragraphs.sourceBoxPercent, 25);
assert.equal(riskyReport.summary.recoverableFilteredParagraphs, 2);
assert.equal(riskyReport.summary.recoverableResourceLinks, 1);
assert.equal(riskyReport.summary.recoverableFormulaLike, 1);
assert.equal(riskyReport.metrics.paragraphs.recoverableSamples[0].paragraphId, "hidden");
assert.equal(riskyReport.metrics.paragraphs.recoverableSamples[0].restorable, true);
assert.equal(riskyReport.metrics.planning.planItems, 1);
assert.equal(riskyReport.metrics.visual.issueArtifacts, 2);
assert.equal(riskyReport.metrics.formulas.riskCount, 1);
assert.equal(riskyReport.metrics.formulas.lowConfidenceLatex, 1);
assert.ok(riskyReport.score < 60);

const riskyCodes = new Set(riskyReport.checks.map((check) => check.code));
assert.equal(riskyCodes.has("debug-issues"), true);
assert.equal(riskyCodes.has("planning-weak"), true);
assert.equal(riskyCodes.has("planning-fallback"), true);
assert.equal(riskyCodes.has("low-sourcebox-coverage"), true);
assert.equal(riskyCodes.has("visual-artifact-issues"), true);
assert.equal(riskyCodes.has("formula-risk"), true);
assert.equal(riskyCodes.has("analysis-failed"), true);
assert.equal(riskyCodes.has("export-errors"), true);
assert.equal(riskyCodes.has("recoverable-filtered-content"), true);
assert.ok(riskyReport.actions.some((action) => action.category === "segmentation"));

const cleanPaper = {
  id: "paper_quality_clean",
  title: "Clean Paper",
  pageCount: 1,
  status: "ready",
  segmentationMode: "layout",
  paragraphs: [
    completeParagraph("ok1", { sourceBox: { x: 1, y: 2, width: 3, height: 4 } }),
    completeParagraph("ok2", { sourceBox: { x: 1, y: 20, width: 3, height: 4 } }),
  ],
  pageArtifacts: [],
};

const cleanReport = buildPaperPipelineQualityReport(cleanPaper, {
  now: () => fixedNow,
  exportQa: {
    status: "ok",
    summary: {
      issueCount: 0,
      errorCount: 0,
      warningCount: 0,
    },
  },
});

assert.equal(cleanReport.status, "ok");
assert.equal(cleanReport.score, 100);
assert.equal(cleanReport.summary.issueCount, 0);
assert.equal(cleanReport.checks.length, 1);
assert.equal(cleanReport.checks[0].code, "pipeline-ok");

function completeParagraph(id, patch = {}) {
  return {
    id,
    kind: "paragraph",
    sectionId: "s1",
    pageNumber: 1,
    sourceText: "This is a sufficiently long paragraph for the quality report fixture.",
    translation: "完整翻译",
    explanation: "完整讲解",
    analysisStatus: "done",
    ...patch,
  };
}

function pendingParagraph(id) {
  return {
    id,
    kind: "paragraph",
    sectionId: "s1",
    pageNumber: 1,
    sourceText: "This pending paragraph still has enough text to avoid short-fragment warnings.",
    translation: "",
    explanation: "",
    analysisStatus: "pending",
  };
}

function failedParagraph(id) {
  return {
    ...pendingParagraph(id),
    analysisStatus: "error",
    analysisError: "provider timeout",
  };
}
