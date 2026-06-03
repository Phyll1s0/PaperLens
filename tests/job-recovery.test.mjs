import assert from "node:assert/strict";
import {
  isActiveJobStatus,
  normalizeLoadedJobItemStatus,
  normalizeLoadedJobStatus,
  recoverInterruptedJobsForRuntime,
} from "../lib/job-recovery.js";

assert.equal(isActiveJobStatus("queued"), true);
assert.equal(isActiveJobStatus("running"), true);
assert.equal(isActiveJobStatus("canceling"), true);
assert.equal(isActiveJobStatus("done"), false);
assert.equal(isActiveJobStatus("error"), false);
assert.equal(isActiveJobStatus("canceled"), false);

assert.equal(normalizeLoadedJobStatus("queued"), "queued");
assert.equal(normalizeLoadedJobStatus("running"), "queued");
assert.equal(normalizeLoadedJobStatus("canceling"), "canceled");
assert.equal(normalizeLoadedJobStatus("done"), "done");
assert.equal(normalizeLoadedJobStatus("error"), "error");
assert.equal(normalizeLoadedJobStatus("canceled"), "canceled");
assert.equal(normalizeLoadedJobStatus("unknown"), "queued");

assert.equal(normalizeLoadedJobItemStatus("queued"), "queued");
assert.equal(normalizeLoadedJobItemStatus("running"), "queued");
assert.equal(normalizeLoadedJobItemStatus("done"), "done");
assert.equal(normalizeLoadedJobItemStatus("error"), "error");
assert.equal(normalizeLoadedJobItemStatus("canceled"), "canceled");
assert.equal(normalizeLoadedJobItemStatus("weird"), "queued");

const fixedNow = "2026-06-03T08:00:00.000Z";
const interruptedJobs = [
  {
    id: "analysis-running",
    status: "running",
    currentParagraphId: "p2",
    currentBatchSize: 4,
    updatedAt: "2026-06-03T07:00:00.000Z",
    items: [
      { paragraphId: "p1", status: "done", error: "" },
      { paragraphId: "p2", status: "running", error: "temporary stream error" },
      { paragraphId: "p3", status: "error", error: "model error" },
    ],
  },
  {
    id: "segmentation-queued",
    status: "queued",
    currentParagraphId: "chunk-1",
    currentBatchSize: 1,
    updatedAt: "2026-06-03T07:00:00.000Z",
    items: [{ paragraphId: "chunk-1", status: "queued", error: "" }],
  },
  {
    id: "ocr-done",
    status: "done",
    currentParagraphId: "__ocr__",
    currentBatchSize: 1,
    updatedAt: "2026-06-03T07:00:00.000Z",
    items: [{ paragraphId: "__ocr__", status: "done", error: "" }],
  },
];

const result = recoverInterruptedJobsForRuntime(interruptedJobs, {
  hasLiveExternalWorker: false,
  now: () => fixedNow,
});

assert.equal(result.changed, true);
assert.deepEqual(result.changedJobIds, ["analysis-running", "segmentation-queued"]);
assert.deepEqual(result.skippedJobIds, []);
assert.equal(interruptedJobs[0].status, "queued");
assert.equal(interruptedJobs[0].currentParagraphId, "");
assert.equal(interruptedJobs[0].currentBatchSize, 0);
assert.equal(interruptedJobs[0].updatedAt, fixedNow);
assert.deepEqual(interruptedJobs[0].items, [
  { paragraphId: "p1", status: "done", error: "" },
  { paragraphId: "p2", status: "queued", error: "" },
  { paragraphId: "p3", status: "error", error: "model error" },
]);
assert.equal(interruptedJobs[1].status, "queued");
assert.equal(interruptedJobs[1].currentParagraphId, "");
assert.equal(interruptedJobs[1].currentBatchSize, 0);
assert.equal(interruptedJobs[1].updatedAt, fixedNow);
assert.equal(interruptedJobs[2].status, "done");
assert.equal(interruptedJobs[2].currentParagraphId, "__ocr__");
assert.equal(interruptedJobs[2].updatedAt, "2026-06-03T07:00:00.000Z");

const liveWorkerJobs = [
  {
    id: "running-owned-elsewhere",
    status: "running",
    currentParagraphId: "p9",
    currentBatchSize: 2,
    updatedAt: "2026-06-03T07:10:00.000Z",
    items: [{ paragraphId: "p9", status: "running", error: "in flight" }],
  },
  {
    id: "canceling-owned-elsewhere",
    status: "canceling",
    currentParagraphId: "p10",
    currentBatchSize: 1,
    updatedAt: "2026-06-03T07:10:00.000Z",
    items: [{ paragraphId: "p10", status: "running", error: "aborting" }],
  },
  {
    id: "queued-local",
    status: "queued",
    currentParagraphId: "p11",
    currentBatchSize: 1,
    updatedAt: "2026-06-03T07:10:00.000Z",
    items: [{ paragraphId: "p11", status: "queued", error: "" }],
  },
];

const liveWorkerResult = recoverInterruptedJobsForRuntime(liveWorkerJobs, {
  hasLiveExternalWorker: true,
  now: () => fixedNow,
});

assert.equal(liveWorkerResult.changed, true);
assert.deepEqual(liveWorkerResult.changedJobIds, ["queued-local"]);
assert.deepEqual(liveWorkerResult.skippedJobIds, ["running-owned-elsewhere", "canceling-owned-elsewhere"]);
assert.equal(liveWorkerJobs[0].status, "running");
assert.equal(liveWorkerJobs[0].currentParagraphId, "p9");
assert.equal(liveWorkerJobs[0].items[0].status, "running");
assert.equal(liveWorkerJobs[1].status, "canceling");
assert.equal(liveWorkerJobs[1].items[0].error, "aborting");
assert.equal(liveWorkerJobs[2].status, "queued");
assert.equal(liveWorkerJobs[2].currentParagraphId, "");
assert.equal(liveWorkerJobs[2].updatedAt, fixedNow);

const cleanResult = recoverInterruptedJobsForRuntime([
  { id: "done", status: "done", items: [{ status: "done" }] },
  { id: "error", status: "error", items: [{ status: "error" }] },
  { id: "canceled", status: "canceled", items: [{ status: "canceled" }] },
], { now: () => fixedNow });
assert.equal(cleanResult.changed, false);
assert.deepEqual(cleanResult.changedJobIds, []);
