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
    wholePaper: buildWholePaperAnalysisMetrics(paper, readingParagraphs),
    export: buildExportMetrics(exportQa),
    ocr: buildOcrMetrics(paper, ocrRequired),
    provider: buildProviderMetrics(paper),
  };
  metrics.layout = buildLayoutDiagnosticsMetrics(paper, metrics);

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
      recoverableFilteredParagraphs: metrics.paragraphs.recoverableFiltered,
      recoverableResourceLinks: metrics.paragraphs.recoverableResourceLinks,
      recoverableFormulaLike: metrics.paragraphs.recoverableFormulaLike,
      recoverableVisualText: metrics.paragraphs.recoverableVisualText,
      visualIssueArtifacts: metrics.visual.issueArtifacts,
      formulaRiskCount: metrics.formulas.riskCount,
      deepPlanAvailable: metrics.wholePaper.deepPlanAvailable,
      sectionDigestCoveragePercent: metrics.wholePaper.sectionDigestCoveragePercent,
      sectionDraftCoveragePercent: metrics.wholePaper.sectionDraftCoveragePercent,
      weakAnalysisParagraphs: metrics.wholePaper.weakAnalysisParagraphs,
      terminologyRisks: metrics.wholePaper.terminologyDriftIssues,
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
    fallbackReason: snapshot.fallbackReason || "",
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
  const recoverable = paragraphs.filter((paragraph) => paragraph?.recoverableFilteredBlock);
  const recoverableReasonCounts = countRecoverableReasons(recoverable);
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
    recoverableFiltered: recoverable.length,
    recoverableResourceLinks: countRecoverableReasonBucket(recoverableReasonCounts, ["resource-link"]),
    recoverableFormulaLike: countRecoverableReasonBucket(recoverableReasonCounts, ["formula", "math", "equation"]),
    recoverableVisualText: countRecoverableReasonBucket(recoverableReasonCounts, ["caption", "figure", "table", "code", "visual-text"]),
    recoverableReasonCounts,
    recoverableSamples: recoverable.slice(0, 8).map(formatRecoverableSample),
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

