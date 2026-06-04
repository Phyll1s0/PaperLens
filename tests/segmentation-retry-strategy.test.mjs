import assert from "node:assert/strict";
import {
  SEGMENTATION_RETRY_STRATEGIES,
  canReusePaperMemory,
  canReuseSegmentationStructureMap,
  formatSegmentationRetryStrategyLabel,
  normalizeSegmentationRetryStrategy,
} from "../lib/segmentation-retry-strategy.js";

assert.equal(normalizeSegmentationRetryStrategy(""), SEGMENTATION_RETRY_STRATEGIES.FULL);
assert.equal(normalizeSegmentationRetryStrategy("reuse_paper_memory"), SEGMENTATION_RETRY_STRATEGIES.REUSE_MEMORY);
assert.equal(normalizeSegmentationRetryStrategy("chunks-only"), SEGMENTATION_RETRY_STRATEGIES.REUSE_MEMORY);
assert.equal(normalizeSegmentationRetryStrategy("map"), SEGMENTATION_RETRY_STRATEGIES.STRUCTURE_ONLY);
assert.equal(normalizeSegmentationRetryStrategy("unexpected"), SEGMENTATION_RETRY_STRATEGIES.FULL);

assert.equal(formatSegmentationRetryStrategyLabel("full"), "完整重跑");
assert.equal(formatSegmentationRetryStrategyLabel("reuse-memory"), "复用记忆重切段");
assert.equal(formatSegmentationRetryStrategyLabel("structure-only"), "只刷新结构地图");

assert.equal(canReuseSegmentationStructureMap(null), false);
assert.equal(canReuseSegmentationStructureMap({ segmentationPlan: [] }), false);
assert.equal(canReuseSegmentationStructureMap({
  segmentationPlan: [
    { title: "Abstract", startPage: 1, endPage: 1 },
  ],
}), true);

assert.equal(canReusePaperMemory(null), false);
assert.equal(canReusePaperMemory({}), false);
assert.equal(canReusePaperMemory({ summary: "A time series forecasting paper." }), true);
assert.equal(canReusePaperMemory({ importantFormulas: [{ label: "Eq. 1" }] }), true);
