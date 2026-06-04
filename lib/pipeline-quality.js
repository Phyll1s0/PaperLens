import { findLatexExportRisks } from "./export-qa.js";
import {
  buildFormulaRenderFields,
} from "./formula-render-quality.js";
import { buildSegmentationPlanningSnapshot } from "./segmentation-planning-snapshot.js";

export const PIPELINE_QUALITY_VERSION = 1;

const SEVERITY_SCORE_PENALTY = {
  error: 18,
  warn: 8,
  info: 2,
};

export function buildPaperPipelineQualityReport(paper = {}, options = {}) {
  const now = options.now || (() => new Date());
  const generatedAt = now().toISOString();
  const paragraphs = Array.isArray(paper.paragraphs) ? paper.paragraphs : [];
  const readingParagraphs = paragraphs.filter((paragraph) =>
    options.isReadingParagraphForPaper
      ? options.isReadingParagraphForPaper(paper, paragraph)
      : defaultIsReadingParagraph(paragraph));
  const extractionPages = Array.isArray(paper.extractionPages) ? paper.extractionPages : [];
  const pageArtifacts = Array.isArray(paper.pageArtifacts) ? paper.pageArtifacts : [];
  const visualQa = options.visualQa || paper.visualQa || buildFallbackVisualQa(pageArtifacts);
  const exportQa = options.exportQa || null;
  const segmentationDebug = options.segmentationDebug || null;
  const ocrRequired = options.isPaperOcrRequired
    ? options.isPaperOcrRequired(paper)
    : Boolean(paper?.ocr?.needed || paper?.status === "needs_ocr" || paper?.segmentationMode === "ocr-required");
  const planningSnapshot = options.planningSnapshot ||
    paper.segmentationPlanningSnapshot ||
    buildSegmentationPlanningSnapshot(paper, { now });

  const metrics = {
    paper: buildPaperMetrics(paper, extractionPages),
    planning: buildPlanningMetrics(planningSnapshot),
    segmentation: buildSegmentationMetrics(paper, segmentationDebug, readingParagraphs),
    paragraphs: buildParagraphMetrics(readingParagraphs, paragraphs),
    visual: buildVisualMetrics(pageArtifacts, visualQa),
    formulas: buildFormulaMetrics(pageArtifacts),
    analysis: buildAnalysisMetrics(readingParagraphs),
    export: buildExportMetrics(exportQa),
    ocr: buildOcrMetrics(paper, ocrRequired),
    provider: buildProviderMetrics(paper),
  };

  const checks = buildPipelineChecks(metrics);
  const severityCounts = countCheckSeverities(checks);
  const score = scoreChecks(checks);
  const status = severityCounts.error > 0
    ? "error"
    : severityCounts.warn > 0 ? "warn" : "ok";

  if (!checks.length) {
    checks.push({
      severity: "ok",
      category: "pipeline",
      code: "pipeline-ok",
      title: "处理链路可用",
      message: "当前没有聚合到明显的分段、视觉、公式或导出风险。",
      action: "可以继续阅读、追问或导出。",
    });
  }

  return {
    version: PIPELINE_QUALITY_VERSION,
    paperId: paper.id || "",
    title: paper.title || paper.filename || "",
    generatedAt,
    status,
    score,
    summary: {
      issueCount: checks.filter((check) => check.severity === "error" || check.severity === "warn").length,
      errorCount: severityCounts.error,
      warningCount: severityCounts.warn,
      infoCount: severityCounts.info,
      readingParagraphs: metrics.paragraphs.reading,
      analysisComplete: metrics.analysis.complete,
      analysisCompletionPercent: metrics.analysis.completionPercent,
      planningStatus: metrics.planning.status,
      planningReuseLevel: metrics.planning.reuseLevel,
      planningReusable: metrics.planning.reusable,
      planningFallback: metrics.planning.partialFallback,
      segmentationMode: metrics.segmentation.mode,
      segmentationIssueCategories: metrics.segmentation.issueCategories,
      visualIssueArtifacts: metrics.visual.issueArtifacts,
      formulaRiskCount: metrics.formulas.riskCount,
      exportStatus: metrics.export.status,
      ocrRequired: metrics.ocr.required,
    },
    metrics,
    planningSnapshot,
    checks,
    actions: checks
      .filter((check) => check.severity === "error" || check.severity === "warn")
      .slice(0, 6)
      .map((check) => ({
        category: check.category,
        code: check.code,
        title: check.title,
        action: check.action,
      })),
  };
}

