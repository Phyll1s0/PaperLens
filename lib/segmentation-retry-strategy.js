export const SEGMENTATION_RETRY_STRATEGIES = Object.freeze({
  FULL: "full",
  REUSE_MEMORY: "reuse-memory",
  STRUCTURE_ONLY: "structure-only",
  FAILED_CHUNKS: "failed-chunks",
});

const RETRY_STRATEGY_ALIASES = new Map([
  ["full", SEGMENTATION_RETRY_STRATEGIES.FULL],
  ["complete", SEGMENTATION_RETRY_STRATEGIES.FULL],
  ["all", SEGMENTATION_RETRY_STRATEGIES.FULL],
  ["reset", SEGMENTATION_RETRY_STRATEGIES.FULL],
  ["reuse", SEGMENTATION_RETRY_STRATEGIES.REUSE_MEMORY],
  ["reuse-memory", SEGMENTATION_RETRY_STRATEGIES.REUSE_MEMORY],
  ["reuse-paper-memory", SEGMENTATION_RETRY_STRATEGIES.REUSE_MEMORY],
  ["memory", SEGMENTATION_RETRY_STRATEGIES.REUSE_MEMORY],
  ["chunks", SEGMENTATION_RETRY_STRATEGIES.REUSE_MEMORY],
  ["chunks-only", SEGMENTATION_RETRY_STRATEGIES.REUSE_MEMORY],
  ["segment-only", SEGMENTATION_RETRY_STRATEGIES.REUSE_MEMORY],
  ["structure", SEGMENTATION_RETRY_STRATEGIES.STRUCTURE_ONLY],
  ["structure-only", SEGMENTATION_RETRY_STRATEGIES.STRUCTURE_ONLY],
  ["map", SEGMENTATION_RETRY_STRATEGIES.STRUCTURE_ONLY],
  ["map-only", SEGMENTATION_RETRY_STRATEGIES.STRUCTURE_ONLY],
  ["plan", SEGMENTATION_RETRY_STRATEGIES.STRUCTURE_ONLY],
  ["plan-only", SEGMENTATION_RETRY_STRATEGIES.STRUCTURE_ONLY],
  ["failed", SEGMENTATION_RETRY_STRATEGIES.FAILED_CHUNKS],
  ["failed-chunks", SEGMENTATION_RETRY_STRATEGIES.FAILED_CHUNKS],
  ["retry-failed", SEGMENTATION_RETRY_STRATEGIES.FAILED_CHUNKS],
  ["retry-failed-chunks", SEGMENTATION_RETRY_STRATEGIES.FAILED_CHUNKS],
]);

export function normalizeSegmentationRetryStrategy(value) {
  const key = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  return RETRY_STRATEGY_ALIASES.get(key) || SEGMENTATION_RETRY_STRATEGIES.FULL;
}

export function formatSegmentationRetryStrategyLabel(value) {
  const strategy = normalizeSegmentationRetryStrategy(value);
  if (strategy === SEGMENTATION_RETRY_STRATEGIES.REUSE_MEMORY) {
    return "复用记忆重切段";
  }
  if (strategy === SEGMENTATION_RETRY_STRATEGIES.STRUCTURE_ONLY) {
    return "只刷新结构地图";
  }
  if (strategy === SEGMENTATION_RETRY_STRATEGIES.FAILED_CHUNKS) {
    return "补跑失败分段";
  }
  return "完整重跑";
}

export function canReuseSegmentationStructureMap(structureMap) {
  if (!structureMap || typeof structureMap !== "object" || Array.isArray(structureMap)) {
    return false;
  }

  const plan = Array.isArray(structureMap.segmentationPlan) ? structureMap.segmentationPlan : [];
  return plan.some((section) =>
    section &&
    typeof section === "object" &&
    String(section.title || "").trim() &&
    Number.isFinite(Number(section.startPage)));
}

export function canReusePaperMemory(memory) {
  if (!memory || typeof memory !== "object" || Array.isArray(memory)) {
    return false;
  }

  if (String(memory.summary || memory.mainThread || "").trim()) {
    return true;
  }

  return [
    memory.contributions,
    memory.keyTerms,
    memory.importantFormulas,
    memory.importantVisuals,
    memory.resources,
    memory.nonReadingGuidance,
    memory.segmentationGuidance,
  ].some((items) => Array.isArray(items) && items.length > 0);
}
