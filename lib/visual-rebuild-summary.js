import {
  classifyFormulaTextRole,
} from "./artifact-classifier.js";
import {
  buildFormulaRenderFields,
} from "./formula-render-quality.js";

export function isVisiblePaperArtifact(artifact) {
  return !artifact?.hidden;
}

export const VISUAL_ARTIFACT_QA_VERSION = 1;

export function collectManualArtifactOverrides(artifacts = []) {
  const overrides = new Map();
  for (const artifact of artifacts) {
    if (
      !artifact?.id ||
      (!artifact.manualArtifactOverride &&
        !artifact.manualEditedAt &&
        !artifact.manualCropEditedAt &&
        !artifact.hidden)
    ) {
      continue;
    }
    overrides.set(artifact.id, {
      type: artifact.type,
      visualType: artifact.visualType,
      label: artifact.label,
      text: artifact.text,
      pageNumber: artifact.pageNumber,
      x: artifact.x,
      y: artifact.y,
      width: artifact.width,
      height: artifact.height,
      lineCount: artifact.lineCount,
      imagePath: artifact.imagePath,
      imageWidth: artifact.imageWidth,
      imageHeight: artifact.imageHeight,
      pageWidth: artifact.pageWidth,
      pageHeight: artifact.pageHeight,
      visualSource: artifact.visualSource,
      visualRegionId: artifact.visualRegionId,
      splitCandidate: artifact.splitCandidate,
      splitIndex: artifact.splitIndex,
      splitCount: artifact.splitCount,
      splitOrientation: artifact.splitOrientation,
      splitMethod: artifact.splitMethod,
      parentArtifactId: artifact.parentArtifactId,
      latexConfidence: artifact.latexConfidence,
      latexSource: artifact.latexSource,
      renderMode: artifact.renderMode,
      formulaLatexRisk: artifact.formulaLatexRisk,
      formulaRole: artifact.formulaRole,
      formulaRoleReason: artifact.formulaRoleReason,
      crop: artifact.crop,
      cropQuality: artifact.cropQuality,
      cropVersion: artifact.cropVersion,
      manualCropEditedAt: artifact.manualCropEditedAt,
      hidden: artifact.hidden,
      manualEditedAt: artifact.manualEditedAt,
      manualArtifactOverride: artifact.manualArtifactOverride,
    });
  }
  return overrides;
}

export function applyManualArtifactOverrides(artifacts = [], overrides = new Map()) {
  if (!overrides.size) {
    return artifacts;
  }
  const seen = new Set();
  const merged = artifacts.map((artifact) => {
    const override = overrides.get(artifact.id);
    if (!override) {
      return artifact;
    }
    seen.add(artifact.id);
    const next = {
      ...artifact,
      type: override.type || artifact.type,
      visualType: override.visualType || artifact.visualType,
      label: override.label || artifact.label,
      text: override.text || artifact.text,
      latexConfidence: override.latexConfidence || artifact.latexConfidence,
      latexSource: override.latexSource || artifact.latexSource,
      renderMode: override.renderMode || artifact.renderMode,
      formulaLatexRisk: override.formulaLatexRisk || artifact.formulaLatexRisk,
      formulaRole: override.formulaRole || artifact.formulaRole,
      formulaRoleReason: override.formulaRoleReason || artifact.formulaRoleReason,
      crop: override.crop || artifact.crop,
      cropQuality: override.cropQuality || artifact.cropQuality,
      cropVersion: override.cropVersion || artifact.cropVersion,
      manualCropEditedAt: override.manualCropEditedAt || artifact.manualCropEditedAt,
      hidden: Boolean(override.hidden),
      manualEditedAt: override.manualEditedAt || artifact.manualEditedAt,
      manualArtifactOverride: Boolean(override.manualArtifactOverride),
    };
    for (const key of ["latexConfidence", "latexSource", "renderMode", "formulaLatexRisk", "formulaRole", "formulaRoleReason"]) {
      if (next[key] === undefined) {
        delete next[key];
      }
    }
    return {
      ...next,
      ...buildFormulaRenderFields(next),
    };
  });

  for (const [id, override] of overrides) {
    if (seen.has(id)) {
      continue;
    }
    merged.push(buildOrphanManualArtifact(id, override));
  }

  return merged;
}

