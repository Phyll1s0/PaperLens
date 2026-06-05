import assert from "node:assert/strict";
import {
  buildManualVisualCropUpdate,
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
  normalizeVisualCrop({ x: 612, y: 792, width: 20, height: 20, ...page }),
  { x: 611, y: 791, width: 1, height: 1, pageWidth: 612, pageHeight: 792 },
);

assert.deepEqual(
  buildCropQuality({ x: 90, y: 150, width: 360, height: 180, ...page, pixelRefined: true }, "figure"),
  {
    version: 1,
    score: 86,
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
    score: 28,
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
    score: 36,
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
    score: 28,
    areaRatio: 0.102,
    widthRatio: 0.49,
    heightRatio: 0.208,
    oversized: true,
    confidence: "low",
  },
);

assert.equal(isOversizedVisualCrop(0.19, 0.5, 0.32, "code"), false);
assert.equal(isOversizedVisualCrop(0.21, 0.5, 0.32, "code"), true);
assert.equal(isOversizedVisualCrop(0.26, 0.42, 0.59, "code", { algorithmLike: true }), false);
assert.equal(isOversizedVisualCrop(0.36, 0.42, 0.86, "code", { algorithmLike: true }), true);
assert.equal(getCropConfidence(0.004, 0.018, 0.018, "figure", false), "low");
assert.equal(getCropConfidence(0.004, 0.018, 0.018, "figure", true), "high");

assert.deepEqual(
  buildCropQuality({ x: 310, y: 70, width: 254, height: 468, ...page, pixelRefined: true, algorithmLike: true }, "code"),
  {
    version: 1,
    score: 86,
    areaRatio: 0.245,
    widthRatio: 0.415,
    heightRatio: 0.591,
    oversized: false,
    confidence: "high",
    algorithmLike: true,
  },
);

assert.deepEqual(
  buildManualVisualCropUpdate(
    { type: "caption", visualType: "figure", crop: { pageWidth: 612, pageHeight: 792 } },
    { x: -10, y: 20, width: 700, height: 90 },
  ),
  {
    crop: {
      x: 0,
      y: 20,
      width: 612,
      height: 90,
      pageWidth: 612,
      pageHeight: 792,
      pixelRefined: false,
      manuallyEdited: true,
    },
    cropQuality: {
      version: 1,
      score: 62,
      areaRatio: 0.114,
      widthRatio: 1,
      heightRatio: 0.114,
      oversized: false,
      confidence: "manual",
      manual: true,
    },
  },
);

assert.deepEqual(
  buildManualVisualCropUpdate({ crop: { pageWidth: 612, pageHeight: 792 } }, { x: 1, y: 2, width: 0, height: 8 }),
  { error: "invalid-crop" },
);