function buildWholePaperAnalysisMetrics(paper, readingParagraphs) {
  const deepPlan = paper?.deepPaperPlan && typeof paper.deepPaperPlan === "object" ? paper.deepPaperPlan : null;
  const sectionDigests = Array.isArray(paper?.sectionDigests) ? paper.sectionDigests : [];
  const sectionDrafts = Array.isArray(paper?.sectionDrafts) ? paper.sectionDrafts : [];
  const sectionDigestIds = new Set(sectionDigests.map((digest) => digest.id || digest.sectionId).filter(Boolean));
  const sectionDraftIds = new Set(sectionDrafts.map((draft) => draft.id || draft.sectionId || draft.sectionDigestId).filter(Boolean));
  const withDigest = readingParagraphs.filter((paragraph) =>
    paragraph.sectionDigestId && sectionDigestIds.has(paragraph.sectionDigestId));
  const withDraft = readingParagraphs.filter((paragraph) =>
    paragraph.sectionDraftId && sectionDraftIds.has(paragraph.sectionDraftId));
  const verificationIssues = readingParagraphs.flatMap((paragraph) =>
    Array.isArray(paragraph.analysisVerification?.issues)
      ? paragraph.analysisVerification.issues.map((issue) => ({
          paragraphId: paragraph.id,
          code: issue.code || "",
          severity: issue.severity || "warn",
          message: issue.message || "",
        }))
      : []);
  const weakParagraphs = readingParagraphs.filter((paragraph) => paragraph.weakAnalysis);
  const repaired = readingParagraphs.filter((paragraph) => paragraph.analysisRepairStatus === "repaired");
  const weakAfterRepair = readingParagraphs.filter((paragraph) => paragraph.analysisRepairStatus === "weak-after-repair");
  const terminologyDriftIssues = verificationIssues.filter((issue) => issue.code === "terminology-drift").length;
  const missingReferenceIssues = verificationIssues.filter((issue) => /^missing-(?:figure|table|equation)-reference$/.test(issue.code)).length;
  const lowCoverageIssues = verificationIssues.filter((issue) => /^coverage-/.test(issue.code)).length;
  const sectionDigestCoveragePercent = readingParagraphs.length
    ? Math.round((withDigest.length / readingParagraphs.length) * 100)
    : 0;
  const sectionDraftCoveragePercent = readingParagraphs.length
    ? Math.round((withDraft.length / readingParagraphs.length) * 100)
    : 0;

  return {
    deepPlanAvailable: Boolean(deepPlan && deepPlan.status !== "missing"),
    deepPlanStatus: deepPlan?.status || "missing",
    deepPlanSource: deepPlan?.source || "",
    deepPlanFingerprint: deepPlan?.fingerprint || "",
    sectionDigests: sectionDigests.length,
    sectionDrafts: sectionDrafts.length,
    sectionDigestCoveragePercent,
    sectionDraftCoveragePercent,
    paragraphsWithSectionDigest: withDigest.length,
    paragraphsWithSectionDraft: withDraft.length,
    weakAnalysisParagraphs: weakParagraphs.length,
    repairedParagraphs: repaired.length,
    weakAfterRepairParagraphs: weakAfterRepair.length,
    verificationIssues: verificationIssues.length,
    terminologyDriftIssues,
    missingReferenceIssues,
    lowCoverageIssues,
    samples: weakParagraphs.slice(0, 6).map((paragraph) => ({
      paragraphId: paragraph.id || "",
      pageNumber: Number(paragraph.pageNumber || 0) || null,
      repairStatus: paragraph.analysisRepairStatus || "",
      reasons: normalizeStringList(paragraph.analysisWeakReasons).slice(0, 4),
      preview: truncatePipelineText(paragraph.sourceText || "", 160),
    })),
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

function buildLayoutDiagnosticsMetrics(paper, metrics) {
  const visual = paper.visualAnalysis || {};
  const aiLayout = paper.aiLayout || paper.aiLayoutResult || paper.layoutAnalysis || null;
  const aiDiagnostics = aiLayout?.diagnostics || paper.aiLayoutDiagnostics || {};
  const aiWarnings = normalizeStringList(aiDiagnostics.warnings || aiLayout?.warnings || []);
  const visualProvider = metrics.provider?.visualProvider || visual.provider || "heuristic";
  const visualStatus = metrics.provider?.visualStatus || visual.status || "off";
  const visualRegions = Number(metrics.provider?.visualRegions || visual.regions || 0);
  const visualErrors = Number(metrics.provider?.visualErrors || visual.errors || 0);
  const localVisualRegions = sumLocalVisualRegions(paper);
  const fallbackReason = metrics.planning?.fallbackReason ||
    paper?.segmentationStages?.fallback?.reason ||
    paper?.structureMap?.fallbackReason ||
    "";
  const hasAiLayout = Boolean(aiLayout && typeof aiLayout === "object");
  const hasExternalVisual = visualProvider && visualProvider !== "heuristic";
  const mode = hasAiLayout
    ? "ai-layout"
    : hasExternalVisual ? "hybrid" : fallbackReason || metrics.planning?.partialFallback ? "fallback" : "local";
  const status = resolveLayoutDiagnosticsStatus({
    aiStatus: aiLayout?.status || aiDiagnostics.status,
    aiWarnings,
    visualStatus,
    visualErrors,
    fallbackReason,
    partialFallback: metrics.planning?.partialFallback,
  });

  return {
    mode,
    status,
    provider: hasAiLayout
      ? aiLayout.provider || aiDiagnostics.provider || "ai-layout"
      : visualProvider || "heuristic",
    source: aiLayout?.source || visual.source || "",
    message: aiDiagnostics.message || visual.message || "",
    pageCount: Number(aiDiagnostics.pageCount || aiLayout?.pages?.length || metrics.paper?.pageCount || 0),
    sectionCount: Number(aiDiagnostics.sectionCount || aiLayout?.sections?.length || metrics.segmentation?.structureSections || 0),
    regionCount: Number(aiDiagnostics.regionCount || aiLayout?.regions?.length || visualRegions || localVisualRegions || 0),
    paragraphCount: Number(aiDiagnostics.paragraphCount || aiLayout?.paragraphs?.length || metrics.paragraphs?.reading || 0),
    visualRegionCount: Number(aiDiagnostics.visualRegionCount || aiLayout?.visualRegions?.length || visualRegions || localVisualRegions || 0),
    warningCount: aiWarnings.length,
    warningSamples: aiWarnings.slice(0, 3),
    fallbackReason: truncatePipelineText(fallbackReason, 180),
    externalVisualRegions: visualRegions,
    externalVisualErrors: visualErrors,
    durationMs: Number(visual.durationMs || 0),
  };
}

function sumLocalVisualRegions(paper = {}) {
  return (Array.isArray(paper.extractionPages) ? paper.extractionPages : []).reduce((total, page) =>
    total + (Array.isArray(page?.visualRegions) ? page.visualRegions.length : 0), 0);
}

function resolveLayoutDiagnosticsStatus({ aiStatus, aiWarnings, visualStatus, visualErrors, fallbackReason, partialFallback }) {
  if (aiStatus === "error" || visualStatus === "error") {
    return "error";
  }
  if (aiStatus === "warn" || visualStatus === "warn" || visualErrors > 0 || aiWarnings.length || fallbackReason || partialFallback) {
    return "warn";
  }
  return "ok";
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

  if (metrics.paragraphs.recoverableFiltered > 0) {
    const details = [
      metrics.paragraphs.recoverableResourceLinks ? `链接 ${metrics.paragraphs.recoverableResourceLinks}` : "",
      metrics.paragraphs.recoverableFormulaLike ? `公式样文本 ${metrics.paragraphs.recoverableFormulaLike}` : "",
      metrics.paragraphs.recoverableVisualText ? `图表/代码候选 ${metrics.paragraphs.recoverableVisualText}` : "",
    ].filter(Boolean).join("，");
    addCheck(
      checks,
      "info",
      "segmentation",
      "recoverable-filtered-content",
      "有已过滤但可恢复内容",
      `${metrics.paragraphs.recoverableFiltered} 个块未进入自动讲解队列，但已作为隐藏段落保留${details ? `：${details}` : "。"}`,
      "打开分段调试或显示隐藏段落，确认关键公式、网址、图注没有被误过滤。",
    );
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

  if (metrics.wholePaper.deepPlanAvailable) {
    if (metrics.wholePaper.sectionDigests && metrics.wholePaper.sectionDigestCoveragePercent < 85 && metrics.paragraphs.reading >= 8) {
      addCheck(checks, "warn", "analysis", "section-digest-low-coverage", "章节上下文覆盖不足", `只有 ${metrics.wholePaper.sectionDigestCoveragePercent}% 正文段落挂上 section digest，部分讲解可能缺少整篇上下文。`, "重新运行精读分析或刷新分段规划，让段落重新绑定章节草稿。");
    }
    if (metrics.wholePaper.sectionDrafts && metrics.wholePaper.sectionDraftCoveragePercent < 85 && metrics.paragraphs.reading >= 8) {
      addCheck(checks, "info", "analysis", "section-draft-low-coverage", "整节草稿覆盖不足", `只有 ${metrics.wholePaper.sectionDraftCoveragePercent}% 正文段落挂上 context-only section draft，后续讲解可能少一层整节判断。`, "重新运行精读分析，让段落重新绑定整节草稿上下文。");
    }
  } else if (metrics.paragraphs.reading >= 8 && metrics.analysis.complete > 0) {
    addCheck(checks, "info", "analysis", "deep-plan-missing", "未启用整篇精读蓝图", "当前讲解没有可审查的 Deep Paper Plan，术语一致性和章节作用说明会弱一些。", "使用精读模式重新分析，生成全文蓝图和章节草稿。");
  }

  if (metrics.wholePaper.weakAnalysisParagraphs > 0) {
    addCheck(checks, "warn", "analysis", "weak-analysis", "存在弱分析段落", `${metrics.wholePaper.weakAnalysisParagraphs} 段被 verifier 标记为翻译/讲解质量偏弱，其中修复后仍弱 ${metrics.wholePaper.weakAfterRepairParagraphs} 段。`, "点击补跑未完成，或只修弱段，优先处理 verifier 给出的原因。");
  }

  if (metrics.wholePaper.terminologyDriftIssues > 0) {
    addCheck(checks, "warn", "analysis", "terminology-drift", "术语一致性存在风险", `${metrics.wholePaper.terminologyDriftIssues} 个 verifier 问题指向术语漂移。`, "只修弱段，确保翻译和讲解沿用 Deep Paper Plan / Paper Memory 中的术语表。");
  }

  if (metrics.wholePaper.missingReferenceIssues > 0) {
    addCheck(checks, "warn", "analysis", "analysis-reference-missing", "讲解可能漏掉图表/公式引用", `${metrics.wholePaper.missingReferenceIssues} 个 verifier 问题显示 Figure/Table/Equation 没有被保留或解释。`, "只修弱段，重点补回图表、表格和公式关系。");
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

function countRecoverableReasons(paragraphs = []) {
  const counts = {};
  for (const paragraph of paragraphs) {
    const reason = normalizeRecoverableReason(paragraph?.recoverableFilteredBlock?.reason || "filtered");
    counts[reason] = Number(counts[reason] || 0) + 1;
  }
  return counts;
}

function countRecoverableReasonBucket(counts = {}, needles = []) {
  return Object.entries(counts).reduce((total, [reason, count]) =>
    needles.some((needle) => reason.includes(needle))
      ? total + Number(count || 0)
      : total, 0);
}

function formatRecoverableSample(paragraph) {
  return {
    paragraphId: paragraph?.id || "",
    pageNumber: Number(paragraph?.pageNumber || 0) || null,
    reason: normalizeRecoverableReason(paragraph?.recoverableFilteredBlock?.reason || "filtered"),
    restorable: paragraph?.kind === "paragraph" && (paragraph.hidden || paragraph.analysisEligible === false),
    preview: truncatePipelineText(paragraph?.sourceText || "", 180),
  };
}

function normalizeRecoverableReason(reason) {
  return String(reason || "filtered").trim().toLowerCase() || "filtered";
}

function normalizeStringList(value) {
  return (Array.isArray(value) ? value : value ? [value] : [])
    .flatMap((item) => typeof item === "string"
      ? item.split(/[;；\n]/)
      : item && typeof item === "object"
        ? [item.message || item.text || item.label || item.title || ""]
        : [])
    .map(normalizeSpaces)
    .filter(Boolean)
    .filter((item, index, list) => list.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index);
}

function truncatePipelineText(text, maxLength) {
  const clean = normalizeSpaces(text);
  if (clean.length <= maxLength) {
    return clean;
  }
  return `${clean.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function normalizeSpaces(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}