function buildPaperMetrics(paper, extractionPages) {
  return {
    pageCount: Number(paper.pageCount || extractionPages.length || 0),
    extractionPages: extractionPages.length,
    updatedAt: paper.updatedAt || "",
    status: paper.status || "ready",
  };
}

function buildPlanningMetrics(snapshot = {}) {
  return {
    status: snapshot.status || "missing",
    reuseLevel: snapshot.reuseLevel || "weak",
    reusable: Boolean(snapshot.reusable),
    strategy: snapshot.strategy || "",
    strategyLabel: snapshot.strategyLabel || "",
    summary: snapshot.summary || "",
    planItems: Number(snapshot.counts?.planItems || 0),
    nonBodyZones: Number(snapshot.counts?.nonBodyZones || 0),
    memoryKeyTerms: Number(snapshot.counts?.paperMemoryKeyTerms || 0),
    memoryFormulas: Number(snapshot.counts?.paperMemoryFormulas || 0),
    memoryVisuals: Number(snapshot.counts?.paperMemoryVisuals || 0),
    memoryResources: Number(snapshot.counts?.paperMemoryResources || 0),
    memoryGuidance: Number(snapshot.counts?.paperMemoryGuidance || 0),
    structureReusable: Boolean(snapshot.flags?.structureReusable),
    memoryReusable: Boolean(snapshot.flags?.memoryReusable),
    partialFallback: Boolean(snapshot.flags?.partialFallback),
    paperMemoryReused: Boolean(snapshot.flags?.paperMemoryReused),
    structureSource: snapshot.sources?.structure || "",
    memorySource: snapshot.sources?.memory || "",
    generatedAt: snapshot.generatedAt || "",
  };
}

function buildSegmentationMetrics(paper, debug, readingParagraphs) {
  const issueCategories = Array.isArray(debug?.issueSummary?.categories)
    ? debug.issueSummary.categories.filter((category) => Number(category.count || 0) > 0)
    : [];
  const highIssueCategories = issueCategories.filter((category) => category.severity === "high").length;
  const mediumIssueCategories = issueCategories.filter((category) => category.severity === "medium").length;
  const structureSections = Array.isArray(paper?.structureMap?.sections)
    ? paper.structureMap.sections.length
    : Array.isArray(paper?.sections) ? paper.sections.length : 0;
  const planSteps = Array.isArray(paper?.structureMap?.segmentationPlan)
    ? paper.structureMap.segmentationPlan.length
    : Array.isArray(paper?.segmentationPlan) ? paper.segmentationPlan.length : 0;
  const fallback = paper?.segmentationStages?.fallback || null;
  const memory = paper?.paperMemory || null;

  return {
    mode: paper.segmentationMode || "heuristic",
    source: paper?.structureMap?.source || paper?.segmentationStages?.structure?.source || "",
    fallbackReason: fallback?.reason || "",
    fallbackStrategy: fallback?.strategy || "",
    structureSections,
    planSteps,
    issueCategories: issueCategories.length,
    issueEvidence: Number(debug?.issueSummary?.total || 0),
    highIssueCategories,
    mediumIssueCategories,
    paperMemoryAvailable: Boolean(memory && typeof memory === "object"),
    paperMemorySummary: Boolean(String(memory?.summary || memory?.mainThread || "").trim()),
    readableParagraphs: readingParagraphs.length,
  };
}

function buildParagraphMetrics(readingParagraphs, paragraphs) {
  const hidden = paragraphs.filter((paragraph) =>
    paragraph?.kind === "paragraph" &&
    (paragraph.analysisEligible === false || paragraph.manualSegmentationOverride === "noise"));
  const missingSourceBox = readingParagraphs.filter((paragraph) => !paragraph.sourceBox).length;
  const shortFragments = readingParagraphs.filter((paragraph) =>
    normalizeSpaces(paragraph.sourceText || "").length > 0 &&
    normalizeSpaces(paragraph.sourceText || "").length < 80).length;
  const crossPage = readingParagraphs.filter((paragraph) =>
    Number(paragraph.pageEndNumber || paragraph.pageNumber || 0) > Number(paragraph.pageNumber || 0)).length;
  const sourceBoxPercent = readingParagraphs.length
    ? Math.round(((readingParagraphs.length - missingSourceBox) / readingParagraphs.length) * 100)
    : 0;

  return {
    total: paragraphs.length,
    reading: readingParagraphs.length,
    hidden: hidden.length,
    missingSourceBox,
    sourceBoxPercent,
    shortFragments,
    crossPage,
  };
}