function buildOrphanManualArtifact(id, override = {}) {
  const artifact = {
    id,
    type: override.type,
    visualType: override.visualType,
    label: override.label,
    text: override.text,
    pageNumber: override.pageNumber,
    x: override.x,
    y: override.y,
    width: override.width,
    height: override.height,
    lineCount: override.lineCount,
    imagePath: override.imagePath,
    imageWidth: override.imageWidth,
    imageHeight: override.imageHeight,
    pageWidth: override.pageWidth,
    pageHeight: override.pageHeight,
    visualSource: override.visualSource,
    visualRegionId: override.visualRegionId,
    splitCandidate: override.splitCandidate,
    splitIndex: override.splitIndex,
    splitCount: override.splitCount,
    splitOrientation: override.splitOrientation,
    splitMethod: override.splitMethod,
    parentArtifactId: override.parentArtifactId,
    latexConfidence: override.latexConfidence,
    latexSource: override.latexSource,
    renderMode: override.renderMode,
    formulaLatexRisk: override.formulaLatexRisk,
    formulaRole: override.formulaRole,
    formulaRoleReason: override.formulaRoleReason,
    crop: override.crop,
    cropQuality: override.cropQuality,
    cropVersion: override.cropVersion,
    manualCropEditedAt: override.manualCropEditedAt,
    hidden: Boolean(override.hidden),
    manualEditedAt: override.manualEditedAt,
    manualArtifactOverride: Boolean(override.manualArtifactOverride),
    orphanedManualOverride: true,
  };

  for (const key of Object.keys(artifact)) {
    if (artifact[key] === undefined) {
      delete artifact[key];
    }
  }
  return {
    ...artifact,
    ...buildFormulaRenderFields(artifact),
  };
}

export function buildVisualRebuildStats(paper, pages = [], previousArtifactCount = 0) {
  const extractionPages = Array.isArray(paper?.extractionPages) ? paper.extractionPages : [];
  const pageImages = Array.isArray(paper?.pageImages) ? paper.pageImages : [];
  const sourcePages = pages.length ? pages : extractionPages;
  const visualRegions = sourcePages.flatMap((page) =>
    Array.isArray(page.visualRegions) ? page.visualRegions : [],
  );
  const allArtifacts = Array.isArray(paper?.pageArtifacts) ? paper.pageArtifacts : [];
  const artifacts = allArtifacts.filter(isVisiblePaperArtifact);
  const byType = {};
  for (const artifact of artifacts) {
    byType[artifact.type || "unknown"] = (byType[artifact.type || "unknown"] || 0) + 1;
  }

  return {
    pages: extractionPages.length,
    pagesWithImages: pageImages.filter((page) => page.imagePath).length,
    visualRegions: visualRegions.length,
    artifacts: artifacts.length,
    hiddenArtifacts: allArtifacts.length - artifacts.length,
    previousArtifacts: previousArtifactCount,
    captions: byType.caption || 0,
    formulas: byType.formula || 0,
    codeBlocks: byType.code || 0,
    figureText: byType["figure-text"] || 0,
    pixelRefined: artifacts.filter((artifact) => artifact.crop?.pixelRefined).length,
    lowConfidence: artifacts.filter((artifact) => artifact.cropQuality?.confidence === "low")
      .length,
    oversized: artifacts.filter((artifact) => artifact.cropQuality?.oversized).length,
    splitCandidates: artifacts.filter((artifact) => artifact.splitCandidate).length,
    modelGenerated: artifacts.filter((artifact) => artifact.modelGenerated).length,
    manualCrops: artifacts.filter(
      (artifact) =>
        artifact.manualCropEditedAt ||
        artifact.crop?.manuallyEdited ||
        artifact.cropQuality?.manual,
    ).length,
  };
}

