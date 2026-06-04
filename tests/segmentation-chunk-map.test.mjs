import assert from "node:assert/strict";
import {
  buildSegmentationChunkMap,
  mergeRetriedChunkParagraphs,
  mergeSegmentationChunkMaps,
} from "../lib/segmentation-chunk-map.js";

const existing = [
  { id: "p1", order: 0, pageNumber: 1, pageEndNumber: 1, sourceText: "Introduction paragraph.", translation: "保留" },
  { id: "p2", order: 1, pageNumber: 2, pageEndNumber: 2, sourceText: "Old failed page paragraph.", translation: "旧翻译" },
  { id: "p3", order: 2, pageNumber: 3, pageEndNumber: 3, sourceText: "Result paragraph.", explanation: "保留讲解" },
];
const retried = [
  { id: "r1", order: 0, pageNumber: 2, pageEndNumber: 2, sourceText: "New retried page paragraph.", segmentationChunkIndex: 1 },
  { id: "r2", order: 1, pageNumber: 2, pageEndNumber: 2, sourceText: "Second retried paragraph.", segmentationChunkIndex: 1 },
];

const merged = mergeRetriedChunkParagraphs(existing, retried, [{ startPage: 2, endPage: 2 }]);
assert.deepEqual(merged.map((paragraph) => paragraph.id), ["p1", "r1", "r2", "p3"]);
assert.deepEqual(merged.map((paragraph) => paragraph.order), [0, 1, 2, 3]);
assert.equal(merged[0].translation, "保留");
assert.equal(merged.at(-1).explanation, "保留讲解");

const chunks = [
  [{ pageNumber: 1 }],
  [{ pageNumber: 2 }],
];
const patchMap = buildSegmentationChunkMap({
  chunks,
  paragraphs: retried,
  chunkSummaries: [{ index: 1, summary: "Retried p.2", keywords: ["retry"] }],
  targetIndices: [1],
  now: "2026-06-04T00:00:00.000Z",
});
assert.equal(patchMap.chunks.length, 1);
assert.equal(patchMap.chunks[0].index, 1);
assert.deepEqual(patchMap.chunks[0].paragraphIds, ["r1", "r2"]);

const combined = mergeSegmentationChunkMaps({
  version: 1,
  chunks: [{ index: 0, pageRange: "p.1", paragraphIds: ["p1"] }],
}, patchMap, "2026-06-04T00:00:01.000Z");
assert.deepEqual(combined.chunks.map((chunk) => chunk.index), [0, 1]);
assert.deepEqual(combined.chunks[1].paragraphIds, ["r1", "r2"]);
