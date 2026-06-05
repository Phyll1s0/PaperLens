import {
  FORMULA_RENDER_MODE_IMAGE,
  FORMULA_RENDER_MODE_IMAGE_LATEX,
  buildFormulaRenderFields,
} from "./formula-render-quality.js";

export function buildPaperExportQa(paper, options = {}) {
  const isReadingParagraphForPaper = options.isReadingParagraphForPaper || defaultIsReadingParagraphForPaper;
  const isVisiblePaperArtifact = options.isVisiblePaperArtifact || defaultIsVisiblePaperArtifact;
  const isPaperOcrRequired = options.isPaperOcrRequired || defaultIsPaperOcrRequired;
  const artifactAssetExists = options.artifactAssetExists || (() => true);
  const now = typeof options.now === "function" ? options.now : () => new Date();
  const readingParagraphs = (paper.paragraphs || [])
    .filter((paragraph) => isReadingParagraphForPaper(paper, paragraph));
  const artifacts = Array.isArray(paper?.pageArtifacts)
    ? paper.pageArtifacts.filter(isVisiblePaperArtifact)
    : [];
  const allArtifactsById = new Map((Array.isArray(paper.pageArtifacts) ? paper.pageArtifacts : [])
    .map((artifact) => [artifact.id, artifact]));
  const artifactsById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const issues = [];
  const checkedArtifactIds = new Set();
  const artifactCropIssueIds = new Set();
  const lowConfidenceCropIds = new Set();
  const missingAssetIds = new Set();
  let unfinishedParagraphs = 0;
  let analysisErrors = 0;
  let weakAnalysisParagraphs = 0;
  let weakAfterRepairParagraphs = 0;
  let terminologyRisks = 0;
  let missingReferenceAnalysisRisks = 0;
  let brokenArtifactRefs = 0;
  let latexRisks = 0;

  if (isPaperOcrRequired(paper)) {
    addExportQaIssue(issues, "error", "ocr-required", "这篇 PDF 仍处于 OCR required 状态，导出不会包含可阅读的正文分析。", {
      recommendation: "先完成 OCR 后重新解析，再导出。",
    });
  }

  if (!readingParagraphs.length) {
    addExportQaIssue(issues, "error", "no-reading-paragraphs", "没有可导出的正文段落。", {
      recommendation: "检查分段结果，或先完成 OCR/重新 AI 分段。",
    });
  }

  for (const paragraph of readingParagraphs) {
    const paragraphContext = getExportQaParagraphContext(paragraph);
    if (!hasCompleteParagraphAnalysis(paragraph)) {
      unfinishedParagraphs += 1;
      addExportQaIssue(issues, "warn", "unfinished-paragraph", "段落缺少翻译或讲解，导出时会显示“尚未生成”。", paragraphContext);
    }

    if (paragraph.analysisStatus === "error" || paragraph.analysisError) {
      analysisErrors += 1;
      addExportQaIssue(issues, "error", "analysis-error", paragraph.analysisError || "段落分析失败。", paragraphContext);
    }

    if (paragraph.weakAnalysis) {
      weakAnalysisParagraphs += 1;
      if (paragraph.analysisRepairStatus === "weak-after-repair") {
        weakAfterRepairParagraphs += 1;
      }
      addExportQaIssue(issues, "warn", "weak-analysis", formatWeakAnalysisExportMessage(paragraph), {
        ...paragraphContext,
        repairStatus: paragraph.analysisRepairStatus || "",
        reasons: Array.isArray(paragraph.analysisWeakReasons) ? paragraph.analysisWeakReasons.slice(0, 5) : [],
      });
    }

    const verificationIssues = Array.isArray(paragraph.analysisVerification?.issues)
      ? paragraph.analysisVerification.issues
      : [];
    const terminologyIssues = verificationIssues.filter((issue) => issue?.code === "terminology-drift");
    const missingReferenceIssues = verificationIssues.filter((issue) => /^missing-(?:figure|table|equation)-reference$/.test(issue?.code || ""));
    terminologyRisks += terminologyIssues.length;
    missingReferenceAnalysisRisks += missingReferenceIssues.length;

    for (const risk of findLatexExportRisks(`${paragraph.translation || ""}\n${paragraph.explanation || ""}`)) {
      latexRisks += 1;
      addExportQaIssue(issues, "warn", "latex-risk", risk, paragraphContext);
    }

    for (const artifactId of Array.isArray(paragraph.relatedArtifactIds) ? paragraph.relatedArtifactIds : []) {
      const artifact = artifactsById.get(artifactId);
      if (!artifact) {
        const hiddenArtifact = allArtifactsById.get(artifactId);
        if (hiddenArtifact && !isVisiblePaperArtifact(hiddenArtifact)) {
          continue;
        }

        brokenArtifactRefs += 1;
        addExportQaIssue(issues, "error", "broken-artifact-reference", "段落引用的图表不存在，导出会丢失该图表链接。", {
          ...paragraphContext,
          artifactId,
        });
        continue;
      }

      checkedArtifactIds.add(artifact.id);
      auditExportArtifactForQa(artifact, issues, {
        artifactCropIssueIds,
        lowConfidenceCropIds,
        missingAssetIds,
        artifactAssetExists,
      }, paragraphContext);
    }
  }

  for (const artifact of artifacts) {
    if (!isExportRelevantArtifact(artifact, { isVisiblePaperArtifact })) {
      continue;
    }

    checkedArtifactIds.add(artifact.id);
    auditExportArtifactForQa(artifact, issues, {
      artifactCropIssueIds,
      lowConfidenceCropIds,
      missingAssetIds,
      artifactAssetExists,
    });
  }

  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warn").length;
  return {
    paperId: paper.id,
    title: paper.title || paper.filename || paper.id,
    status: errorCount > 0 ? "error" : warningCount > 0 ? "warn" : "ok",
    checkedAt: now().toISOString(),
    summary: {
      readingParagraphs: readingParagraphs.length,
      unfinishedParagraphs,
      analysisErrors,
      weakAnalysisParagraphs,
      weakAfterRepairParagraphs,
      terminologyRisks,
      missingReferenceAnalysisRisks,
      brokenArtifactRefs,
      checkedArtifacts: checkedArtifactIds.size,
      missingArtifactCrops: artifactCropIssueIds.size,
      lowConfidenceCrops: lowConfidenceCropIds.size,
      missingAssetFiles: missingAssetIds.size,
      latexRisks,
      issueCount: issues.length,
      errorCount,
      warningCount,
    },
    issues: issues.slice(0, 200),
  };
}

