import assert from "node:assert/strict";
import {
  auditSegmentedParagraphNoise,
  scoreCrossPageMergeCandidate,
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
  assert.equal(result.summary.crossPageRepair.candidates, 1);
  assert.equal(result.summary.crossPageRepair.merged, 1);
  assert.equal(result.summary.crossPageRepair.reasons["explicit-continuation"], 1);
  assert.equal(result.paragraphs.length, 2);
  assert.equal(result.paragraphs[0].pageNumber, 3);
  assert.equal(result.paragraphs[0].pageEndNumber, 4);
  assert.match(result.paragraphs[0].sourceText, /temporal pattern before a language model/);
  assert.equal(result.paragraphs[0].plannedSectionId, "sec_method");
  assert.equal(result.paragraphs[0].segmentationMergeTrace[0].type, "cross-page");
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
  assert.equal(result.summary.crossPageRepair.candidates, 1);
  assert.equal(result.summary.crossPageRepair.rejected, 1);
  assert.equal(result.summary.crossPageRepair.blockers["section-mismatch"], 1);
  assert.equal(result.paragraphs.length, 3);
  assert.equal(result.paragraphs[0].plannedSectionId, "sec_method");
  assert.equal(result.paragraphs[1].plannedSectionId, "sec_results");
}

{
  const m2xfpStructureMap = {
    segmentationPlan: [
      { id: "sec_motivation", title: "3 Motivation", role: "background", startPage: 4, endPage: 4 },
      { id: "sec_design", title: "4 M2XFP Analysis and Design", role: "method", startPage: 5, endPage: 5 },
    ],
  };
  const result = validateAndRepairSegmentedParagraphs([
    paragraph(
      "p1",
      "While these methods provide strong representational flexibility, they face two fundamental limitations: runtime decisions and Decoder",
      4,
      { continuesToNext: true },
    ),
    paragraph(
      "p2",
      "complexity. Supporting multiple custom data types demands numerous decoders and format converters in hardware.",
      5,
      { continuesFromPrevious: true },
    ),
  ], m2xfpStructureMap);

  assert.equal(result.summary.mergedFragments, 1);
  assert.equal(result.summary.crossPageRepair.candidates, 1);
  assert.equal(result.summary.crossPageRepair.merged, 1);
  assert.equal(result.summary.crossPageRepair.reasons["section-mismatch-overridden"], 1);
  assert.equal(result.paragraphs.length, 1);
  assert.equal(result.paragraphs[0].pageNumber, 4);
  assert.equal(result.paragraphs[0].pageEndNumber, 5);
  assert.match(result.paragraphs[0].sourceText, /Decoder complexity\. Supporting/);
  assert.equal(result.paragraphs[0].plannedSectionId, "sec_motivation");
}

{
  const previous = paragraph(
    "p1",
    "The proposed tokenizer first maps each time-series value into a coarse token while preserving",
    3,
    {
      sectionTitleHint: "Method",
      plannedSectionId: "sec_method",
      sourceBox: { x: 72, y: 710, width: 420, height: 42 },
    },
  );
  const next = paragraph(
    "p2",
    "the local fine-grained residual with a second codebook before the decoder predicts future tokens.",
    4,
    {
      sectionTitleHint: "Method",
      plannedSectionId: "sec_method",
      sourceBox: { x: 72, y: 86, width: 420, height: 44 },
    },
  );
  const score = scoreCrossPageMergeCandidate(previous, next, {
    pageMetrics: [
      { pageNumber: 3, pageHeight: 792 },
      { pageNumber: 4, pageHeight: 792 },
    ],
  });

  assert.equal(score.candidate, true);
  assert.equal(score.shouldMerge, true);
  assert.ok(score.score >= 7);
  assert.ok(score.reasons.includes("previous-open-sentence"));
  assert.ok(score.reasons.includes("next-starts-continuation"));
  assert.ok(score.reasons.includes("previous-near-page-bottom"));
  assert.ok(score.reasons.includes("next-near-page-top"));
}

{
  const previous = paragraph(
    "p1",
    "The experiment section ends with a complete sentence about the benchmark setup.",
    3,
    {
      sectionTitleHint: "Method",
      plannedSectionId: "sec_method",
      sourceBox: { x: 72, y: 710, width: 420, height: 42 },
    },
  );
  const next = paragraph(
    "p2",
    "Results show that the method improves accuracy across several datasets.",
    4,
    {
      sectionTitleHint: "Method",
      plannedSectionId: "sec_method",
      sourceBox: { x: 72, y: 86, width: 420, height: 44 },
    },
  );
  const score = scoreCrossPageMergeCandidate(previous, next, {
    pageMetrics: [
      { pageNumber: 3, pageHeight: 792 },
      { pageNumber: 4, pageHeight: 792 },
    ],
  });

  assert.equal(score.candidate, true);
  assert.equal(score.shouldMerge, false);
  assert.ok(score.blockers.length > 0);
}