export function buildVisualArtifactQaSummary(paper = {}, options = {}) {
  const artifactAssetExists = options.artifactAssetExists || (() => true);
  const artifacts = Array.isArray(paper?.pageArtifacts) ? paper.pageArtifacts : [];
  const items = artifacts
    .map((artifact) => buildVisualArtifactQaItem(artifact, { artifactAssetExists }))
    .filter(Boolean);
  const summary = buildVisualArtifactQaCounts(items);
  const categories = buildVisualArtifactQaCategories(summary);
  const warningIssueCount = Number(summary.missingCrops || 0) +
    Number(summary.missingAssets || 0) +
    Number(summary.lowConfidence || 0) +
    Number(summary.oversized || 0) +
    Number(summary.typeConflicts || 0) +
    Number(summary.lowConfidenceFormulas || 0);

  return {
    version: VISUAL_ARTIFACT_QA_VERSION,
    paperId: paper?.id || "",
    status: warningIssueCount ? "warn" : "ok",
    summary,
    categories,
    items: items.slice(0, Number(options.itemLimit || 240) || 240),
  };
}

function buildVisualArtifactQaItem(artifact, options = {}) {
  if (!artifact?.id) {
    return null;
  }

  const issueTypes = [];
  const infoTypes = [];
  if (!hasUsableArtifactCrop(artifact)) {
    issueTypes.push("missing-crop");
  } else if (!options.artifactAssetExists(artifact)) {
    issueTypes.push("missing-asset");
  }

  const quality = artifact.cropQuality || {};
  if (quality.confidence === "low") {
    issueTypes.push("low-confidence");
  }
  if (quality.oversized) {
    issueTypes.push("oversized");
  }
  if (hasArtifactTypeConflict(artifact)) {
    issueTypes.push("type-conflict");
  }
  const formulaFields = buildFormulaRenderFields(artifact);
  if (artifact.type === "formula" && formulaFields.renderMode === "image-latex") {
    issueTypes.push("low-confidence-formula");
  }
  if (isManualArtifact(artifact)) {
    infoTypes.push("manual");
  }
  if (artifact.splitCandidate) {
    infoTypes.push("split-candidate");
  }
  if (artifact.hidden) {
    infoTypes.push("hidden");
  }
  if (entersAiContext(artifact)) {
    infoTypes.push("ai-context");
  }

  const formulaRole = getArtifactFormulaRole(artifact);
  const crop = normalizeArtifactQaCrop(artifact);
  return {
    id: artifact.id,
    pageNumber: normalizeInteger(artifact.pageNumber, null),
    type: artifact.type || "unknown",
    visualType: artifact.visualType || artifact.type || "unknown",
    label: artifact.label || "",
    displayLabel: getVisualArtifactDisplayLabel(artifact),
    textPreview: truncateQaText(artifact.text || ""),
    formulaRole: formulaFields.formulaRole || formulaRole?.role || "",
    formulaRoleReason: formulaFields.formulaRoleReason || formulaRole?.reason || "",
    latexConfidence: formulaFields.latexConfidence || "",
    latexSource: formulaFields.latexSource || "",
    renderMode: formulaFields.renderMode || "",
    formulaLatexRisk: formulaFields.formulaLatexRisk || "",
    hidden: Boolean(artifact.hidden),
    splitCandidate: Boolean(artifact.splitCandidate),
    parentArtifactId: artifact.parentArtifactId || "",
    splitIndex: normalizeInteger(artifact.splitIndex, null),
    splitCount: normalizeInteger(artifact.splitCount, null),
    splitOrientation: artifact.splitOrientation || "",
    manual: isManualArtifact(artifact),
    entersAiContext: entersAiContext(artifact),
    hasCrop: Boolean(crop),
    crop,
    cropQuality: normalizeArtifactQaQuality(quality),
    issueTypes,
    infoTypes,
    status: issueTypes.length ? "warn" : "ok",
  };
}

function getArtifactFormulaRole(artifact = {}) {
  if (artifact.formulaRole) {
    return {
      role: artifact.formulaRole,
      reason: artifact.formulaRoleReason || "stored",
    };
  }
  if (artifact.type !== "formula") {
    return null;
  }
  return classifyFormulaTextRole(artifact.text || "", artifact);
}

