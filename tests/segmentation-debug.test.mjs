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
assert.equal(report.segmentation.mode, "layout");
assert.equal(report.segmentation.fallbackReason, "agent timeout");

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
