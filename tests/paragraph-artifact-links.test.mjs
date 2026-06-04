import assert from "node:assert/strict";
import {
  attachParagraphArtifactLinks,
  extractParagraphArtifactReferences,
  parseArtifactLabel,
  resolveParagraphRelatedArtifacts,
} from "../lib/paragraph-artifact-links.js";

assert.deepEqual(
  extractParagraphArtifactReferences("Figure 1, Fig. 2(a), Table 3 and Equation (4) define the setup.")
    .map((item) => item.key),
  ["figure:1", "figure:2a", "table:3", "equation:4"],
);

assert.deepEqual(parseArtifactLabel("Fig. 7(b): qualitative examples"), {
  kind: "figure",
  number: "7b",
  baseNumber: "7",
  suffix: "b",
  key: "figure:7b",
  baseKey: "figure:7",
});
assert.equal(parseArtifactLabel("Appendix A"), null);

const paper = {
  pageArtifacts: [
    {
      id: "fig-1",
      type: "caption",
      visualType: "figure",
      label: "Figure 1",
      pageNumber: 8,
      text: "Figure 1. Full workflow.",
      crop: { x: 40, y: 240, width: 220, height: 130 },
    },
    {
      id: "fig-1a",
      type: "caption",
      visualType: "figure",
      label: "Figure 1a",
      pageNumber: 8,
      text: "Figure 1a. First subfigure.",
      splitCandidate: true,
      crop: { x: 40, y: 240, width: 100, height: 130 },
    },
    {
      id: "table-2",
      type: "caption",
      visualType: "table",
      label: "Table 2",
      pageNumber: 2,
      text: "Table 2. Main ablation.",
      crop: { x: 80, y: 440, width: 360, height: 120 },
    },
    {
      id: "eq-1",
      type: "formula",
      visualType: "formula",
      label: "Equation 1",
      pageNumber: 4,
      text: "L = CE(y, yhat) (1)",
      crop: { x: 100, y: 300, width: 260, height: 48 },
    },
    {
      id: "near-figure",
      type: "caption",
      visualType: "figure",
      label: "",
      pageNumber: 5,
      text: "An unlabeled visual block.",
      crop: { x: 80, y: 310, width: 280, height: 100 },
    },
    {
      id: "far-figure",
      type: "caption",
      visualType: "figure",
      label: "",
      pageNumber: 5,
      text: "A farther visual block.",
      crop: { x: 80, y: 650, width: 280, height: 100 },
    },
    {
      id: "hidden-table",
      type: "caption",
      visualType: "table",
      label: "Table 9",
      pageNumber: 2,
      hidden: true,
    },
  ],
  paragraphs: [
    {
      id: "p-global",
      kind: "paragraph",
      pageNumber: 2,
      sourceText: "As shown in Figure 1, the application has multiple LLM calls.",
    },
    {
      id: "p-subfigure",
      kind: "paragraph",
      pageNumber: 8,
      sourceText: "Fig. 1(a) isolates the prompt construction branch.",
    },
    {
      id: "p-table-equation",
      kind: "paragraph",
      pageNumber: 2,
      sourceText: "Table 2 reports the ablation, while Equation (1) defines the loss.",
    },
    {
      id: "p-fallback",
      kind: "paragraph",
      pageNumber: 5,
      sourceBox: { x: 60, y: 250, width: 300, height: 40 },
      sourceText: "The figure below illustrates the scheduler.",
    },
    {
      id: "p-plain",
      kind: "paragraph",
      pageNumber: 5,
      sourceText: "The scheduler batches semantically similar calls.",
    },
    {
      id: "p-hidden",
      kind: "paragraph",
      pageNumber: 2,
      sourceText: "Table 9 should not be linked because it is hidden.",
    },
  ],
};

attachParagraphArtifactLinks(paper);

assert.deepEqual(paper.paragraphs.find((item) => item.id === "p-global").relatedArtifactIds, ["fig-1"]);
assert.deepEqual(paper.paragraphs.find((item) => item.id === "p-subfigure").relatedArtifactIds, ["fig-1a"]);
assert.deepEqual(paper.paragraphs.find((item) => item.id === "p-table-equation").relatedArtifactIds, ["table-2", "eq-1"]);
assert.deepEqual(paper.paragraphs.find((item) => item.id === "p-fallback").relatedArtifactIds, ["near-figure"]);
assert.deepEqual(paper.paragraphs.find((item) => item.id === "p-plain").relatedArtifactIds, []);
assert.deepEqual(paper.paragraphs.find((item) => item.id === "p-hidden").relatedArtifactIds, []);

assert.deepEqual(
  resolveParagraphRelatedArtifacts(paper, {
    id: "manual",
    kind: "paragraph",
    pageNumber: 10,
    sourceText: "No explicit reference here.",
    relatedArtifactIds: ["eq-1", "hidden-table"],
  }).map((artifact) => artifact.id),
  ["eq-1"],
);
