import assert from "node:assert/strict";
import {
  ANALYSIS_VERIFICATION_VERSION,
  verifyBatchAnalysisResults,
  verifyParagraphAnalysis,
} from "../lib/analysis-verifier.js";

const paper = {
  deepPaperPlan: {
    terminology: [
      { source: "Microscaling", zh: "微缩放", aliases: ["MX"] },
      { source: "E8M0", zh: "", aliases: [] },
    ],
  },
  sectionDigests: [
    {
      id: "method",
      keyTerms: [{ source: "Metadata", zh: "元数据" }],
    },
  ],
  paperMemory: {
    keyTerms: ["FP4"],
  },
  pageArtifacts: [
    {
      id: "fig-1",
      type: "caption",
      visualType: "figure",
      label: "Figure 1",
      pageNumber: 2,
    },
    {
      id: "eq-2",
      type: "formula",
      visualType: "formula",
      label: "Equation 2",
      pageNumber: 3,
    },
  ],
};

const paragraph = {
  id: "p1",
  kind: "paragraph",
  sectionId: "method",
  pageNumber: 2,
  sourceText: [
    "Microscaling uses E8M0 metadata to share a scale across k scalar elements.",
    "As shown in Figure 1, the format stores the exponent-only scale near FP4 payloads.",
    "Equation (2) defines the shared scale and explains why the design is hardware friendly.",
  ].join(" "),
  relatedArtifactIds: ["fig-1", "eq-2"],
};

const good = verifyParagraphAnalysis(paper, paragraph, {
  paragraphId: "p1",
  translation: "微缩放（Microscaling）使用 E8M0 元数据在 k 个标量元素之间共享缩放因子。如图 1 所示，该格式把仅含指数的缩放值放在 FP4 载荷附近。公式 2 定义共享缩放因子，并解释这个设计为什么对硬件友好。",
  explanation: "这一段在方法章节中说明格式设计的核心机制：用 E8M0 元数据共享缩放因子。它承接前面的动机，并把 Figure 1 的格式示意和 Equation 2 的缩放定义连接起来，支持论文关于硬件友好的论证。读者需要注意这里的 metadata 不是普通 FP16 scale，而是指数型 scale。",
  keyTerms: ["微缩放", "E8M0", "元数据"],
  coverage: {
    translatedAllSentences: true,
    mentionsSectionRole: true,
    mentionsRelevantFormulaOrFigure: true,
    confidence: 0.92,
  },
});

assert.equal(good.version, ANALYSIS_VERIFICATION_VERSION);
assert.equal(good.status, "ok");
assert.equal(good.weak, false);
assert.equal(good.issues.length, 0);
assert.equal(good.metrics.references, 2);

const weak = verifyParagraphAnalysis(paper, paragraph, {
  paragraphId: "p1",
  translation: "本文介绍了一种量化格式。",
  explanation: "这段讲格式。",
  keyTerms: [],
  coverage: {
    translatedAllSentences: false,
    mentionsSectionRole: false,
    mentionsRelevantFormulaOrFigure: false,
    confidence: 0.4,
  },
});

assert.equal(weak.status, "error");
assert.equal(weak.weak, true);
const weakCodes = new Set(weak.issues.map((issue) => issue.code));
assert.equal(weakCodes.has("coverage-translation-incomplete"), true);
assert.equal(weakCodes.has("translation-too-short"), true);
assert.equal(weakCodes.has("explanation-too-short"), true);
assert.equal(weakCodes.has("missing-figure-reference"), true);
assert.equal(weakCodes.has("missing-equation-reference"), true);
assert.equal(weakCodes.has("terminology-drift"), true);

const batch = verifyBatchAnalysisResults(paper, [
  paragraph,
  { ...paragraph, id: "p2", sourceText: "A second paragraph uses E8M0 metadata." },
], [
  {
    paragraphId: "p1",
    translation: good.metrics.translationChars ? "微缩放 E8M0 元数据。图 1。公式 2。" : "",
    explanation: "这一段说明方法设计作用，并联系图 1 和公式 2。",
    coverage: {
      translatedAllSentences: true,
      mentionsSectionRole: true,
      mentionsRelevantFormulaOrFigure: true,
      confidence: 0.8,
    },
  },
]);

assert.equal(batch.status, "error");
assert.deepEqual(batch.missingParagraphIds, ["p2"]);
assert.equal(batch.summary.checked, 1);
assert.equal(batch.summary.missing, 1);
