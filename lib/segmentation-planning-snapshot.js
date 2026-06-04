import { createHash } from "node:crypto";
import {
  canReusePaperMemory,
  canReuseSegmentationStructureMap,
  formatSegmentationRetryStrategyLabel,
  normalizeSegmentationRetryStrategy,
} from "./segmentation-retry-strategy.js";

export const SEGMENTATION_PLANNING_SNAPSHOT_VERSION = 1;

export function attachSegmentationPlanningSnapshot(paper = {}, options = {}) {
  paper.segmentationPlanningSnapshot = buildSegmentationPlanningSnapshot(paper, {
    ...options,
    previous: options.previous || paper.segmentationPlanningSnapshot,
  });
  return paper.segmentationPlanningSnapshot;
}

export function buildSegmentationPlanningSnapshot(paper = {}, options = {}) {
  const now = options.now || (() => new Date());
  const structureMap = normalizeObject(paper.structureMap);
  const memory = normalizeObject(paper.paperMemory);
  const stages = normalizeObject(paper.segmentationStages);
  const plan = normalizePlan(structureMap.segmentationPlan || paper.segmentationPlan);
  const sections = normalizeSections(structureMap.sections || paper.sections);
  const nonBodyZones = normalizeZones(structureMap.nonBodyZones);
  const structureReusable = canReuseSegmentationStructureMap(structureMap);
  const memoryReusable = canReusePaperMemory(memory);
  const strategy = normalizeSegmentationRetryStrategy(
    stages.plan?.strategy ||
      stages.localSegmentation?.strategy ||
      paper.segmentationJob?.strategy ||
      paper.segmentationMode ||
      "",
  );
  const fallbackChunks = Array.isArray(stages.fallback?.chunks) ? stages.fallback.chunks.length : 0;
  const fallbackReason = stages.fallback?.reason ||
    stages.localSegmentation?.reason ||
    structureMap.fallbackReason ||
    "";
  const partialFallback = Boolean(stages.fallback || fallbackReason || fallbackChunks);
  const fingerprint = buildPlanningFingerprint({
    structureMap,
    memory,
    stages,
    plan,
    nonBodyZones,
    strategy,
  });
  const previous = normalizeObject(options.previous);
  const generatedAt = previous.fingerprint === fingerprint && previous.generatedAt
    ? previous.generatedAt
    : now().toISOString();
  const reuseLevel = getPlanningReuseLevel(structureReusable, memoryReusable, plan.length);
  const status = getPlanningStatus(structureReusable, memoryReusable, plan.length);

  return {
    version: SEGMENTATION_PLANNING_SNAPSHOT_VERSION,
    fingerprint,
    generatedAt,
    status,
    reuseLevel,
    reusable: reuseLevel === "strong" || reuseLevel === "partial",
    strategy,
    strategyLabel: formatSegmentationRetryStrategyLabel(strategy),
    sources: {
      structure: stages.plan?.source || structureMap.source || (structureReusable ? "structure-map" : ""),
      memory: stages.paperMemory?.source || memory.source || "",
      segmentation: stages.localSegmentation?.source || paper.segmentationMode || "",
    },
    counts: {
      planItems: plan.length,
      sections: sections.length,
      nonBodyZones: nonBodyZones.length,
      paperMemoryKeyTerms: normalizeList(memory.keyTerms).length,
      paperMemoryFormulas: normalizeList(memory.importantFormulas).length,
      paperMemoryVisuals: normalizeList(memory.importantVisuals).length,
      paperMemoryResources: normalizeList(memory.resources).length,
      paperMemoryGuidance: normalizeList(memory.segmentationGuidance).length +
        normalizeList(memory.nonReadingGuidance).length,
      fallbackChunks,
    },
    flags: {
      structureReusable,
      memoryReusable,
      partialFallback,
      paperMemoryReused: Boolean(stages.paperMemory?.reused),
      hasBodyStart: Number.isFinite(Number(structureMap.bodyStartPage)),
      hasReferencesStart: Number.isFinite(Number(structureMap.referencesStartPage)),
    },
    pageBounds: {
      bodyStartPage: normalizePage(structureMap.bodyStartPage),
      referencesStartPage: normalizePage(structureMap.referencesStartPage),
    },
    summary: buildPlanningSummary({
      status,
      reuseLevel,
      plan,
      nonBodyZones,
      memoryReusable,
      partialFallback,
      fallbackReason,
    }),
    planPreview: plan.slice(0, 8),
    nonBodyPreview: nonBodyZones.slice(0, 8),
  };
}

function getPlanningReuseLevel(structureReusable, memoryReusable, planCount) {
  if (structureReusable && memoryReusable) {
    return "strong";
  }
  if (structureReusable || (planCount > 0 && memoryReusable)) {
    return "partial";
  }
  return "weak";
}

function getPlanningStatus(structureReusable, memoryReusable, planCount) {
  if (structureReusable && memoryReusable) {
    return "ready";
  }
  if (structureReusable || planCount > 0 || memoryReusable) {
    return "partial";
  }
  return "missing";
}

function buildPlanningSummary(input) {
  const parts = [];
  if (input.status === "ready") {
    parts.push("规划快照完整");
  } else if (input.status === "partial") {
    parts.push("规划快照部分可用");
  } else {
    parts.push("缺少可复用规划");
  }

  if (input.plan.length) {
    parts.push(`${input.plan.length} 个章节计划`);
  }
  if (input.nonBodyZones.length) {
    parts.push(`${input.nonBodyZones.length} 个非正文区域`);
  }
  parts.push(input.memoryReusable ? "Paper Memory 可复用" : "Paper Memory 不足");
  if (input.partialFallback) {
    parts.push(input.fallbackReason ? `有局部兜底：${truncateText(input.fallbackReason, 42)}` : "有局部兜底");
  }
  return parts.join(" · ");
}

function buildPlanningFingerprint(value) {
  return createHash("sha1")
    .update(stableStringify(value))
    .digest("hex")
    .slice(0, 16);
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizePlan(plan) {
  return normalizeList(plan)
    .map((item, index) => ({
      id: normalizeLine(item.id || `planned_section_${index + 1}`),
      title: normalizeLine(item.title || item.sectionTitle || item.name || ""),
      role: normalizeLine(item.role || ""),
      startPage: normalizePage(item.startPage || item.pageNumber),
      endPage: normalizePage(item.endPage || item.pageEndNumber),
    }))
    .filter((item) => item.title && item.startPage)
    .slice(0, 64);
}

function normalizeSections(sections) {
  return normalizeList(sections)
    .map((item) => ({
      title: normalizeLine(item.title || item.name || ""),
      startPage: normalizePage(item.startPage || item.pageNumber),
      endPage: normalizePage(item.endPage || item.pageEndNumber),
    }))
    .filter((item) => item.title)
    .slice(0, 64);
}

function normalizeZones(zones) {
  return normalizeList(zones)
    .map((item) => ({
      type: normalizeLine(item.type || "zone"),
      label: normalizeLine(item.label || item.title || item.type || "非正文区域"),
      startPage: normalizePage(item.startPage || item.pageNumber),
      endPage: normalizePage(item.endPage || item.pageEndNumber),
      description: truncateText(normalizeLine(item.description || item.reason || ""), 140),
    }))
    .filter((item) => item.startPage || item.label)
    .slice(0, 64);
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function normalizePage(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : null;
}

function normalizeLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncateText(value, limit) {
  const text = normalizeLine(value);
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1))}…` : text;
}