function buildVisualMetrics(pageArtifacts, visualQa) {
  const summary = visualQa?.summary || {};
  const visibleArtifacts = pageArtifacts.filter((artifact) => !artifact.hidden);
  return {
    totalArtifacts: Number(summary.totalArtifacts || pageArtifacts.length || 0),
    visibleArtifacts: Number(summary.visibleArtifacts || visibleArtifacts.length || 0),
    issueArtifacts: Number(summary.issueArtifacts || 0),
    missingCrops: Number(summary.missingCrops || 0),
    missingAssets: Number(summary.missingAssets || 0),
    lowConfidence: Number(summary.lowConfidence || 0),
    oversized: Number(summary.oversized || 0),
    typeConflicts: Number(summary.typeConflicts || 0),
    splitCandidates: Number(summary.splitCandidates || 0),
    manualArtifacts: Number(summary.manualArtifacts || 0),
    aiContextArtifacts: Number(summary.aiContextArtifacts || 0),
    figures: Number(summary.figures || 0),
    tables: Number(summary.tables || 0),
    codeBlocks: Number(summary.codeBlocks || 0),
  };
}

function buildFormulaMetrics(pageArtifacts) {
  const formulas = pageArtifacts.filter((artifact) => !artifact.hidden && artifact.type === "formula");
  const missingCrops = formulas.filter((artifact) => !hasUsableCrop(artifact)).length;
  const lowConfidence = formulas.filter((artifact) => artifact.cropQuality?.confidence === "low").length;
  const lowConfidenceLatex = formulas.filter((artifact) =>
    buildFormulaRenderFields(artifact).latexConfidence === "low").length;
  const roleNoise = formulas.filter((artifact) => artifact.formulaRole === "noise" || artifact.formulaRole === "equation-number").length;
  const latexRisks = formulas.flatMap((artifact) =>
    findLatexExportRisks(artifact.text || "").map((message) => ({
      artifactId: artifact.id,
      label: artifact.label || "",
      message,
    })));

  return {
    total: formulas.length,
    missingCrops,
    lowConfidence,
    lowConfidenceLatex,
    roleNoise,
    riskCount: latexRisks.length,
    latexRisks: latexRisks.slice(0, 8),
  };
}

function buildAnalysisMetrics(readingParagraphs) {
  const failed = readingParagraphs.filter((paragraph) =>
    paragraph.analysisStatus === "error" || Boolean(paragraph.analysisError)).length;
  const complete = readingParagraphs.filter(hasCompleteAnalysis).length;
  const pending = Math.max(0, readingParagraphs.length - complete - failed);
  const completionPercent = readingParagraphs.length
    ? Math.round((complete / readingParagraphs.length) * 100)
    : 0;

  return {
    total: readingParagraphs.length,
    complete,
    pending,
    failed,
    completionPercent,
  };
}

function buildExportMetrics(exportQa) {
  const summary = exportQa?.summary || {};
  return {
    available: Boolean(exportQa),
    status: exportQa?.status || "unknown",
    issues: Number(summary.issueCount || 0),
    errors: Number(summary.errorCount || 0),
    warnings: Number(summary.warningCount || 0),
    unfinishedParagraphs: Number(summary.unfinishedParagraphs || 0),
    brokenArtifactRefs: Number(summary.brokenArtifactRefs || 0),
    latexRisks: Number(summary.latexRisks || 0),
  };
}

function buildOcrMetrics(paper, required) {
  return {
    required: Boolean(required),
    status: paper?.ocr?.status || "",
    textCharacters: Number(paper?.ocr?.textCharacters || 0),
    qualityScore: Number.isFinite(Number(paper?.ocr?.qualityScore))
      ? Number(paper.ocr.qualityScore)
      : null,
    warnings: Array.isArray(paper?.ocr?.qualityWarnings) ? paper.ocr.qualityWarnings.length : 0,
  };
}

function buildProviderMetrics(paper) {
  const visual = paper.visualAnalysis || {};
  return {
    visualProvider: visual.provider || "heuristic",
    visualStatus: visual.status || "off",
    visualRegions: Number(visual.regions || 0),
    visualDurationMs: Number(visual.durationMs || 0),
    visualErrors: Number(visual.errors || 0),
    visualError: visual.error || visual.lastError || "",
  };
}

