import assert from "node:assert/strict";
import {
  repairExistingPaperSegmentation,
} from "../lib/segmentation-local-repair.js";

function paragraph(id, sourceText, pageNumber, extra = {}) {
  return {
    id,
    kind: "paragraph",
    order: Number(id.replace(/\D/g, "")) || 0,
    pageNumber,
    pageEndNumber: pageNumber,
    sourceText,
    rawSourceText: sourceText,
    translation: `translation-${id}`,
    explanation: `explanation-${id}`,
    keyTerms: ["term"],
    relatedArtifactIds: [],
    chatMessages: [],
    analysisStatus: "done",
    analysisError: "",
    ...extra,
  };
}

const paper = {
  id: "paper_local_repair",
  structureMap: {
    segmentationPlan: [
      { id: "sec_motivation", title: "3 Motivation", role: "background", startPage: 4, endPage: 4 },
      { id: "sec_design", title: "4 M2XFP Analysis and Design", role: "method", startPage: 5, endPage: 5 },
    ],
  },
  extractionPages: [
    { pageNumber: 4, width: 612, height: 792 },
    { pageNumber: 5, width: 612, height: 792 },
    { pageNumber: 6, width: 612, height: 792 },
  ],
  paragraphs: [
    paragraph(
      "p0",
      "While these methods provide strong representational flexibility, they face two fundamental limitations: runtime decisions and Decoder",
      4,
      { continuesToNext: true, sourceBox: { pageNumber: 4, x: 72, y: 700, width: 220, height: 42, pageHeight: 792 } },
    ),
    paragraph(
      "p1",
      "complexity. Supporting multiple custom data types demands numerous decoders and format converters in hardware.",
      5,
      { continuesFromPrevious: true, sourceBox: { pageNumber: 5, x: 72, y: 60, width: 220, height: 42, pageHeight: 792 } },
    ),
    paragraph(
      "p2",
      "A stable unchanged paragraph should keep its cached translation and explanation after local repair.",
      5,
    ),
    paragraph(
      "p3",
      "A stable unchanged paragraph should keep its cached translation and explanation after local repair.",
      5,
    ),
    {
      ...paragraph("p4", "Figure 1: an existing hidden caption remains available for debugging.", 5),
      hidden: true,
      analysisEligible: false,
      analysisStatus: "done",
      segmentationNoise: { reasons: ["caption"] },
    },
  ],
};

const result = repairExistingPaperSegmentation(paper);

assert.equal(result.summary.inputVisibleParagraphs, 4);
assert.equal(result.validationSummary.mergedFragments, 1);
assert.deepEqual(result.changedParagraphIds, ["p0"]);
assert.ok(result.removedParagraphIds.includes("p1"));
assert.ok(result.removedParagraphIds.includes("p3"));
assert.ok(result.mergedParagraphIds.includes("p1"));
assert.ok(result.hiddenParagraphIds.includes("p3"));

const repaired = result.paragraphs.find((item) => item.id === "p0");
assert.match(repaired.sourceText, /runtime decisions and Decoder complexity/);
assert.equal(repaired.pageEndNumber, 5);
assert.equal(repaired.analysisStatus, "pending");
assert.equal(repaired.translation, "");
assert.equal(repaired.explanation, "");

const unchanged = result.paragraphs.find((item) => item.id === "p2");
assert.equal(unchanged.analysisStatus, "done");
assert.equal(unchanged.translation, "translation-p2");
assert.equal(unchanged.explanation, "explanation-p2");

const hiddenDuplicate = result.paragraphs.find((item) => item.id === "p3");
assert.equal(hiddenDuplicate.hidden, true);
assert.equal(hiddenDuplicate.analysisEligible, false);
assert.equal(hiddenDuplicate.segmentationNoise.reasons[0], "local-validation-removed");

const existingHidden = result.paragraphs.find((item) => item.id === "p4");
assert.equal(existingHidden.hidden, true);
assert.deepEqual(existingHidden.segmentationNoise.reasons, ["caption"]);

assert.deepEqual(
  result.paragraphs.map((item) => item.order),
  result.paragraphs.map((_, index) => index),
);
