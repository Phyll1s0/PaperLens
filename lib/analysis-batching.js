export function clampAdaptiveBatchSize(value, options = {}) {
  const configured = Math.max(1, Number(options.configuredBatchSize || 1));
  const retryFailedOnly = Boolean(options.retryFailedOnly);
  const minimum = retryFailedOnly
    ? 1
    : Math.max(1, Math.min(configured, Number(options.minAdaptiveBatchSize || 1)));
  const adaptive = Number(value);
  if (!Number.isFinite(adaptive) || adaptive <= 0) {
    return configured;
  }

  return Math.max(minimum, Math.min(Math.trunc(adaptive), configured));
}

export function nextAdaptiveBatchSizeAfterSplit(options = {}) {
  const nextBatchSize = Math.max(1, Number(options.nextBatchSize || 1));
  const currentAdaptive = Number(options.currentAdaptiveBatchSize || nextBatchSize);
  const configured = Math.max(1, Number(options.configuredBatchSize || nextBatchSize));
  const retryFailedOnly = Boolean(options.retryFailedOnly);
  const failedRetryBatchSize = Math.max(1, Number(options.failedRetryBatchSize || 1));
  const minAdaptiveBatchSize = retryFailedOnly ? 1 : Number(options.minAdaptiveBatchSize || 1);
  const raw = retryFailedOnly
    ? Math.min(failedRetryBatchSize, nextBatchSize)
    : Math.min(Number.isFinite(currentAdaptive) && currentAdaptive > 0 ? currentAdaptive : nextBatchSize, nextBatchSize);

  return clampAdaptiveBatchSize(raw, {
    configuredBatchSize: configured,
    retryFailedOnly,
    minAdaptiveBatchSize,
  });
}
