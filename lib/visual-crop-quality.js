export function normalizeVisualCrop(crop = {}) {
  const pageWidth = Number(crop.pageWidth || 0);
  const pageHeight = Number(crop.pageHeight || 0);
  const x = clampNumber(Number(crop.x), 0, pageWidth > 1 ? pageWidth - 1 : pageWidth);
  const y = clampNumber(Number(crop.y), 0, pageHeight > 1 ? pageHeight - 1 : pageHeight);
  const right = clampNumber(Number(crop.x) + Number(crop.width), x + 1, pageWidth);
  const bottom = clampNumber(Number(crop.y) + Number(crop.height), y + 1, pageHeight);

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
    pageWidth,
    pageHeight,
  };
}

export function buildCropQuality(crop, visualType = "") {
  if (!crop || !Number(crop.pageWidth) || !Number(crop.pageHeight)) {
    return {
      version: 1,
      score: 0,
      areaRatio: 0,
      widthRatio: 0,
      heightRatio: 0,
      oversized: false,
      confidence: "unknown",
    };
  }

  const pageArea = Math.max(1, Number(crop.pageWidth) * Number(crop.pageHeight));
  const areaRatio = Number(crop.width || 0) * Number(crop.height || 0) / pageArea;
  const widthRatio = Number(crop.width || 0) / Math.max(1, Number(crop.pageWidth || 0));
  const heightRatio = Number(crop.height || 0) / Math.max(1, Number(crop.pageHeight || 0));
  const algorithmLike = Boolean(crop.algorithmLike);
  const oversized = isOversizedVisualCrop(areaRatio, widthRatio, heightRatio, visualType, { algorithmLike });
  return {
    version: 1,
    score: buildCropQualityScore({
      areaRatio,
      widthRatio,
      heightRatio,
      visualType,
      pixelRefined: Boolean(crop.pixelRefined),
      oversized,
      algorithmLike,
    }),
    areaRatio: roundMetric(areaRatio),
    widthRatio: roundMetric(widthRatio),
    heightRatio: roundMetric(heightRatio),
    oversized,
    confidence: getCropConfidence(areaRatio, widthRatio, heightRatio, visualType, Boolean(crop.pixelRefined), { algorithmLike }),
    ...(algorithmLike ? { algorithmLike: true } : {}),
  };
}

export function buildManualVisualCropUpdate(artifact = {}, payload = {}) {
  const source = payload?.crop && typeof payload.crop === "object" ? payload.crop : payload;
  const pageWidth = firstPositiveNumber(source.pageWidth, artifact.crop?.pageWidth, artifact.pageWidth, artifact.imageWidth);
  const pageHeight = firstPositiveNumber(source.pageHeight, artifact.crop?.pageHeight, artifact.pageHeight, artifact.imageHeight);
  const raw = {
    x: Number(source.x),
    y: Number(source.y),
    width: Number(source.width),
    height: Number(source.height),
    pageWidth,
    pageHeight,
  };

  if (![raw.x, raw.y, raw.width, raw.height, pageWidth, pageHeight].every(Number.isFinite) ||
    raw.width <= 0 || raw.height <= 0 || pageWidth <= 0 || pageHeight <= 0) {
    return { error: "invalid-crop" };
  }

  const crop = {
    ...normalizeVisualCrop(raw),
    pixelRefined: false,
    manuallyEdited: true,
  };
  const quality = {
    ...buildCropQuality(crop, getArtifactVisualTypeForQuality(artifact)),
    oversized: false,
    confidence: "manual",
    manual: true,
  };

  return { crop, cropQuality: quality };
}

export function isOversizedVisualCrop(areaRatio, widthRatio, heightRatio, visualType = "", options = {}) {
  if (visualType === "table") {
    return areaRatio > 0.38 || heightRatio > 0.62;
  }
  if (visualType === "formula") {
    return areaRatio > 0.12 || heightRatio > 0.18;
  }
  if (visualType === "code") {
    if (options.algorithmLike) {
      return areaRatio > 0.34 || heightRatio > 0.68 || widthRatio > 0.72 && heightRatio > 0.52;
    }
    return areaRatio > 0.2 || heightRatio > 0.36;
  }
  return areaRatio > 0.28 ||
    (widthRatio > 0.62 && heightRatio > 0.46) ||
    (widthRatio > 0.9 && heightRatio > 0.34);
}

export function getCropConfidence(areaRatio, widthRatio, heightRatio, visualType = "", pixelRefined = false, options = {}) {
  if (isOversizedVisualCrop(areaRatio, widthRatio, heightRatio, visualType, options)) {
    return pixelRefined ? "medium" : "low";
  }

  if (pixelRefined) {
    return "high";
  }

  if (visualType === "formula" || visualType === "code") {
    return "medium";
  }

  return widthRatio > 0.02 && heightRatio > 0.02 ? "medium" : "low";
}

export function buildCropQualityScore({
  areaRatio = 0,
  widthRatio = 0,
  heightRatio = 0,
  visualType = "",
  pixelRefined = false,
  oversized = false,
  algorithmLike = false,
} = {}) {
  let score = 72;
  if (pixelRefined) {
    score += 14;
  }
  if (oversized) {
    score -= visualType === "formula" ? 32 : 24;
  }
  if (areaRatio <= 0.002 || widthRatio <= 0.015 || heightRatio <= 0.015) {
    score -= 28;
  }
  if (visualType === "formula" && heightRatio > 0.18) {
    score -= 12;
  } else if (visualType === "code" && heightRatio > (algorithmLike ? 0.68 : 0.36)) {
    score -= 12;
  } else if (visualType === "table" && heightRatio > 0.62) {
    score -= 12;
  } else if (!["formula", "code", "table"].includes(visualType) && heightRatio > 0.46 && widthRatio > 0.62) {
    score -= 12;
  }
  if (widthRatio > 0.94) {
    score -= visualType === "table" ? 6 : 10;
  }
  if (areaRatio > 0.5) {
    score -= 14;
  } else if (areaRatio > 0.35) {
    score -= 8;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function roundMetric(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

function firstPositiveNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) {
      return number;
    }
  }
  return 0;
}

function getArtifactVisualTypeForQuality(artifact = {}) {
  if (artifact.type === "caption") {
    return artifact.visualType || "figure";
  }
  if (artifact.type === "figure-text") {
    return "figure";
  }
  return artifact.visualType || artifact.type || "figure";
}
