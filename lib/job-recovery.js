export function isActiveJobStatus(status) {
  return status === "queued" || status === "running" || status === "canceling";
}

export function normalizeLoadedJobStatus(status) {
  if (status === "done" || status === "error" || status === "canceled") {
    return status;
  }

  if (status === "canceling") {
    return "canceled";
  }

  return "queued";
}

export function normalizeLoadedJobItemStatus(status) {
  if (status === "done" || status === "error" || status === "canceled") {
    return status;
  }

  return "queued";
}

export function recoverInterruptedJobsForRuntime(jobs, options = {}) {
  const hasLiveExternalWorker = Boolean(options.hasLiveExternalWorker);
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const changedJobIds = [];
  const skippedJobIds = [];

  for (const job of jobs || []) {
    if (!job || !isActiveJobStatus(job.status)) {
      continue;
    }

    if (hasLiveExternalWorker && (job.status === "running" || job.status === "canceling")) {
      skippedJobIds.push(job.id || "");
      continue;
    }

    job.status = "queued";
    job.currentParagraphId = "";
    job.currentBatchSize = 0;
    job.updatedAt = now();
    changedJobIds.push(job.id || "");
    for (const item of Array.isArray(job.items) ? job.items : []) {
      if (item.status === "running") {
        item.status = "queued";
        item.error = "";
      }
    }
  }

  return {
    changed: changedJobIds.length > 0,
    changedJobIds,
    skippedJobIds,
  };
}