export function findLatexExportRisks(text) {
  const value = String(text || "");
  if (!value.trim()) {
    return [];
  }

  const risks = [];
  const dollarCount = countUnescapedToken(value, "$");
  if (dollarCount % 2 === 1) {
    risks.push("可能存在未闭合的 `$` LaTeX 分隔符。");
  }

  if (countLiteralToken(value, "\\[") !== countLiteralToken(value, "\\]")) {
    risks.push("可能存在不成对的 `\\[` / `\\]` 公式分隔符。");
  }

  if (countLiteralToken(value, "\\(") !== countLiteralToken(value, "\\)")) {
    risks.push("可能存在不成对的 `\\(` / `\\)` 行内公式分隔符。");
  }

  const begins = [...value.matchAll(/\\begin\{([^}]+)\}/g)].map((match) => match[1]);
  const ends = [...value.matchAll(/\\end\{([^}]+)\}/g)].map((match) => match[1]);
  if (begins.length !== ends.length || begins.some((name, index) => name !== ends[index])) {
    risks.push("可能存在不成对的 `\\begin{...}` / `\\end{...}` 环境。");
  }

  return risks;
}

export function hasExportableArtifactCrop(artifact) {
  const crop = artifact?.crop || {};
  const x = Number(crop.x);
  const y = Number(crop.y);
  const width = Number(crop.width);
  const height = Number(crop.height);
  const pageWidth = Number(crop.pageWidth || artifact?.pageWidth);
  const pageHeight = Number(crop.pageHeight || artifact?.pageHeight);
  return Boolean(artifact?.imagePath) &&
    [x, y, width, height, pageWidth, pageHeight].every(Number.isFinite) &&
    width > 0 && height > 0 && pageWidth > 0 && pageHeight > 0;
}

export function isExportRelevantArtifact(artifact, options = {}) {
  const isVisiblePaperArtifact = options.isVisiblePaperArtifact || defaultIsVisiblePaperArtifact;
  if (!isVisiblePaperArtifact(artifact)) {
    return false;
  }

  const type = String(artifact?.type || "");
  const visualType = String(artifact?.visualType || "");
  return ["caption", "formula", "code"].includes(type) ||
    ["figure", "table", "formula", "code"].includes(visualType);
}

