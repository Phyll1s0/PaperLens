import assert from "node:assert/strict";
import {
  buildCropQuality,
  getCropConfidence,
  isOversizedVisualCrop,
  normalizeVisualCrop,
} from "../lib/visual-crop-quality.js";

const page = { pageWidth: 612, pageHeight: 792 };

assert.deepEqual(
  normalizeVisualCrop({ x: -12, y: -4, width: 720, height: 900, ...page }),
  { x: 0, y: 0, width: 612, height: 792, pageWidth: 612, pageHeight: 792 },
);

assert.deepEqual(
  buildCropQuality({ x: 90, y: 150, width: 360, height: 180, ...page, pixelRefined: true }, "figure"),
  {
    version: 1,
    areaRatio: 0.134,
    widthRatio: 0.588,
    heightRatio: 0.227,
    oversized: false,
    confidence: "high",
  },
);

assert.deepEqual(
  buildCropQuality({ x: 35, y: 84, width: 545, height: 410, ...page }, "figure"),
  {
    version: 1,
    areaRatio: 0.461,
    widthRatio: 0.891,
    heightRatio: 0.518,
    oversized: true,
    confidence: "low",
  },
);

assert.deepEqual(
  buildCropQuality({ x: 55, y: 120, width: 500, height: 520, ...page, pixelRefined: true }, "table"),
  {
    version: 1,
    areaRatio: 0.536,
    widthRatio: 0.817,
    heightRatio: 0.657,
    oversized: true,
    confidence: "medium",
  },
);

assert.deepEqual(
  buildCropQuality({ x: 100, y: 300, width: 300, height: 165, ...page }, "formula"),
  {
    version: 1,
    areaRatio: 0.102,
    widthRatio: 0.49,
    heightRatio: 0.208,
    oversized: true,
    confidence: "low",
  },
);

assert.equal(isOversizedVisualCrop(0.19, 0.5, 0.32, "code"), false);
assert.equal(isOversizedVisualCrop(0.21, 0.5, 0.32, "code"), true);
assert.equal(getCropConfidence(0.004, 0.018, 0.018, "figure", false), "low");
assert.equal(getCropConfidence(0.004, 0.018, 0.018, "figure", true), "high");
