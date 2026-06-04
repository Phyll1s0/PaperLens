import assert from "node:assert/strict";
import {
  SEGMENTATION_PLANNING_SNAPSHOT_VERSION,
  attachSegmentationPlanningSnapshot,
  buildSegmentationPlanningSnapshot,
} from "../lib/segmentation-planning-snapshot.js";

const fixedNow = new Date("2026-06-04T09:00:00.000Z");
const paper = {
  id: "paper_plan",
  segmentationMode: "ai",
  structureMap: {
    source: "ai",
    bodyStartPage: 1,
    referencesStartPage: 8,
    sections: [
      { title: "Abstract", startPage: 1, endPage: 1 },
      { title: "Method", startPage: 2, endPage: 5 },
    ],
    segmentationPlan: [
      { id: "abstract", title: "Abstract", startPage: 1, endPage: 1, role: "abstract" },
      { id: "method", title: "Method", startPage: 2, endPage: 5, role: "method" },
    ],
    nonBodyZones: [
      { type: "authors", label: "Author block", startPage: 1, endPage: 1 },
      { type: "references", label: "References", startPage: 8, endPage: 9 },
    ],
  },
  paperMemory: {
    source: "ai+heuristic",
    summary: "A useful memory.",
    keyTerms: ["token"],
    importantFormulas: [{ label: "Eq. 1" }],
    importantVisuals: [{ label: "Figure 1" }],
    resources: [{ url: "https://example.com" }],
    nonReadingGuidance: ["Skip authors."],
  },
  segmentationStages: {
    plan: { source: "planning-snapshot", strategy: "planning-only" },
    paperMemory: { source: "ai+heuristic", reused: false },
    fallback: { strategy: "local-layout", chunks: [{ index: 1 }] },
  },
};

const snapshot = buildSegmentationPlanningSnapshot(paper, { now: () => fixedNow });
assert.equal(snapshot.version, SEGMENTATION_PLANNING_SNAPSHOT_VERSION);
assert.equal(snapshot.status, "ready");
assert.equal(snapshot.reuseLevel, "strong");
assert.equal(snapshot.strategy, "planning-only");
assert.equal(snapshot.counts.planItems, 2);
assert.equal(snapshot.counts.nonBodyZones, 2);
assert.equal(snapshot.counts.paperMemoryKeyTerms, 1);
assert.equal(snapshot.counts.paperMemoryGuidance, 1);
assert.equal(snapshot.counts.fallbackChunks, 1);
assert.equal(snapshot.flags.partialFallback, true);
assert.equal(snapshot.flags.structureReusable, true);
assert.equal(snapshot.flags.memoryReusable, true);
assert.equal(snapshot.planPreview[0].title, "Abstract");
assert.match(snapshot.summary, /规划快照完整/);

const attachedPaper = { ...paper };
attachSegmentationPlanningSnapshot(attachedPaper, { now: () => fixedNow });
assert.equal(attachedPaper.segmentationPlanningSnapshot.fingerprint, snapshot.fingerprint);

const later = new Date("2026-06-04T10:00:00.000Z");
const preserved = buildSegmentationPlanningSnapshot(attachedPaper, {
  now: () => later,
  previous: attachedPaper.segmentationPlanningSnapshot,
});
assert.equal(preserved.generatedAt, fixedNow.toISOString());

const weak = buildSegmentationPlanningSnapshot({
  id: "paper_weak",
  paragraphs: [],
}, { now: () => fixedNow });
assert.equal(weak.status, "missing");
assert.equal(weak.reuseLevel, "weak");
assert.equal(weak.reusable, false);