function auditExportArtifactForQa(artifact, issues, trackers, paragraphContext = {}) {
  const context = {
    ...paragraphContext,
    artifactId: artifact.id,
    artifactType: artifact.type || "",
    artifactVisualType: artifact.visualType || "",
    artifactLabel: artifact.label || artifact.visualType || artifact.type || "",
    pageNumber: paragraphContext.pageNumber || artifact.pageNumber || null,
  };
  const formulaFields = artifact.type === "formula" ? buildFormulaRenderFields(artifact) : null;

  if (!hasExportableArtifactCrop(artifact)) {
    if (!trackers.artifactCropIssueIds.has(artifact.id)) {
      trackers.artifactCropIssueIds.add(artifact.id);
      addExportQaIssue(issues, "warn", "missing-artifact-crop", "图表缺少可导出的裁剪区域，Markdown/Word 中可能没有图片预览。", context);
    }
    return;
  }

  if (!trackers.artifactAssetExists(artifact)) {
    if (!trackers.missingAssetIds.has(artifact.id)) {
      trackers.missingAssetIds.add(artifact.id);
      addExportQaIssue(issues, "error", "missing-artifact-asset", "图表原始页面图片文件不存在，裁剪预览无法生成。", context);
    }
  }

  const quality = artifact.cropQuality || {};
  if ((quality.confidence === "low" || quality.oversized) && !trackers.lowConfidenceCropIds.has(artifact.id)) {
    trackers.lowConfidenceCropIds.add(artifact.id);
    addExportQaIssue(issues, "warn", "low-confidence-crop", "图表裁剪置信度偏低或区域过大，导出图片可能不够精细。", {
      ...context,
      cropConfidence: quality.confidence || "unknown",
      oversized: Boolean(quality.oversized),
    });
  }

  if (formulaFields?.renderMode === FORMULA_RENDER_MODE_IMAGE) {
    addExportQaIssue(issues, "info", "formula-image-only", "该公式没有可信 LaTeX 文本，导出会以图片裁剪为主。", {
      ...context,
      latexConfidence: formulaFields.latexConfidence,
      renderMode: formulaFields.renderMode,
    });
  } else if (formulaFields?.renderMode === FORMULA_RENDER_MODE_IMAGE_LATEX) {
    const message = formulaFields.latexConfidence === "low"
      ? "该公式 LaTeX 置信度偏低，导出会保留图片，并把识别文本作为核对信息。"
      : "该公式来自自动 PDF 文本提取，导出会以图片裁剪为主，并把识别文本作为核对信息。";
    addExportQaIssue(issues, "warn", "low-confidence-formula-latex", message, {
      ...context,
      latexConfidence: formulaFields.latexConfidence,
      renderMode: formulaFields.renderMode,
      formulaLatexRisk: formulaFields.formulaLatexRisk || "",
    });
  }

  for (const risk of findLatexExportRisks(artifact.text || "")) {
    if (formulaFields?.renderMode === FORMULA_RENDER_MODE_IMAGE ||
      formulaFields?.renderMode === FORMULA_RENDER_MODE_IMAGE_LATEX) {
      continue;
    }
    addExportQaIssue(issues, "warn", "artifact-latex-risk", risk, context);
  }
}

function getExportQaParagraphContext(paragraph) {
  return {
    paragraphId: paragraph.id,
    paragraphOrder: Number(paragraph.order || 0) + 1,
    pageNumber: paragraph.pageNumber || null,
    sectionId: paragraph.sectionId || "",
  };
}

function formatWeakAnalysisExportMessage(paragraph) {
  const reasons = Array.isArray(paragraph.analysisWeakReasons)
    ? paragraph.analysisWeakReasons.filter(Boolean).slice(0, 2)
    : [];
  const suffix = reasons.length ? `原因：${reasons.join("；")}` : "建议先补跑弱分析。";
  if (paragraph.analysisRepairStatus === "weak-after-repair") {
    return `该段补跑后仍被标记为弱分析，导出前需要复查。${suffix}`;
  }
  return `该段被标记为弱分析，导出内容可能过短、漏引用或术语不一致。${suffix}`;
}

function addExportQaIssue(issues, severity, type, message, context = {}) {
  issues.push({
    severity,
    type,
    message,
    ...context,
  });
}

function hasCompleteParagraphAnalysis(paragraph) {
  return Boolean(String(paragraph.translation || "").trim()) &&
    Boolean(String(paragraph.explanation || "").trim());
}

function defaultIsReadingParagraphForPaper(_paper, paragraph) {
  return paragraph?.kind === "paragraph" && paragraph.analysisEligible !== false;
}

function defaultIsVisiblePaperArtifact(artifact) {
  return !artifact?.hidden;
}

function defaultIsPaperOcrRequired(paper) {
  return Boolean(paper?.ocr?.needed || paper?.status === "needs_ocr" || paper?.segmentationMode === "ocr-required");
}

function countLiteralToken(value, token) {
  if (!token) {
    return 0;
  }

  let count = 0;
  let start = 0;
  while (true) {
    const index = value.indexOf(token, start);
    if (index === -1) {
      return count;
    }
    count += 1;
    start = index + token.length;
  }
}

function countUnescapedToken(value, token) {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value.startsWith(token, index) && !isEscapedAt(value, index)) {
      count += 1;
      index += token.length - 1;
    }
  }
  return count;
}

function isEscapedAt(value, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}
