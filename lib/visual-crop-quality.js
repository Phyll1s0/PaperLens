export function normalizeVisualCrop(crop = {}) {
  const pageWidth = Number(crop.pageWidth || 0);
  const pageHeight = Number(crop.pageHeight || 0);
  const x = clampNumber(Number(crop.x), 0, pageWidth);
  const y = clampNumber(Number(crop.y), 0, pageHeight);
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
  const oversized = isOversizedVisualCrop(areaRatio, widthRatio, heightRatio, visualType);
  return {
    version: 1,
    areaRatio: roundMetric(areaRatio),
    widthRatio: roundMetric(widthRatio),
    heightRatio: roundMetric(heightRatio),
    oversized,
    confidence: getCropConfidence(areaRatio, widthRatio, heightRatio, visualType, Boolean(crop.pixelRefined)),
  };
}

export function isOversizedVisualCrop(areaRatio, widthRatio, heightRatio, visualType = "") {
  if (visualType === "table") {
    return areaRatio > 0.38 || heightRatio > 0.62;
  }
  if (visualType === "formula") {
    return areaRatio > 0.12 || heightRatio > 0.18;
  }
  if (visualType === "code") {
    return areaRatio > 0.2 || heightRatio > 0.36;
  }
  return areaRatio > 0.28 ||
    (widthRatio > 0.62 && heightRatio > 0.46) ||
    (widthRatio > 0.9 && heightRatio > 0.34);
}

export function getCropConfidence(areaRatio, widthRatio, heightRatio, visualType = "", pixelRefined = false) {
  if (isOversizedVisualCrop(areaRatio, widthRatio, heightRatio, visualType)) {
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

export function roundMetric(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}
