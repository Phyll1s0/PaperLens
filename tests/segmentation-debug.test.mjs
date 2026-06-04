import assert from "node:assert/strict";
import {
  buildPaperSegmentationDebugReport,
  buildSegmentationBlockDebug,
} from "../lib/segmentation-debug.js";

const fixedNow = new Date("2026-06-04T00:00:00.000Z");
const paper = {
  id: "debug_fixture",
  title: "Debug Fixture",
  segmentationMode: "layout",
  segmentationStages: {
    plan: { source: "heuristic-structure" },
    fallback: { strategy: "layout", reason: "agent timeout", chunks: [{ pageRange: "1-2" }] },
    paperMemory: { source: "ai+heuristic", keyTerms: 3, formulas: 1, visuals: 1, resources: 1 },
  },
  paperMemory: {
    version: 1,
    source: "ai+heuristic",
    paperTitle: "Debug Fixture",
    summary: "A forecasting paper used to test the segmentation pre-read memory.",
    mainThread: "Use a pre-read memory before splitting PDF blocks into reading paragraphs.",
    contributions: ["Adds memory-aware segmentation diagnostics."],
    keyTerms: ["Paper Memory", "forecasting", "segmentation"],
    importantFormulas: [
      {
        label: "Loss",
        pageNumber: 2,
        text: "L = -sum log p(y_t | y_<t)",
        purpose: "Training objective that should remain visible to the explainer.",
      },
    ],
    importantVisuals: [
      {
        label: "Figure 1",
        pageNumber: 1,
        type: "figure",
        description: "Architecture overview.",
      },
    ],
    resources: [
      {
        type: "code",
        url: "https://github.com/example/project",
        pageNumber: 1,
        label: "project code",
        whyImportant: "Implementation link.",
      },
    ],
    nonReadingGuidance: ["Author block on page 1 is front matter."],
    segmentationGuidance: ["Keep the abstract as one paragraph."],
    chunkSummaries: ["Pages 1-2 introduce the method."],
    updatedAt: "2026-06-04T00:00:00.000Z",
  },
  sections: [{ id: "s1", title: "Introduction", order: 0 }],
  pageImages: [
    {
      pageNumber: 1,
      imagePath: "/assets/debug_fixture/page-001.png",
      imageWidth: 1224,
      imageHeight: 1584,
    },
  ],
  extractionPages: [
    {
      pageNumber: 1,
      width: 612,
      height: 792,
      blocks: [
        {
          text: "Chronos: Learning the Language of Time Series",
          x: 72,
          y: 62,
          width: 420,
          height: 32,
          lineCount: 1,
        },
        {
          text: "Alice Research alice@example.com Bob University bob@example.edu",
          x: 72,
          y: 120,
          width: 420,
          height: 44,
          lineCount: 2,
        },
        { text: "Abstract", x: 72, y: 260, width: 90, height: 18, lineCount: 1 },
        {
          text: "We present a forecasting accelerator arXiv:2403.07815v1 [cs.LG] 12 Mar 2024 for large scale time series.",
          x: 72,
          y: 286,
          width: 420,
          height: 42,
          lineCount: 2,
        },
        {
          text: "Figure 1. The model architecture.",
          x: 72,
          y: 430,
          width: 280,
          height: 24,
          lineCount: 1,
        },
      ],
    },
    {
      pageNumber: 2,
      blocks: [
        { text: "1 Introduction", x: 72, y: 80, width: 120, height: 18, lineCount: 1 },
        {
          text: "Time series forecasting is a central task across scientific domains.",
          x: 72,
          y: 110,
          width: 420,
          height: 40,
          lineCount: 2,
        },
      ],
    },
  ],
  paragraphs: [
    {
      id: "p1",
      kind: "paragraph",
      order: 0,
      sectionId: "s1",
      pageNumber: 1,
      sourceBox: { x: 72, y: 286, width: 420, height: 42 },
      sourceText: "We present a forecasting accelerator for large scale time series.",
      analysisStatus: "pending",
    },
    {
      id: "p2",
      kind: "paragraph",
      order: 1,
      sectionId: "s1",
      pageNumber: 1,
      sourceText: "Figure 1. The model architecture.",
      analysisEligible: false,
      segmentationNoise: { reason: "caption-text" },
      analysisStatus: "pending",
    },
  ],
};

const report = buildPaperSegmentationDebugReport(paper, { now: () => fixedNow });
assert.equal(report.generatedAt, fixedNow.toISOString());
assert.equal(report.summary.pages, 2);
assert.equal(report.summary.extractionBlocks, 7);
assert.equal(report.summary.droppedBlocks, 3);
assert.equal(report.summary.paragraphsWithNoise, 1);
assert.equal(report.summary.paperMemoryAvailable, true);
assert.equal(report.summary.paperMemoryResources, 1);
assert.equal(report.summary.paperMemoryFormulas, 1);
assert.equal(report.segmentation.mode, "layout");
assert.equal(report.segmentation.fallbackReason, "agent timeout");
assert.equal(report.segmentation.paperMemorySource, "ai+heuristic");
assert.equal(report.paperMemory.available, true);
assert.equal(report.paperMemory.source, "ai+heuristic");
assert.ok(report.paperMemory.summary.includes("forecasting paper"));
assert.ok(report.paperMemory.keyTerms.includes("Paper Memory"));
assert.equal(report.paperMemory.resources[0].url, "https://github.com/example/project");
assert.equal(report.paperMemory.formulas[0].pageNumber, 2);
assert.ok(report.paperMemory.nonReadingGuidance[0].includes("Author block"));

const pageOne = report.pages[0];
assert.equal(pageOne.imagePath, "/assets/debug_fixture/page-001.png");
assert.equal(pageOne.imageWidth, 1224);
assert.equal(pageOne.width, 612);
assert.equal(pageOne.keptBlocks, 2);
assert.equal(pageOne.droppedBlocks, 3);
assert.deepEqual(pageOne.blocks[0].reasons, ["frontmatter-title"]);
assert.ok(pageOne.blocks[1].reasons.includes("author-affiliation"));
assert.ok(pageOne.blocks[3].cleanText.includes("forecasting accelerator"));
assert.equal(pageOne.blocks[3].cleanText.includes("arXiv"), false);
assert.equal(pageOne.blocks[4].decision, "drop");
assert.ok(pageOne.blocks[4].reasons.includes("caption-text"));

const introHeading = report.pages[1].blocks[0];
assert.equal(introHeading.decision, "keep");
assert.ok(introHeading.tags.includes("heading-candidate"));

const noisyParagraph = report.paragraphs.find((item) => item.id === "p2");
assert.ok(noisyParagraph.noiseReasons.includes("analysis-ineligible"));
assert.ok(noisyParagraph.noiseReasons.includes("caption-text"));

const standaloneBlock = buildSegmentationBlockDebug({
  text: "https://example.com/project",
  x: 10,
  y: 10,
  width: 200,
  height: 20,
  lineCount: 1,
}, { pageNumber: 3 });
assert.equal(standaloneBlock.decision, "drop");
assert.ok(standaloneBlock.reasons.includes("standalone-link"));

const diagramLabelBlock = buildSegmentationBlockDebug({
  text: "Raw PDF\nText Blocks\nNoise Filter\nAI Segmenter\nParagraph Queue",
  x: 60,
  y: 180,
  width: 150,
  height: 120,
  lineCount: 5,
}, { pageNumber: 3 });
assert.equal(diagramLabelBlock.decision, "drop");
assert.ok(diagramLabelBlock.reasons.includes("diagram-only-text"));
