import assert from "node:assert/strict";
import {
  clampAdaptiveBatchSize,
  nextAdaptiveBatchSizeAfterSplit,
} from "../lib/analysis-batching.js";

assert.equal(
  clampAdaptiveBatchSize(1, {
    configuredBatchSize: 4,
    minAdaptiveBatchSize: 3,
    retryFailedOnly: false,
  }),
  3,
);

assert.equal(
  clampAdaptiveBatchSize(1, {
    configuredBatchSize: 4,
    minAdaptiveBatchSize: 3,
    retryFailedOnly: true,
  }),
  1,
);

assert.equal(
  nextAdaptiveBatchSizeAfterSplit({
    nextBatchSize: 1,
    currentAdaptiveBatchSize: 1,
    configuredBatchSize: 4,
    retryFailedOnly: false,
    failedRetryBatchSize: 2,
    minAdaptiveBatchSize: 3,
  }),
  3,
);

assert.equal(
  nextAdaptiveBatchSizeAfterSplit({
    nextBatchSize: 1,
    currentAdaptiveBatchSize: 1,
    configuredBatchSize: 4,
    retryFailedOnly: true,
    failedRetryBatchSize: 2,
    minAdaptiveBatchSize: 3,
  }),
  1,
);