function buildPipelineChecks(metrics) {
  const checks = [];

  if (metrics.ocr.required) {
    addCheck(checks, "error", "ocr", "ocr-required", "PDF 需要 OCR", "当前 PDF 文本层不可读，分段和讲解会失真。", "先运行本机 OCR，再重新解析和分段。");
  }

  if (!metrics.paragraphs.reading && !metrics.ocr.required) {
    addCheck(checks, "error", "segmentation", "no-reading-paragraphs", "没有正文段落", "解析后没有得到可阅读段落，后续讲解无法启动。", "打开分段调试，检查 PDF 文本层、OCR 和 block 过滤。");
  }

  if (metrics.paragraphs.reading >= 8 && metrics.planning.status === "missing") {
    addCheck(checks, "warn", "planning", "planning-missing", "缺少分段规划快照", "当前论文没有可审查的结构地图和 Paper Memory 快照，重切段时很难判断全局边界。", "点击重分段+全跑，选择只重建规划快照。");
  } else if (metrics.paragraphs.reading >= 8 && metrics.planning.reuseLevel === "weak") {
    addCheck(checks, "warn", "planning", "planning-weak", "规划复用度较弱", "结构地图或 Paper Memory 不完整，复杂论文的跨页和非正文过滤可能不稳定。", "先只重建规划快照，再决定是否重切段。");
  }

  if (metrics.planning.partialFallback) {
    addCheck(checks, "warn", "planning", "planning-fallback", "规划存在局部兜底", "当前规划或分段过程中使用过本地兜底，相关页块可能需要人工复查。", "打开分段调试，优先检查兜底页块附近的段落。");
  }

  if (metrics.segmentation.mode !== "ai" && metrics.paragraphs.reading > 30) {
    addCheck(checks, "warn", "segmentation", "non-ai-segmentation", "当前不是 AI 分段", "论文段落较多但仍在使用本地版面/基础分段，复杂论文容易误拆。", "用精读模式重新 AI 分段，或先刷新结构地图。");
  }

  if (metrics.segmentation.highIssueCategories || metrics.segmentation.mediumIssueCategories >= 2) {
    addCheck(checks, "warn", "segmentation", "debug-issues", "分段调试发现高风险问题", `分段调试聚合到 ${metrics.segmentation.issueCategories} 类问题、${metrics.segmentation.issueEvidence} 条证据。`, "打开分段调试，从问题类型汇总定位作者噪声、图注、跨页或短碎片。");
  }

  if (metrics.paragraphs.reading >= 8 && metrics.paragraphs.sourceBoxPercent < 70) {
    addCheck(checks, "warn", "segmentation", "low-sourcebox-coverage", "段落定位覆盖不足", `只有 ${metrics.paragraphs.sourceBoxPercent}% 正文段落带 sourceBox，页图定位和跨页校验会变弱。`, "重建分段输入或检查 PDF block 坐标是否可用。");
  }

  if (metrics.paragraphs.reading >= 8 && metrics.paragraphs.shortFragments / metrics.paragraphs.reading > 0.22) {
    addCheck(checks, "warn", "segmentation", "many-short-fragments", "短碎片偏多", `${metrics.paragraphs.shortFragments}/${metrics.paragraphs.reading} 个正文段落很短，可能把作者、链接、图注或公式碎片当成正文。`, "在分段调试中筛短碎片，必要时用复用记忆重切段。");
  }

  if (metrics.visual.issueArtifacts > 0) {
    addCheck(checks, "warn", "visual", "visual-artifact-issues", "视觉材料需要复查", `视觉 QA 有 ${metrics.visual.issueArtifacts} 个待处理项，其中缺裁剪 ${metrics.visual.missingCrops}、低置信 ${metrics.visual.lowConfidence}、过大 ${metrics.visual.oversized}。`, "打开视觉 QA，优先处理缺裁剪、低置信和过大裁剪。");
  }

  if (metrics.formulas.total && (metrics.formulas.missingCrops || metrics.formulas.lowConfidence || metrics.formulas.lowConfidenceLatex || metrics.formulas.riskCount)) {
    addCheck(checks, "warn", "formula", "formula-risk", "公式识别不稳定", `公式 ${metrics.formulas.total} 个，缺裁剪 ${metrics.formulas.missingCrops}、裁剪低置信 ${metrics.formulas.lowConfidence}、LaTeX 低置信 ${metrics.formulas.lowConfidenceLatex}、LaTeX 风险 ${metrics.formulas.riskCount}。`, "低置信公式优先用图片裁剪确认，必要时手动修正公式文本。");
  }

  if (metrics.analysis.failed > 0) {
    addCheck(checks, "error", "analysis", "analysis-failed", "部分段落讲解失败", `${metrics.analysis.failed} 个正文段落分析失败。`, "点击补跑未完成，或在任务历史里只重跑失败项。");
  }

  if (metrics.analysis.total && metrics.analysis.completionPercent < 80 && metrics.analysis.pending > 0) {
    addCheck(checks, "warn", "analysis", "analysis-incomplete", "讲解尚未完成", `当前完成 ${metrics.analysis.completionPercent}%，还有 ${metrics.analysis.pending} 段待讲解。`, "继续自动讲解或补跑未完成。");
  }

  if (metrics.export.available && metrics.export.status === "error") {
    addCheck(checks, "error", "export", "export-errors", "导出会丢内容", `导出检查有 ${metrics.export.errors} 个错误，包括坏图表引用 ${metrics.export.brokenArtifactRefs}。`, "先运行导出检查并修复错误，再下载 Markdown/Word。");
  } else if (metrics.export.available && metrics.export.status === "warn") {
    addCheck(checks, "warn", "export", "export-warnings", "导出存在可优化项", `导出检查有 ${metrics.export.warnings} 个提示，LaTeX 风险 ${metrics.export.latexRisks}。`, "下载前查看导出检查，必要时修正图片或公式。");
  }

  if (metrics.provider.visualProvider !== "heuristic" && metrics.provider.visualStatus === "error") {
    addCheck(checks, "warn", "provider", "visual-provider-error", "视觉 Provider 未正常加载", metrics.provider.visualError || "外部视觉 Provider 返回错误。", "检查视觉 Provider 配置、命令输出 JSON，或切回 heuristic。");
  } else if (metrics.provider.visualProvider !== "heuristic" && metrics.provider.visualErrors > 0) {
    addCheck(checks, "warn", "provider", "visual-provider-partial", "视觉 Provider 部分失败", `外部视觉 Provider 有 ${metrics.provider.visualErrors} 次失败，已返回 ${metrics.provider.visualRegions} 个区域。`, "查看健康检查中的 visualAnalysis.lastError，并重建视觉结构。");
  }

  return checks;
}

