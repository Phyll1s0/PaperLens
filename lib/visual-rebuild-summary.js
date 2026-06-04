export function isVisiblePaperArtifact(artifact) {
  return !artifact?.hidden;
}

export function collectManualArtifactOverrides(artifacts = []) {
  const overrides = new Map();
  for (const artifact of artifacts) {
    if (
      !artifact?.id ||
      (!artifact.manualArtifactOverride &&
        !artifact.manualEditedAt &&
        !artifact.manualCropEditedAt &&
        !artifact.hidden)
    ) {
      continue;
    }
    overrides.set(artifact.id, {
      type: artifact.type,
      visualType: artifact.visualType,
      label: artifact.label,
      text: artifact.text,
      crop: artifact.crop,
      cropQuality: artifact.cropQuality,
      cropVersion: artifact.cropVersion,
      manualCropEditedAt: artifact.manualCropEditedAt,
      hidden: artifact.hidden,
      manualEditedAt: artifact.manualEditedAt,
      manualArtifactOverride: artifact.manualArtifactOverride,
    });
  }
  return overrides;
}

export function applyManualArtifactOverrides(artifacts = [], overrides = new Map()) {
  if (!overrides.size) {
    return artifacts;
  }
  return artifacts.map((artifact) => {
    const override = overrides.get(artifact.id);
    if (!override) {
      return artifact;
    }
    return {
      ...artifact,
      type: override.type || artifact.type,
      visualType: override.visualType || artifact.visualType,
      label: override.label || artifact.label,
      text: override.text || artifact.text,
      crop: override.crop || artifact.crop,
      cropQuality: override.cropQuality || artifact.cropQuality,
      cropVersion: override.cropVersion || artifact.cropVersion,
      manualCropEditedAt: override.manualCropEditedAt || artifact.manualCropEditedAt,
      hidden: Boolean(override.hidden),
      manualEditedAt: override.manualEditedAt || artifact.manualEditedAt,
      manualArtifactOverride: Boolean(override.manualArtifactOverride),
    };
  });
}

export function buildVisualRebuildStats(paper, pages = [], previousArtifactCount = 0) {
  const extractionPages = Array.isArray(paper?.extractionPages) ? paper.extractionPages : [];
  const pageImages = Array.isArray(paper?.pageImages) ? paper.pageImages : [];
  const sourcePages = pages.length ? pages : extractionPages;
  const visualRegions = sourcePages.flatMap((page) =>
    Array.isArray(page.visualRegions) ? page.visualRegions : [],
  );
  const allArtifacts = Array.isArray(paper?.pageArtifacts) ? paper.pageArtifacts : [];
  const artifacts = allArtifacts.filter(isVisiblePaperArtifact);
  const byType = {};
  for (const artifact of artifacts) {
    byType[artifact.type || "unknown"] = (byType[artifact.type || "unknown"] || 0) + 1;
  }

  return {
    pages: extractionPages.length,
    pagesWithImages: pageImages.filter((page) => page.imagePath).length,
    visualRegions: visualRegions.length,
    artifacts: artifacts.length,
    hiddenArtifacts: allArtifacts.length - artifacts.length,
    previousArtifacts: previousArtifactCount,
    captions: byType.caption || 0,
    formulas: byType.formula || 0,
    codeBlocks: byType.code || 0,
    figureText: byType["figure-text"] || 0,
    pixelRefined: artifacts.filter((artifact) => artifact.crop?.pixelRefined).length,
    lowConfidence: artifacts.filter((artifact) => artifact.cropQuality?.confidence === "low")
      .length,
    oversized: artifacts.filter((artifact) => artifact.cropQuality?.oversized).length,
    manualCrops: artifacts.filter(
      (artifact) =>
        artifact.manualCropEditedAt ||
        artifact.crop?.manuallyEdited ||
        artifact.cropQuality?.manual,
    ).length,
  };
}