{
  const score = scoreCrossPageMergeCandidate(
    paragraph("p1", "The previous manually edited paragraph does not merge across", 3, {
      manualSegmentationEdit: { action: "merge" },
    }),
    paragraph("p2", "pages even if the next text looks like a continuation.", 4),
  );
  assert.equal(score.candidate, true);
  assert.equal(score.shouldMerge, false);
  assert.ok(score.blockers.includes("manual-edit"));
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
    paragraph("p9", "M2XFP: A Metadata-Augmented Microscaling Data Format for Efficient Low-bit Quantization", 5),
    paragraph("p10", "Weiming Hu et al.", 6),
  ], structureMap);

  assert.deepEqual(
    result.paragraphs.map((item) => item.id),
    ["p3", "p8"],
  );
  assert.equal(result.summary.removedNonReading, 8);
  assert.equal(result.summary.qualityAudit.reasons["header-footer"], 4);
  assert.equal(result.summary.qualityAudit.reasons.caption, 1);
  assert.equal(result.summary.qualityAudit.reasons["table-body"], 1);
  assert.equal(result.summary.qualityAudit.reasons["structure-nonbody-zone"], 2);
}

{
  const result = validateAndRepairSegmentedParagraphs([
    paragraph("p1", "Raw PDF Text Blocks Noise Filter AI Segmenter Paragraph Queue", 3, { lineCount: 5 }),
    paragraph("p2", "The segmentation pipeline uses page-level evidence to avoid sending figure labels into the reading queue.", 3, { lineCount: 2 }),
  ], structureMap);

  assert.deepEqual(result.paragraphs.map((item) => item.id), ["p2"]);
  assert.equal(result.summary.removedNonReading, 1);
  assert.equal(result.summary.qualityAudit.reasons["visual-text"], 1);
}

{
  const titleMap = {
    ...structureMap,
    paperTitle: "Kronos Forecasting Foundation Models for the Language of Time Series",
  };
  const result = validateAndRepairSegmentedParagraphs([
    paragraph("p1", "Kronos Forecasting Foundation Models for the Language of Time Series", 5),
    paragraph("p2", "Forecasting Foundation Models for the Language of Time Series", 6),
    paragraph(
      "p3",
      "Kronos models temporal dynamics by combining tokenization and autoregressive prediction into a coherent forecasting pipeline.",
      6,
    ),
    paragraph(
      "p4",
      "This body sentence mentions Kronos Forecasting Foundation Models for the Language of Time Series as related work, so it should remain.",
      6,
    ),
  ], titleMap);

  assert.deepEqual(result.paragraphs.map((item) => item.id), ["p3", "p4"]);
  assert.equal(result.summary.removedNonReading, 2);
  assert.equal(result.summary.qualityAudit.reasons["paper-title-header"], 2);

  const firstPageAudit = auditSegmentedParagraphNoise(
    paragraph("p5", titleMap.paperTitle, 1),
    titleMap,
  );
  assert.equal(firstPageAudit.action, "");
}

{
  const audit = auditSegmentedParagraphNoise(
    paragraph("p1", "The model reports MAE and RMSE as evaluation metrics, but this sentence is still a normal explanatory paragraph.", 4),
    structureMap,
  );
  assert.equal(audit.action, "");
}

{
  const result = validateAndRepairSegmentedParagraphs([
    paragraph(
      "p1",
      "We implement a lightweight hardware unit and integrate it into the accelerarXiv:2601.19213v2 [cs.AR] 28 Jan 2026 ator. Evaluation results demonstrate that the method narrows the accuracy gap.",
      1,
    ),
  ], {
    segmentationPlan: [
      { id: "sec_abstract", title: "Abstract", role: "abstract", startPage: 1, endPage: 1 },
    ],
  });

  assert.equal(result.paragraphs.length, 1);
  assert.match(result.paragraphs[0].sourceText, /into the accelerator\. Evaluation/);
  assert.doesNotMatch(result.paragraphs[0].sourceText, /arXiv/i);
}
