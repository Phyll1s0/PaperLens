import assert from "node:assert/strict";
import {
  buildPaperExportQa,
  findLatexExportRisks,
  hasExportableArtifactCrop,
  isExportRelevantArtifact,
} from "../lib/export-qa.js";

const fixedNow = new Date("2026-06-03T00:00:00.000Z");
const paper = {
  id: "paper_fixture",
  title: "Fixture Paper",
  sections: [{ id: "s1", title: "Introduction" }],
  paragraphs: [
    {
      id: "p1",
      order: 0,
      kind: "paragraph",
      sectionId: "s1",
      pageNumber: 1,
      sourceText: "This paragraph references Figure 1.",
      translation: "完整翻译 $x$",
      explanation: "完整讲解",
      relatedArtifactIds: ["fig-ok", "missing-ref", "hidden-ref"],
      analysisStatus: "done",
    },
    {
      id: "p2",
      order: 1,
      kind: "paragraph",
      sectionId: "s1",
      pageNumber: 2,
      sourceText: "This paragraph failed halfway.",
      translation: "未闭合公式 $x",
      explanation: "",
      relatedArtifactIds: [],
      analysisStatus: "error",
      analysisError: "provider timeout",
    },
    {
      id: "p3",
      order: 2,
      kind: "paragraph",
      sectionId: "s1",
      pageNumber: 3,
      sourceText: "Noise paragraph",
      translation: "",
      explanation: "",
      analysisEligible: false,
      relatedArtifactIds: ["missing-ref"],
    },
  ],
  pageArtifacts: [
    {
      id: "fig-ok",
      type: "caption",
      visualType: "figure",
      label: "Figure 1",
      pageNumber: 1,
      imagePath: "/assets/paper_fixture/page-001.png",
      text: "Figure 1: A useful figure.",
      crop: { x: 10, y: 20, width: 200, height: 120, pageWidth: 612, pageHeight: 792 },
      cropQuality: { confidence: "low", oversized: false },
    },
    {
      id: "formula-no-crop",
      type: "formula",
      visualType: "formula",
      pageNumber: 2,
      imagePath: "",
      text: "\\[x+y",
    },
    {
      id: "table-missing-asset",
      type: "caption",
      visualType: "table",
      label: "Table 1",
      pageNumber: 2,
      imagePath: "/assets/paper_fixture/missing.png",
      text: "Table 1: Missing image asset.",
      crop: { x: 4, y: 8, width: 120, height: 64, pageWidth: 612, pageHeight: 792 },
      cropQuality: { confidence: "high", oversized: false },
    },
    {
      id: "hidden-ref",
      type: "caption",
      visualType: "figure",
      label: "Figure 2",
      pageNumber: 2,
      hidden: true,
      imagePath: "",
      text: "Hidden artifact should not become a broken reference.",
    },
  ],
};

const qa = buildPaperExportQa(paper, {
  now: () => fixedNow,
  isReadingParagraphForPaper: (_paper, paragraph) =>
    paragraph.kind === "paragraph" && paragraph.analysisEligible !== false,
  artifactAssetExists: (artifact) => artifact.id === "fig-ok",
});

assert.equal(qa.checkedAt, fixedNow.toISOString());
assert.equal(qa.status, "error");
assert.deepEqual(qa.summary, {
  readingParagraphs: 2,
  unfinishedParagraphs: 1,
  analysisErrors: 1,
  brokenArtifactRefs: 1,
  checkedArtifacts: 3,
  missingArtifactCrops: 1,
  lowConfidenceCrops: 1,
  missingAssetFiles: 1,
  latexRisks: 1,
  issueCount: 7,
  errorCount: 3,
  warningCount: 4,
});

assert.equal(qa.issues.some((issue) => issue.artifactId === "hidden-ref"), false);
assert.equal(qa.issues.some((issue) => issue.type === "broken-artifact-reference" && issue.artifactId === "missing-ref"), true);
assert.equal(qa.issues.some((issue) => issue.type === "missing-artifact-crop" && issue.artifactId === "formula-no-crop"), true);
assert.equal(qa.issues.some((issue) => issue.type === "missing-artifact-asset" && issue.artifactId === "table-missing-asset"), true);
assert.equal(qa.issues.some((issue) => issue.type === "low-confidence-crop" && issue.artifactId === "fig-ok"), true);
assert.equal(qa.issues.some((issue) => issue.type === "artifact-latex-risk" && issue.artifactId === "formula-no-crop"), false);

assert.deepEqual(findLatexExportRisks("Cost is \\$5 and formula is $x$."), []);
assert.deepEqual(findLatexExportRisks("\\[x+y\\] and \\(z\\)"), []);
assert.match(findLatexExportRisks("\\begin{align}x=1\\end{equation}").join("\n"), /begin/);

assert.equal(hasExportableArtifactCrop(paper.pageArtifacts[0]), true);
assert.equal(hasExportableArtifactCrop({ ...paper.pageArtifacts[0], crop: { width: 0 } }), false);
assert.equal(isExportRelevantArtifact(paper.pageArtifacts[0]), true);
assert.equal(isExportRelevantArtifact({ type: "figure-text", visualType: "figure-text" }), false);
assert.equal(isExportRelevantArtifact({ type: "caption", hidden: true }), false);

const formulaQa = buildPaperExportQa({
  id: "paper_formula_export",
  paragraphs: [
    {
      id: "p1",
      order: 0,
      kind: "paragraph",
      sourceText: "See the formula.",
      translation: "完整翻译",
      explanation: "完整讲解",
      relatedArtifactIds: ["formula-low"],
      analysisStatus: "done",
    },
  ],
  pageArtifacts: [
    {
      id: "formula-low",
      type: "formula",
      visualType: "formula",
      pageNumber: 1,
      imagePath: "/assets/paper_fixture/page-001.png",
      text: "y 1 : L : = { y 1 , ⋯ , y L }",
      crop: { x: 10, y: 20, width: 180, height: 80, pageWidth: 612, pageHeight: 792 },
      cropQuality: { confidence: "medium", oversized: false },
    },
  ],
}, {
  now: () => fixedNow,
});
assert.equal(formulaQa.status, "warn");
assert.equal(formulaQa.issues.some((issue) =>
  issue.type === "low-confidence-formula-latex" &&
    issue.artifactId === "formula-low" &&
    issue.renderMode === "image-latex"), true);
assert.equal(formulaQa.issues.some((issue) => issue.type === "artifact-latex-risk"), false);
