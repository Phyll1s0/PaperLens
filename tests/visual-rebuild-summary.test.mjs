import assert from "node:assert/strict";
import {
  applyManualArtifactOverrides,
  buildVisualArtifactQaSummary,
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

{
  const qa = buildVisualArtifactQaSummary({
    id: "paper_visual_qa",
    pageArtifacts: [
      {
        id: "fig-ok",
        type: "caption",
        visualType: "figure",
        label: "Figure 1",
        text: "Figure 1: Forecast overview.",
        pageNumber: 1,
        imagePath: "/assets/fixture/page-001.png",
        crop: { x: 10, y: 20, width: 200, height: 120, pageWidth: 612, pageHeight: 792, pixelRefined: true },
        cropQuality: { confidence: "high", oversized: false, areaRatio: 0.05 },
      },
      {
        id: "formula-missing",
        type: "formula",
        visualType: "formula",
        text: "y = f(x)",
        pageNumber: 2,
      },
      {
        id: "table-low",
        type: "caption",
        visualType: "table",
        label: "Table 1",
        text: "Table 1: Ablation.",
        pageNumber: 3,
        imagePath: "/assets/fixture/page-003.png",
        crop: { x: 0, y: 12, width: 590, height: 610, pageWidth: 612, pageHeight: 792 },
        cropQuality: { confidence: "low", oversized: true, widthRatio: 0.96, heightRatio: 0.77 },
      },
      {
        id: "type-conflict",
        type: "caption",
        visualType: "figure",
        label: "Table 2",
        text: "Table 2: This is mislabeled as a figure.",
        pageNumber: 4,
        imagePath: "/assets/fixture/page-004.png",
        crop: { x: 20, y: 30, width: 220, height: 120, pageWidth: 612, pageHeight: 792 },
        cropQuality: { confidence: "high", oversized: false },
      },
      {
        id: "manual-hidden",
        type: "code",
        visualType: "code",
        text: "print('hidden')",
        pageNumber: 5,
        hidden: true,
        manualCropEditedAt: "2026-06-04T09:00:00.000Z",
        imagePath: "/assets/fixture/page-005.png",
        crop: { x: 20, y: 30, width: 220, height: 120, pageWidth: 612, pageHeight: 792, manuallyEdited: true },
        cropQuality: { confidence: "manual", manual: true },
      },
    ],
  }, {
    artifactAssetExists: (artifact) => artifact.id !== "table-low",
  });

  assert.equal(qa.version, 1);
  assert.equal(qa.paperId, "paper_visual_qa");
  assert.equal(qa.status, "warn");
  assert.equal(qa.summary.totalArtifacts, 5);
  assert.equal(qa.summary.visibleArtifacts, 4);
  assert.equal(qa.summary.hiddenArtifacts, 1);
  assert.equal(qa.summary.aiContextArtifacts, 4);
  assert.equal(qa.summary.manualArtifacts, 1);
  assert.equal(qa.summary.missingCrops, 1);
  assert.equal(qa.summary.missingAssets, 1);
  assert.equal(qa.summary.lowConfidence, 1);
  assert.equal(qa.summary.oversized, 1);
  assert.equal(qa.summary.typeConflicts, 1);
  assert.equal(qa.summary.issueArtifacts, 3);
  assert.equal(qa.summary.figures, 2);
  assert.equal(qa.summary.tables, 1);
  assert.equal(qa.summary.formulas, 1);
  assert.equal(qa.summary.codeBlocks, 1);
  assert.equal(qa.categories.some((category) => category.type === "missing-crop" && category.count === 1), true);
  assert.equal(qa.categories.some((category) => category.type === "ai-context" && category.count === 4), true);

  const missing = qa.items.find((item) => item.id === "formula-missing");
  assert.deepEqual(missing.issueTypes, ["missing-crop"]);
  assert.equal(missing.entersAiContext, true);

  const table = qa.items.find((item) => item.id === "table-low");
  assert.deepEqual(table.issueTypes, ["missing-asset", "low-confidence", "oversized"]);
  assert.equal(table.crop.x, 0);
  assert.equal(table.cropQuality.widthRatio, 0.96);

  const conflict = qa.items.find((item) => item.id === "type-conflict");
  assert.deepEqual(conflict.issueTypes, ["type-conflict"]);

  const hidden = qa.items.find((item) => item.id === "manual-hidden");
  assert.equal(hidden.manual, true);
  assert.equal(hidden.hidden, true);
  assert.equal(hidden.entersAiContext, false);
  assert.deepEqual(hidden.infoTypes, ["manual", "hidden"]);
}

{
  const qa = buildVisualArtifactQaSummary({
    id: "paper_figure_text",
    pageArtifacts: [
      {
        id: "figure-text-ok",
        type: "figure-text",
        visualType: "figure-text",
        text: "Diagram labels extracted from a figure.",
        pageNumber: 2,
        imagePath: "/assets/fixture/page-002.png",
        crop: { x: 20, y: 30, width: 180, height: 90, pageWidth: 612, pageHeight: 792 },
        cropQuality: { confidence: "high", oversized: false },
      },
    ],
  });

  assert.equal(qa.status, "ok");
  assert.equal(qa.summary.figureText, 1);
  assert.equal(qa.summary.typeConflicts, 0);
  assert.equal(qa.categories.some((category) => category.type === "figure-text" && category.count === 1), true);
  assert.deepEqual(qa.items[0].issueTypes, []);
}