function buildVisualArtifactQaCounts(items) {
  const summary = {
    totalArtifacts: items.length,
    visibleArtifacts: 0,
    hiddenArtifacts: 0,
    aiContextArtifacts: 0,
    manualArtifacts: 0,
    splitCandidates: 0,
    missingCrops: 0,
    missingAssets: 0,
    lowConfidence: 0,
    oversized: 0,
    typeConflicts: 0,
    lowConfidenceFormulas: 0,
    issueArtifacts: 0,
    figures: 0,
    tables: 0,
    formulas: 0,
    codeBlocks: 0,
    figureText: 0,
  };

  for (const item of items) {
    if (item.hidden) {
      summary.hiddenArtifacts += 1;
    } else {
      summary.visibleArtifacts += 1;
    }
    if (item.entersAiContext) {
      summary.aiContextArtifacts += 1;
    }
    if (item.manual) {
      summary.manualArtifacts += 1;
    }
    if (item.splitCandidate) {
      summary.splitCandidates += 1;
    }
    if (item.issueTypes.length) {
      summary.issueArtifacts += 1;
    }
    if (item.issueTypes.includes("missing-crop")) {
      summary.missingCrops += 1;
    }
    if (item.issueTypes.includes("missing-asset")) {
      summary.missingAssets += 1;
    }
    if (item.issueTypes.includes("low-confidence")) {
      summary.lowConfidence += 1;
    }
    if (item.issueTypes.includes("oversized")) {
      summary.oversized += 1;
    }
    if (item.issueTypes.includes("type-conflict")) {
      summary.typeConflicts += 1;
    }
    if (item.issueTypes.includes("low-confidence-formula")) {
      summary.lowConfidenceFormulas += 1;
    }
    if (item.type === "caption" && item.visualType === "table") {
      summary.tables += 1;
    } else if (item.type === "caption") {
      summary.figures += 1;
    } else if (item.type === "formula") {
      summary.formulas += 1;
    } else if (item.type === "code") {
      summary.codeBlocks += 1;
    } else if (item.type === "figure-text") {
      summary.figureText += 1;
    }
  }

  return summary;
}

function buildVisualArtifactQaCategories(summary) {
  const categories = [
    createVisualQaCategory("all", "全部", summary.totalArtifacts, "info", "查看所有视觉材料。"),
    createVisualQaCategory("issues", "待处理", summary.issueArtifacts, "warn", "优先检查缺裁剪、低置信、过大和类型冲突。"),
    createVisualQaCategory("missing-crop", "缺裁剪", summary.missingCrops, "warn", "需要重建视觉结构或手动补裁剪。"),
    createVisualQaCategory("missing-asset", "页图缺失", summary.missingAssets, "error", "原始页图文件缺失，裁剪预览无法生成。"),
    createVisualQaCategory("low-confidence", "低置信", summary.lowConfidence, "warn", "裁剪可能不够精确，建议放大检查。"),
    createVisualQaCategory("oversized", "过大", summary.oversized, "warn", "裁剪包含过多周边内容，建议手动收紧。"),
    createVisualQaCategory("type-conflict", "类型冲突", summary.typeConflicts, "warn", "图/表/公式/代码类型和标签可能不一致。"),
    createVisualQaCategory("low-confidence-formula", "公式待核对", summary.lowConfidenceFormulas, "warn", "这些公式默认以图片为主，识别文本只作为核对。"),
    createVisualQaCategory("formula", "公式", summary.formulas, "info", "直接检查独立公式块和公式角色。"),
    createVisualQaCategory("figure-text", "图中文字", summary.figureText, "info", "这些通常是图内文字，可检查是否需要隐藏或改成图表说明。"),
    createVisualQaCategory("split-candidate", "拆分候选", summary.splitCandidates, "info", "由大图表自动切出的子区域，建议放大确认后保留或隐藏。"),
    createVisualQaCategory("manual", "人工修正", summary.manualArtifacts, "info", "这些材料已有人工类型、文本或裁剪修正。"),
    createVisualQaCategory("hidden", "隐藏", summary.hiddenArtifacts, "info", "这些材料不会进入导出和 AI 上下文。"),
    createVisualQaCategory("ai-context", "进上下文", summary.aiContextArtifacts, "info", "这些材料会作为图表/公式/代码上下文提供给 AI。"),
  ];

  return categories.filter((category) => category.type === "all" || category.type === "issues" || category.count > 0);
}

