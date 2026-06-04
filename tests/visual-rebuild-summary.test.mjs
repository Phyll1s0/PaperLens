import assert from "node:assert/strict";
import {
  applyManualArtifactOverrides,
  buildVisualRebuildStats,
  collectManualArtifactOverrides,
  isVisiblePaperArtifact,
} from "../lib/visual-rebuild-summary.js";

assert.equal(isVisiblePaperArtifact({ hidden: false }), true);
assert.equal(isVisiblePaperArtifact({ hidden: true }), false);

assert.deepEqual(
  buildVisualRebuildStats(
    {
      extractionPages: [
        { pageNumber: 1, visualRegions: [{ type: "figure" }, { type: "formula" }] },
        { pageNumber: 2, visualRegions: [{ type: "code" }] },
      ],
      pageImages: [
        { pageNumber: 1, imagePath: "page-1.png" },
        { pageNumber: 2, imagePath: "" },
      ],
      pageArtifacts: [
        {
          id: "caption-1",
          type: "caption",
          crop: { pixelRefined: true },
          cropQuality: { confidence: "high" },
        },
        {
          id: "formula-1",
          type: "formula",
          cropQuality: { confidence: "low", oversized: true },
        },
        {
          id: "code-hidden",
          type: "code",
          hidden: true,
          cropQuality: { confidence: "low", oversized: true },
        },
        {
          id: "figure-text-1",
          type: "figure-text",
          manualCropEditedAt: "2026-05-30T10:00:00.000Z",
          crop: { manuallyEdited: true },
          cropQuality: { confidence: "manual", manual: true },
        },
      ],
    },
    [],
    7,
  ),
  {
    pages: 2,
    pagesWithImages: 1,
    visualRegions: 3,
    artifacts: 3,
    hiddenArtifacts: 1,
    previousArtifacts: 7,
    captions: 1,
    formulas: 1,
    codeBlocks: 0,
    figureText: 1,
    pixelRefined: 1,
    lowConfidence: 1,
    oversized: 1,
    manualCrops: 1,
  },
);

const manualCrop = {
  x: 12,
  y: 34,
  width: 220,
  height: 120,
  pageWidth: 612,
  pageHeight: 792,
  manuallyEdited: true,
};
const manualCropQuality = {
  version: 1,
  areaRatio: 0.056,
  widthRatio: 0.359,
  heightRatio: 0.152,
  oversized: false,
  confidence: "manual",
  manual: true,
};

const overrides = collectManualArtifactOverrides([
  {
    id: "manual-text",
    type: "caption",
    visualType: "figure",
    label: "Figure 1",
    text: "Manually repaired caption.",
    crop: manualCrop,
    cropQuality: manualCropQuality,
    cropVersion: 3,
    manualCropEditedAt: "2026-05-30T10:00:00.000Z",
    manualEditedAt: "2026-05-30T10:01:00.000Z",
    manualArtifactOverride: true,
  },
  {
    id: "crop-only",
    type: "figure-text",
    visualType: "figure",
    crop: manualCrop,
    cropQuality: manualCropQuality,
    cropVersion: 3,
    manualCropEditedAt: "2026-05-30T10:02:00.000Z",
  },
  {
    id: "hidden-artifact",
    type: "formula",
    text: "hidden formula",
    hidden: true,
  },
  {
    id: "plain-artifact",
    type: "code",
  },
]);

assert.equal(overrides.has("manual-text"), true);
assert.equal(overrides.has("crop-only"), true);
assert.equal(overrides.has("hidden-artifact"), true);
assert.equal(overrides.has("plain-artifact"), false);

assert.deepEqual(
  applyManualArtifactOverrides(
    [
      {
        id: "manual-text",
        type: "figure-text",
        visualType: "table",
        label: "Auto Figure",
        text: "auto caption",
        crop: { x: 1, y: 1, width: 10, height: 10 },
        cropQuality: { confidence: "low" },
        cropVersion: 1,
      },
      {
        id: "crop-only",
        type: "figure-text",
        visualType: "figure",
        crop: { x: 2, y: 2, width: 12, height: 12 },
        cropQuality: { confidence: "low" },
        cropVersion: 1,
      },
      {
        id: "hidden-artifact",
        type: "formula",
        text: "auto formula",
        hidden: false,
      },
      {
        id: "plain-artifact",
        type: "code",
        text: "console.log('kept')",
      },
    ],
    overrides,
  ),
  [
    {
      id: "manual-text",
      type: "caption",
      visualType: "figure",
      label: "Figure 1",
      text: "Manually repaired caption.",
      crop: manualCrop,
      cropQuality: manualCropQuality,
      cropVersion: 3,
      manualCropEditedAt: "2026-05-30T10:00:00.000Z",
      hidden: false,
      manualEditedAt: "2026-05-30T10:01:00.000Z",
      manualArtifactOverride: true,
    },
    {
      id: "crop-only",
      type: "figure-text",
      visualType: "figure",
      label: undefined,
      text: undefined,
      crop: manualCrop,
      cropQuality: manualCropQuality,
      cropVersion: 3,
      manualCropEditedAt: "2026-05-30T10:02:00.000Z",
      hidden: false,
      manualEditedAt: undefined,
      manualArtifactOverride: false,
    },
    {
      id: "hidden-artifact",
      type: "formula",
      text: "hidden formula",
      hidden: true,
      visualType: undefined,
      label: undefined,
      crop: undefined,
      cropQuality: undefined,
      cropVersion: undefined,
      manualCropEditedAt: undefined,
      manualEditedAt: undefined,
      manualArtifactOverride: false,
    },
    {
      id: "plain-artifact",
      type: "code",
      text: "console.log('kept')",
    },
  ],
);