function addCheck(checks, severity, category, code, title, message, action) {
  checks.push({ severity, category, code, title, message, action });
}

function countCheckSeverities(checks) {
  const counts = { error: 0, warn: 0, info: 0, ok: 0 };
  for (const check of checks) {
    counts[check.severity] = (counts[check.severity] || 0) + 1;
  }
  return counts;
}

function scoreChecks(checks) {
  const penalty = checks.reduce((total, check) =>
    total + (SEVERITY_SCORE_PENALTY[check.severity] || 0), 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

function buildFallbackVisualQa(pageArtifacts) {
  const visible = pageArtifacts.filter((artifact) => !artifact.hidden);
  const issueArtifacts = visible.filter((artifact) =>
    !hasUsableCrop(artifact) ||
    artifact.cropQuality?.confidence === "low" ||
    artifact.cropQuality?.oversized).length;
  return {
    summary: {
      totalArtifacts: pageArtifacts.length,
      visibleArtifacts: visible.length,
      issueArtifacts,
      missingCrops: visible.filter((artifact) => !hasUsableCrop(artifact)).length,
      lowConfidence: visible.filter((artifact) => artifact.cropQuality?.confidence === "low").length,
      oversized: visible.filter((artifact) => artifact.cropQuality?.oversized).length,
      figures: visible.filter((artifact) => artifact.type === "caption" && artifact.visualType !== "table").length,
      tables: visible.filter((artifact) => artifact.type === "caption" && artifact.visualType === "table").length,
      formulas: visible.filter((artifact) => artifact.type === "formula").length,
      codeBlocks: visible.filter((artifact) => artifact.type === "code").length,
    },
  };
}

function defaultIsReadingParagraph(paragraph) {
  return paragraph?.kind === "paragraph" && paragraph.analysisEligible !== false;
}

function hasCompleteAnalysis(paragraph) {
  return Boolean(String(paragraph.translation || "").trim()) &&
    Boolean(String(paragraph.explanation || "").trim());
}

function hasUsableCrop(artifact = {}) {
  const crop = artifact.crop || {};
  return Boolean(
    artifact.imagePath &&
    Number(crop.width || 0) > 0 &&
    Number(crop.height || 0) > 0 &&
    Number(crop.pageWidth || artifact.pageWidth || 0) > 0 &&
    Number(crop.pageHeight || artifact.pageHeight || 0) > 0
  );
}

function normalizeSpaces(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}