function createVisualQaCategory(type, label, count, severity, suggestion) {
  return {
    type,
    label,
    count: Number(count || 0),
    severity,
    suggestion,
  };
}

function hasUsableArtifactCrop(artifact) {
  const crop = artifact?.crop || {};
  return Boolean(
    artifact?.imagePath &&
      positiveNumber(crop.x, true) &&
      positiveNumber(crop.y, true) &&
      positiveNumber(crop.width) &&
      positiveNumber(crop.height) &&
      positiveNumber(crop.pageWidth || artifact.pageWidth) &&
      positiveNumber(crop.pageHeight || artifact.pageHeight)
  );
}

function hasArtifactTypeConflict(artifact = {}) {
  const type = String(artifact.type || "").trim();
  const visualType = String(artifact.visualType || "").trim();
  const label = String(artifact.label || artifact.text || "").trim();
  if (!["caption", "formula", "code", "figure-text"].includes(type)) {
    return true;
  }
  if (type === "caption") {
    if (visualType && !["figure", "table"].includes(visualType)) {
      return true;
    }
    if (/^table\b/i.test(label) && visualType && visualType !== "table") {
      return true;
    }
    if (/^(?:fig(?:ure)?\.?)\b/i.test(label) && visualType === "table") {
      return true;
    }
    return false;
  }
  if (type === "formula") {
    return Boolean(visualType && visualType !== "formula");
  }
  if (type === "code") {
    return Boolean(visualType && visualType !== "code");
  }
  return Boolean(visualType && !["figure", "figure-text"].includes(visualType));
}

function isManualArtifact(artifact = {}) {
  return Boolean(
    artifact.manualArtifactOverride ||
      artifact.manualEditedAt ||
      artifact.manualCropEditedAt ||
      artifact.crop?.manuallyEdited ||
      artifact.cropQuality?.manual
  );
}

function entersAiContext(artifact = {}) {
  if (artifact.hidden) {
    return false;
  }
  if (artifact.splitCandidate && !isManualArtifact(artifact)) {
    return false;
  }
  const type = String(artifact.type || "");
  return ["caption", "formula", "code", "figure-text"].includes(type) &&
    Boolean(String(artifact.text || artifact.label || "").trim());
}

function normalizeArtifactQaCrop(artifact = {}) {
  if (!hasUsableArtifactCrop(artifact)) {
    return null;
  }
  const crop = artifact.crop || {};
  return {
    x: Number(crop.x),
    y: Number(crop.y),
    width: Number(crop.width),
    height: Number(crop.height),
    pageWidth: Number(crop.pageWidth || artifact.pageWidth),
    pageHeight: Number(crop.pageHeight || artifact.pageHeight),
    pixelRefined: Boolean(crop.pixelRefined),
    manuallyEdited: Boolean(crop.manuallyEdited),
  };
}

function normalizeArtifactQaQuality(quality = {}) {
  return {
    confidence: quality.confidence || "unknown",
    score: normalizeNumber(quality.score, null),
    oversized: Boolean(quality.oversized),
    areaRatio: normalizeNumber(quality.areaRatio, null),
    widthRatio: normalizeNumber(quality.widthRatio, null),
    heightRatio: normalizeNumber(quality.heightRatio, null),
    manual: Boolean(quality.manual),
  };
}

function getVisualArtifactDisplayLabel(artifact = {}) {
  if (artifact.label) {
    return artifact.label;
  }
  if (artifact.type === "caption" && artifact.visualType === "table") {
    return "表格";
  }
  if (artifact.type === "caption") {
    return "图片";
  }
  if (artifact.type === "formula") {
    return "公式";
  }
  if (artifact.type === "code") {
    return "代码";
  }
  if (artifact.type === "figure-text") {
    return "图中文字";
  }
  return artifact.visualType || artifact.type || "视觉材料";
}

function positiveNumber(value, allowZero = false) {
  const number = Number(value);
  return Number.isFinite(number) && (allowZero ? number >= 0 : number > 0);
}

function normalizeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function truncateQaText(text, limit = 180) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= limit) {
    return clean;
  }
  return `${clean.slice(0, limit - 1)}...`;
}
