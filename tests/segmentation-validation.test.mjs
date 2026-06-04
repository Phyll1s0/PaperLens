import assert from "node:assert/strict";
import {
  auditSegmentedParagraphNoise,
  validateAndRepairSegmentedParagraphs,
} from "../lib/segmentation-validation.js";

function paragraph(id, sourceText, pageNumber, extra = {}) {
  return {
    id,
    kind: "paragraph",
    order: Number(id.replace(/\D/g, "")) || 0,
    pageNumber,
    pageEndNumber: pageNumber,
    sourceText,
    translation: "",
    explanation: "",
    keyTerms: [],
    relatedArtifactIds: [],
    chatMessages: [],
    analysisStatus: "pending",
    analysisError: "",
    ...extra,
  };
}

const structureMap = {
  segmentationPlan: [
    { id: "sec_method", title: "Method", role: "method", startPage: 2, endPage: 5 },
    { id: "sec_results", title: "Experiments", role: "result", startPage: 6, endPage: 8 },
  ],
  nonBodyZones: [
    { type: "references", startPage: 10, endPage: 12 },
  ],
};

{
  const result = validateAndRepairSegmentedParagraphs([
    paragraph(
      "p1",
      "Chronos first introduces a tokenizer that maps real-valued observations into a discrete vocabulary while preserving the coarse temporal pattern",
      3,
      { sectionTitleHint: "Method", continuesToNext: true },
    ),
    paragraph(
      "p2",
      "before a language model predicts future token IDs autoregressively and maps them back to numeric forecasts.",
      4,
      { sectionTitleHint: "Method", continuesFromPrevious: true },
    ),
    paragraph(
      "p3",
      "The merged context should remain in the method section so later explanations can still inherit the right local context.",
      4,
      { sectionTitleHint: "Method" },
    ),
  ], structureMap);

  assert.equal(result.summary.mergedFragments, 1);
  assert.equal(result.paragraphs.length, 2);
  assert.equal(result.paragraphs[0].pageNumber, 3);
  assert.equal(result.paragraphs[0].pageEndNumber, 4);
  assert.match(result.paragraphs[0].sourceText, /temporal pattern before a language model/);
  assert.equal(result.paragraphs[0].plannedSectionId, "sec_method");
}

{
  const result = validateAndRepairSegmentedParagraphs([
    paragraph(
      "p1",
      "Kronos uses a coarse-to-fine tokenization scheme that first predicts the high level movement of the time series",
      5,
    ),
    paragraph(
      "p2",
      "we evaluate the design on multiple benchmark families and compare against strong forecasting baselines.",
      6,
    ),
    paragraph(
      "p3",
      "These experiments show where hierarchical tokenization helps and where the remaining errors come from.",
      6,
    ),
  ], structureMap);

  assert.equal(result.summary.mergedFragments, 0);
  assert.equal(result.paragraphs.length, 3);
  assert.equal(result.paragraphs[0].plannedSectionId, "sec_method");
  assert.equal(result.paragraphs[1].plannedSectionId, "sec_results");
}

{
  const result = validateAndRepairSegmentedParagraphs([
    paragraph("p1", "Proceedings of Machine Learning Research", 2),
    paragraph("p2", "Proceedings of Machine Learning Research", 3),
    paragraph("p3", "M2XFP quantization stores shared exponents separately from low bit mantissas, which lets the hardware keep more dynamic range in the decode path.", 4),
    paragraph("p4", "Table 1: Accuracy and latency results for representative quantization formats.", 4),
    paragraph("p5", "Dataset Horizon MAE RMSE MAPE Chronos 24 0.31 0.52 8.4 M2XFP 24 0.29 0.48 7.9", 4, { lineCount: 2 }),
    paragraph("p6", "References", 10, { kind: "heading" }),
    paragraph("p7", "[17] Ansell et al. Chronos: Learning the Language of Time Series. arXiv preprint arXiv:2403.07815, 2024.", 10),
    paragraph("p8", "This remaining body paragraph should survive because it is ordinary reading material with a complete sentence.", 5),
  ], structureMap);

  assert.deepEqual(
    result.paragraphs.map((item) => item.id),
    ["p3", "p8"],
  );
  assert.equal(result.summary.removedNonReading, 6);
  assert.equal(result.summary.qualityAudit.reasons["header-footer"], 2);
  assert.equal(result.summary.qualityAudit.reasons.caption, 1);
  assert.equal(result.summary.qualityAudit.reasons["table-body"], 1);
  assert.equal(result.summary.qualityAudit.reasons["structure-nonbody-zone"], 2);
}

{
  const audit = auditSegmentedParagraphNoise(
    paragraph("p1", "The model reports MAE and RMSE as evaluation metrics, but this sentence is still a normal explanatory paragraph.", 4),
    structureMap,
  );
  assert.equal(audit.action, "");
}
