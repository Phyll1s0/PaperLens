import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import {
  classifyFormulaTextRole,
  isLikelyCaptionBlockText,
  isLikelyCodeBlockText,
  isLikelyFormulaBlockText,
  isLikelyTableBodyBlockText,
  isUsefulFormulaArtifactText,
} from "./artifact-classifier.js";
import {
  buildCropQuality,
  normalizeVisualCrop as normalizeCrop,
} from "./visual-crop-quality.js";
import {
  buildFormulaRenderFields,
} from "./formula-render-quality.js";
import {
  getVisualModelRegionsForPage,
} from "./visual-analysis-provider.js";

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.dirname(path.dirname(__filename));

export const ARTIFACT_CROP_VERSION = 11;
export const VISUAL_STRUCTURE_VERSION = 6;

const pagePixelCache = new Map();

export function enhancePagesWithVisualStructure(pages, options = {}) {
  return (pages || []).map((page) => {
    const modelRegions = getVisualModelRegionsForPage(page, options.visualAnalysisProvider);
    const visualRegions = inferPageVisualRegions(page, {
      ...options,
      modelRegions,
    });
    return {
      ...page,
      visualRegions,
      visualStructureVersion: VISUAL_STRUCTURE_VERSION,
      visualAnalysisProvider: options.visualAnalysisProvider?.provider || "heuristic",
    };
  });
}

export function extractPageArtifacts(pages, options = {}) {
  const artifacts = [];

  for (const page of pages) {
    const blocks = Array.isArray(page.blocks) ? page.blocks : [];
    blocks.forEach((block, index) => {
      const type = classifyPageArtifact(block);
      if (!type) {
        return;
      }

      const text = normalizeArtifactText(block.text);
      if (!text) {
        return;
      }

      const artifactId = `artifact_${page.pageNumber}_${index}`;
      const artifactFields = buildPageArtifactFields(page, block, type, index, options);
      artifacts.push({
        id: artifactId,
        type,
        pageNumber: page.pageNumber,
        text,
        x: block.x ?? null,
        y: block.y ?? null,
        width: block.width ?? null,
        height: block.height ?? null,
        lineCount: block.lineCount || 1,
        ...artifactFields,
      });

      if (type === "caption") {
        const splitRegions = getCaptionSplitVisualRegions(page, index);
        splitRegions.forEach((region, splitIndex) => {
          const splitFields = buildCaptionSplitArtifactFields(page, block, region, artifactId);
          if (!splitFields.crop) {
            return;
          }

          const splitText = buildSplitArtifactText(text, artifactFields.label, splitFields.label);
          artifacts.push({
            id: `${artifactId}_split_${region.splitIndex || splitIndex + 1}`,
            type,
            pageNumber: page.pageNumber,
            text: splitText || text,
            x: region.x ?? block.x ?? null,
            y: region.y ?? block.y ?? null,
            width: region.width ?? block.width ?? null,
            height: region.height ?? block.height ?? null,
            lineCount: block.lineCount || 1,
            ...splitFields,
          });
        });
      }
    });
    artifacts.push(...buildModelRegionArtifacts(page, artifacts));
  }

  return dedupePageArtifacts(artifacts).filter(isUsefulPageArtifact);
}

function buildModelRegionArtifacts(page, existingArtifacts = []) {
  if (!Array.isArray(page?.visualRegions) || !page.visualRegions.length) {
    return [];
  }

  const existingRegionIds = new Set(existingArtifacts
    .filter((artifact) => Number(artifact.pageNumber || 0) === Number(page.pageNumber || 0))
    .map((artifact) => artifact.visualRegionId)
    .filter(Boolean));

  return page.visualRegions
    .filter((region) =>
      String(region.source || "").startsWith("model") &&
        ["figure", "table", "formula", "code"].includes(region.visualType) &&
        !existingRegionIds.has(region.id))
    .map((region, index) => buildModelRegionArtifact(page, region, index))
    .filter(Boolean);
}

function buildModelRegionArtifact(page, region, index) {
  const crop = visualRegionToCrop(region);
  if (!crop) {
    return null;
  }

  const visualType = region.visualType || "figure";
  const type = visualType === "formula" || visualType === "code" ? visualType : "caption";
  const label = region.label || buildModelRegionLabel(visualType, index + 1);
  const cropQuality = region.cropQuality || buildCropQuality(crop, visualType);
  const artifact = {
    id: `artifact_${page.pageNumber}_model_${index + 1}`,
    type,
    pageNumber: page.pageNumber,
    text: label,
    x: region.x ?? null,
    y: region.y ?? null,
    width: region.width ?? null,
    height: region.height ?? null,
    lineCount: 1,
    label,
    visualType,
    visualRegionId: region.id || "",
    visualSource: region.source || "",
    modelGenerated: true,
    modelProvider: region.modelProvider || "",
    modelConfidence: region.modelConfidence ?? null,
    formulaRole: visualType === "formula" ? "display-formula" : "",
    formulaRoleReason: visualType === "formula" ? "model-provider" : "",
    cropVersion: ARTIFACT_CROP_VERSION,
    cropQuality,
    imagePath: page.imagePath || null,
    imageWidth: page.imageWidth || null,
    imageHeight: page.imageHeight || null,
    pageWidth: page.width || null,
    pageHeight: page.height || null,
    crop,
  };
  return {
    ...artifact,
    ...buildFormulaRenderFields(artifact),
  };
}

function buildModelRegionLabel(visualType, index) {
  if (visualType === "table") {
    return `Model table ${index}`;
  }
  if (visualType === "formula") {
    return `Model formula ${index}`;
  }
  if (visualType === "code") {
    return `Model code ${index}`;
  }
  return `Model figure ${index}`;
}

export function buildArtifactCropSvg(artifact, baseUrl = "", options = {}) {
  const crop = artifact.crop || {};
  const x = Number(crop.x);
  const y = Number(crop.y);
  const width = Number(crop.width);
  const height = Number(crop.height);
  const pageWidth = Number(crop.pageWidth || artifact.pageWidth);
  const pageHeight = Number(crop.pageHeight || artifact.pageHeight);
  if (![x, y, width, height, pageWidth, pageHeight].every(Number.isFinite) ||
    width <= 0 || height <= 0 || pageWidth <= 0 || pageHeight <= 0 || !artifact.imagePath) {
    return "";
  }

  const imageUrl = options.imageHref || toAbsolutePublicUrl(artifact.imagePath, baseUrl);
  const label = normalizeExportLine(artifact.label || artifact.visualType || artifact.type || "PaperLens crop");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${formatSvgNumber(width)}" height="${formatSvgNumber(height)}" viewBox="${formatSvgNumber(x)} ${formatSvgNumber(y)} ${formatSvgNumber(width)} ${formatSvgNumber(height)}" role="img" aria-label="${escapeXmlAttribute(label)}">`,
    `<title>${escapeXmlText(label)}</title>`,
    `<image href="${escapeXmlAttribute(imageUrl)}" x="0" y="0" width="${formatSvgNumber(pageWidth)}" height="${formatSvgNumber(pageHeight)}" preserveAspectRatio="none"/>`,
    "</svg>",
  ].join("\n");
}

export function classifyPageArtifact(block) {
  const text = normalizeArtifactText(block?.text || "");
  if (!text) {
    return "";
  }

  if (isLikelyCaptionBlockText(text)) {
    return "caption";
  }
  if (isLikelyCodeBlockText(text, block)) {
    return "code";
  }
  if (isLikelyFormulaBlockText(text, block)) {
    return "formula";
  }
  if (isLikelyFigureTextBlock(text, block)) {
    return "figure-text";
  }
  if (isLikelyTableBodyBlockText(text, block)) {
    return "figure-text";
  }

  return "";
}

export function isBlockCoveredByVisualStructure(block, page) {
  if (!page || !Array.isArray(page.visualRegions) || !page.visualRegions.length) {
    return false;
  }

  const box = pickBlockBox(block);
  if (!box) {
    return false;
  }

  return page.visualRegions.some((region) => {
    if (!["figure", "table", "formula", "code"].includes(region.visualType)) {
      return false;
    }

    const overlapRatio = boxOverlapRatio(box, region);
    const lowConfidenceOversized = region.cropQuality?.oversized && region.cropQuality?.confidence === "low";
    if (overlapRatio < (lowConfidenceOversized ? 0.72 : 0.58)) {
      return false;
    }

    if (region.visualType === "formula") {
      return isFormulaContinuationBlock(block.text || "", block);
    }
    if (region.visualType === "code") {
      return isCodeContinuationBlock(block.text || "", block);
    }
    if (isLikelyVisualCandidateBlock(block, region.visualType === "table")) {
      return true;
    }
    if (overlapRatio < 0.72) {
      return false;
    }

    return isLikelyEmbeddedVisualTextBlock(block.text || "", block, region);
  });
}

export function pickBlockBox(block) {
  if (!block) {
    return null;
  }

  const x = Number(block.x);
  const y = Number(block.y);
  const width = Number(block.width);
  const height = Number(block.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return null;
  }

  return { x, y, width, height };
}

export function normalizeArtifactText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractFormulaLabel(text) {
  const match = String(text || "").match(/(?:^|\s)\((\d+[a-z]?)\)\s*$/i);
  return match ? `Equation ${match[1]}` : "";
}

function inferPageVisualRegions(page, options = {}) {
  const blocks = Array.isArray(page.blocks) ? page.blocks : [];
  const regions = Array.isArray(options.modelRegions) ? [...options.modelRegions] : [];

  blocks.forEach((block, index) => {
    const type = classifyPageArtifact(block);
    if (!type) {
      return;
    }

    if (type === "caption") {
      const text = normalizeArtifactText(block.text || "");
      const label = extractArtifactLabel(text);
      const visualType = /^table\b/i.test(text) ? "table" : "figure";
      const crop = refineCropWithPagePixels(page, inferCaptionCrop(page, block, label), visualType, options);
      if (!crop) {
        return;
      }
      const cropQuality = buildCropQuality(crop, visualType);
      const region = {
        id: `visual_${page.pageNumber}_${index}`,
        source: "caption-anchor",
        visualType,
        label,
        captionBlockIndex: index,
        x: crop.x,
        y: crop.y,
        width: crop.width,
        height: crop.height,
        pageWidth: crop.pageWidth,
        pageHeight: crop.pageHeight,
        pixelRefined: Boolean(crop.pixelRefined),
        cropQuality,
      };
      regions.push(region);
      regions.push(...inferSplitVisualRegions(page, region, block, visualType, options));
      return;
    }

    if (type === "formula" || type === "code" || type === "figure-text") {
      const visualType = type === "figure-text" ? "figure" : type;
      const crop = refineCropWithPagePixels(page, inferBlockArtifactCrop(page, block, type), visualType, options);
      if (!crop) {
        return;
      }
      const cropQuality = buildCropQuality(crop, visualType);
      regions.push({
        id: `visual_${page.pageNumber}_${index}`,
        source: "block-cluster",
        visualType,
        label: type === "formula" ? extractFormulaLabel(block.text || "") : "",
        seedBlockIndex: index,
        x: crop.x,
        y: crop.y,
        width: crop.width,
        height: crop.height,
        pageWidth: crop.pageWidth,
        pageHeight: crop.pageHeight,
        pixelRefined: Boolean(crop.pixelRefined),
        cropQuality,
      });
    }
  });

  return dedupeVisualRegions(regions);
}

function dedupeVisualRegions(regions) {
  const result = [];
  for (const region of regions) {
    const duplicate = result.some((item) =>
      item.visualType === region.visualType &&
      item.captionBlockIndex === region.captionBlockIndex &&
      regionOverlapRatio(item, region) > 0.82);
    if (!duplicate) {
      result.push(region);
    }
  }

  return result.slice(0, 40);
}

function getCaptionSplitVisualRegions(page, captionBlockIndex) {
  if (!Array.isArray(page?.visualRegions)) {
    return [];
  }

  return page.visualRegions
    .filter((region) =>
      region?.source === "caption-split" &&
        Number(region.captionBlockIndex) === Number(captionBlockIndex) &&
        region.splitCandidate)
    .sort((a, b) => Number(a.splitIndex || 0) - Number(b.splitIndex || 0));
}

function buildPageArtifactFields(page, block, type, blockIndex = -1, options = {}) {
  if (type === "caption") {
    return buildCaptionArtifactFields(page, block, blockIndex, options);
  }

  if (type === "formula" || type === "code" || type === "figure-text") {
    return buildBlockArtifactFields(page, block, type, blockIndex, options);
  }

  return {};
}

function buildCaptionArtifactFields(page, captionBlock, blockIndex = -1, options = {}) {
  const text = normalizeArtifactText(captionBlock?.text || "");
  const label = extractArtifactLabel(text);
  const visualRegion = findVisualRegionForBlock(page, blockIndex, "caption-anchor");
  const visualType = /^table\b/i.test(text) ? "table" : "figure";
  const crop = visualRegionToCrop(visualRegion) ||
    refineCropWithPagePixels(page, inferCaptionCrop(page, captionBlock, label), visualType, options);

  return {
    label,
    visualType,
    visualRegionId: visualRegion?.id || "",
    visualSource: visualRegion?.source || "",
    cropVersion: ARTIFACT_CROP_VERSION,
    cropQuality: visualRegion?.cropQuality || buildCropQuality(crop, visualType),
    imagePath: page.imagePath || null,
    imageWidth: page.imageWidth || null,
    imageHeight: page.imageHeight || null,
    pageWidth: page.width || null,
    pageHeight: page.height || null,
    crop,
  };
}

function buildCaptionSplitArtifactFields(page, captionBlock, splitRegion, parentArtifactId) {
  const crop = visualRegionToCrop(splitRegion);
  const visualType = splitRegion?.visualType ||
    (/^table\b/i.test(captionBlock?.text || "") ? "table" : "figure");

  return {
    label: splitRegion?.label || "",
    visualType,
    visualRegionId: splitRegion?.id || "",
    visualSource: splitRegion?.source || "",
    parentArtifactId,
    parentVisualRegionId: splitRegion?.parentVisualRegionId || "",
    splitCandidate: true,
    splitIndex: Number(splitRegion?.splitIndex || 0) || null,
    splitCount: Number(splitRegion?.splitCount || 0) || null,
    splitOrientation: splitRegion?.splitOrientation || "",
    cropVersion: ARTIFACT_CROP_VERSION,
    cropQuality: splitRegion?.cropQuality || buildCropQuality(crop, visualType),
    imagePath: page.imagePath || null,
    imageWidth: page.imageWidth || null,
    imageHeight: page.imageHeight || null,
    pageWidth: page.width || null,
    pageHeight: page.height || null,
    crop,
  };
}

function buildBlockArtifactFields(page, block, type, blockIndex = -1, options = {}) {
  const text = normalizeArtifactText(block?.text || "");
  const visualRegion = findVisualRegionForBlock(page, blockIndex, "block-cluster");
  const crop = visualRegionToCrop(visualRegion) ||
    refineCropWithPagePixels(page, inferBlockArtifactCrop(page, block, type), type === "figure-text" ? "figure" : type, options);
  const formulaRole = type === "formula" ? classifyFormulaTextRole(text, block) : null;
  const cropQuality = visualRegion?.cropQuality || buildCropQuality(crop, type === "figure-text" ? "figure" : type);
  const fields = {
    label: type === "formula" ? extractFormulaLabel(text) : "",
    visualType: type,
    formulaRole: formulaRole?.role || "",
    formulaRoleReason: formulaRole?.reason || "",
    visualRegionId: visualRegion?.id || "",
    visualSource: visualRegion?.source || "",
    cropVersion: ARTIFACT_CROP_VERSION,
    cropQuality,
    imagePath: page.imagePath || null,
    imageWidth: page.imageWidth || null,
    imageHeight: page.imageHeight || null,
    pageWidth: page.width || null,
    pageHeight: page.height || null,
    crop,
  };

  return {
    ...fields,
    ...buildFormulaRenderFields({
      type,
      text,
      lineCount: block?.lineCount || 1,
      ...fields,
    }),
  };
}

function findVisualRegionForBlock(page, blockIndex, source) {
  if (!Array.isArray(page.visualRegions) || blockIndex < 0) {
    return null;
  }

  const key = source === "caption-anchor" ? "captionBlockIndex" : "seedBlockIndex";
  return page.visualRegions.find((region) => region.source === source && Number(region[key]) === blockIndex) || null;
}

function visualRegionToCrop(region) {
  if (!region) {
    return null;
  }

  const crop = normalizeCrop({
    x: Number(region.x),
    y: Number(region.y),
    width: Number(region.width),
    height: Number(region.height),
    pageWidth: Number(region.pageWidth),
    pageHeight: Number(region.pageHeight),
  });
  return {
    ...crop,
    pixelRefined: Boolean(region.pixelRefined),
  };
}

function extractArtifactLabel(text) {
  const match = String(text || "").match(/^(figure|fig\.|table)\s+(\d+[a-z]?)/i);
  if (!match) {
    return "";
  }

  const kind = /^table$/i.test(match[1]) ? "Table" : "Figure";
  return `${kind} ${match[2]}`;
}

function inferCaptionCrop(page, captionBlock, label) {
  const pageWidth = Number(page.width || 0);
  const pageHeight = Number(page.height || 0);
  if (!pageWidth || !pageHeight || !captionBlock) {
    return null;
  }

  const horizontal = inferVisualHorizontalBounds(page, captionBlock, pageWidth);
  const captionY = clampNumber(Number(captionBlock.y || 0), 0, pageHeight);
  const captionHeight = Math.max(1, Number(captionBlock.height || 0));
  const captionBottom = clampNumber(captionY + captionHeight, 0, pageHeight);
  const minHeight = Math.max(56, pageHeight * 0.08);
  const isTable = /^table\b/i.test(label) || /^table\b/i.test(captionBlock.text || "");
  if (isTable && captionBlock.lineCount >= 3 && Number(captionBlock.height || 0) > pageHeight * 0.06) {
    const tableBox = pickBlockBox(captionBlock);
    if (tableBox) {
      const paddingX = pageWidth * 0.014;
      const paddingY = pageHeight * 0.012;
      return normalizeCrop({
        x: tableBox.x - paddingX,
        y: tableBox.y - paddingY,
        width: tableBox.width + paddingX * 2,
        height: tableBox.height + paddingY * 2,
        pageWidth,
        pageHeight,
      });
    }
  }

  const candidateCrop = inferCandidateVisualCrop(page, captionBlock, horizontal, pageWidth, pageHeight, isTable);
  if (candidateCrop) {
    return candidateCrop;
  }

  let y;
  let bottom;
  if (isTable) {
    y = captionBlock.lineCount >= 3
      ? Math.max(0, captionY - pageHeight * 0.012)
      : Math.min(pageHeight, captionBottom + pageHeight * 0.006);
    bottom = findNextTextBoundary(page, captionBlock, horizontal, pageHeight) ||
      Math.min(pageHeight, captionBottom + pageHeight * 0.24);
    if (bottom - y < minHeight) {
      bottom = Math.min(pageHeight, captionBottom + pageHeight * 0.2);
    }
    const maxHeight = pageHeight * 0.34;
    if (bottom - y > maxHeight) {
      bottom = Math.min(bottom, y + maxHeight);
    }
  } else {
    bottom = Math.max(0, captionY - pageHeight * 0.006);
    y = findPreviousTextBoundary(page, captionBlock, horizontal) ||
      Math.max(0, captionY - pageHeight * 0.26);
    if (captionY - y < minHeight) {
      y = Math.max(0, captionY - pageHeight * 0.22);
    }
    const maxHeight = horizontal.width > pageWidth * 0.7 ? pageHeight * 0.42 : pageHeight * 0.32;
    if (bottom - y > maxHeight) {
      y = Math.max(0, bottom - maxHeight);
    }
  }

  return normalizeCrop({
    x: horizontal.x,
    y,
    width: horizontal.width,
    height: bottom - y,
    pageWidth,
    pageHeight,
  });
}

function inferCandidateVisualCrop(page, captionBlock, horizontal, pageWidth, pageHeight, isTable) {
  const candidates = getVisualCandidateBlocks(page, captionBlock, horizontal, pageHeight, isTable);
  if (!candidates.length) {
    return null;
  }

  const captionY = clampNumber(Number(captionBlock.y || 0), 0, pageHeight);
  const captionBottom = clampNumber(Number(captionBlock.y || 0) + Number(captionBlock.height || 0), 0, pageHeight);
  const bounds = getBlockBounds(candidates);
  if (!bounds) {
    return null;
  }

  const paddingX = pageWidth * 0.018;
  const paddingY = pageHeight * 0.014;
  const subfigureLabels = candidates.filter((block) => /^\([a-z]\)/i.test(normalizeArtifactText(block.text))).length;
  const yExpansion = !isTable && subfigureLabels >= 1
    ? Math.min(pageHeight * 0.22, Math.max(pageHeight * 0.14, bounds.height * 0.9))
    : 0;

  let x = bounds.x - paddingX;
  let y = bounds.y - paddingY - yExpansion;
  let right = bounds.x + bounds.width + paddingX;
  let bottom = bounds.y + bounds.height + paddingY;
  if (isTable) {
    if (captionBlock.lineCount >= 3 && Number(captionBlock.height || 0) > pageHeight * 0.06) {
      const captionBounds = pickBlockBox(captionBlock);
      if (captionBounds) {
        x = Math.min(x, captionBounds.x - paddingX);
        y = Math.min(y, captionBounds.y - paddingY);
        right = Math.max(right, captionBounds.x + captionBounds.width + paddingX);
        bottom = Math.max(bottom, captionBounds.y + captionBounds.height + paddingY);
      }
    } else {
      y = Math.min(pageHeight, captionBottom + pageHeight * 0.006);
    }

    const nextCaptionBoundary = findNextCaptionBoundary(page, captionBlock, horizontal, pageHeight);
    if (nextCaptionBoundary !== null) {
      bottom = Math.min(bottom, nextCaptionBoundary);
    }
  } else {
    bottom = Math.min(bottom, captionY - pageHeight * 0.006);
    const previousCaptionBoundary = findPreviousCaptionBoundary(page, captionBlock, horizontal);
    if (previousCaptionBoundary !== null) {
      y = Math.max(y, previousCaptionBoundary);
    }
  }

  return normalizeCrop({
    x,
    y,
    width: right - x,
    height: bottom - y,
    pageWidth,
    pageHeight,
  });
}

function inferSplitVisualRegions(page, parentRegion, captionBlock, visualType, options = {}) {
  if (!["figure", "table"].includes(visualType) || !shouldAttemptRegionSplit(parentRegion, visualType)) {
    return [];
  }

  const pixels = getPagePixelData(page, options);
  if (!pixels) {
    return [];
  }

  const pageWidth = Number(parentRegion.pageWidth || page.width || 0);
  const pageHeight = Number(parentRegion.pageHeight || page.height || 0);
  if (!pageWidth || !pageHeight) {
    return [];
  }

  const pixelRect = cropToPixelRect(parentRegion, pixels, pageWidth, pageHeight);
  if (!pixelRect) {
    return [];
  }

  const split = findBestPixelSplit(pixels, pixelRect, visualType);
  if (!split || split.parts.length < 2) {
    return [];
  }

  return split.parts.map((part, index) => {
    const crop = pixelRectToCrop(part.bounds, pixels, pageWidth, pageHeight);
    const cropQuality = {
      ...buildCropQuality(crop, visualType),
      splitCandidate: true,
      splitOrientation: split.orientation,
      parentOversized: Boolean(parentRegion.cropQuality?.oversized),
    };
    const splitIndex = index + 1;
    return {
      id: `${parentRegion.id}_split_${splitIndex}`,
      source: "caption-split",
      visualType,
      label: buildSplitArtifactLabel(parentRegion.label, visualType, splitIndex),
      captionBlockIndex: parentRegion.captionBlockIndex,
      parentVisualRegionId: parentRegion.id,
      splitCandidate: true,
      splitIndex,
      splitCount: split.parts.length,
      splitOrientation: split.orientation,
      x: crop.x,
      y: crop.y,
      width: crop.width,
      height: crop.height,
      pageWidth: crop.pageWidth,
      pageHeight: crop.pageHeight,
      pixelRefined: true,
      cropQuality,
    };
  });
}

function shouldAttemptRegionSplit(region, visualType) {
  if (!region || !Number(region.pageWidth) || !Number(region.pageHeight)) {
    return false;
  }

  const widthRatio = Number(region.width || 0) / Math.max(1, Number(region.pageWidth || 0));
  const heightRatio = Number(region.height || 0) / Math.max(1, Number(region.pageHeight || 0));
  if (visualType === "table") {
    return Boolean(region.cropQuality?.oversized) ||
      (widthRatio >= 0.42 && heightRatio >= 0.18);
  }

  return Boolean(region.cropQuality?.oversized) ||
    (widthRatio >= 0.42 && heightRatio >= 0.12) ||
    (widthRatio >= 0.3 && heightRatio >= 0.26);
}

function cropToPixelRect(crop, pixels, pageWidth, pageHeight) {
  const scaleX = pixels.width / pageWidth;
  const scaleY = pixels.height / pageHeight;
  const left = clampInteger(Math.floor(Number(crop.x || 0) * scaleX), 0, pixels.width - 1);
  const top = clampInteger(Math.floor(Number(crop.y || 0) * scaleY), 0, pixels.height - 1);
  const right = clampInteger(Math.ceil((Number(crop.x || 0) + Number(crop.width || 0)) * scaleX), left + 1, pixels.width);
  const bottom = clampInteger(Math.ceil((Number(crop.y || 0) + Number(crop.height || 0)) * scaleY), top + 1, pixels.height);
  if (right - left < 24 || bottom - top < 20) {
    return null;
  }

  return { left, top, right, bottom };
}

function pixelRectToCrop(rect, pixels, pageWidth, pageHeight) {
  const scaleX = pixels.width / pageWidth;
  const scaleY = pixels.height / pageHeight;
  return {
    ...normalizeCrop({
      x: rect.left / scaleX,
      y: rect.top / scaleY,
      width: (rect.right - rect.left) / scaleX,
      height: (rect.bottom - rect.top) / scaleY,
      pageWidth,
      pageHeight,
    }),
    pixelRefined: true,
  };
}

function findBestPixelSplit(pixels, rect, visualType) {
  const candidates = [];
  if (visualType !== "table") {
    const vertical = buildPixelSplitCandidate(pixels, rect, visualType, "vertical");
    if (vertical) {
      candidates.push(vertical);
    }
  }

  const horizontal = buildPixelSplitCandidate(pixels, rect, visualType, "horizontal");
  if (horizontal) {
    candidates.push(horizontal);
  }

  return candidates.sort((a, b) => b.score - a.score)[0] || null;
}

function buildPixelSplitCandidate(pixels, rect, visualType, orientation) {
  const length = orientation === "vertical" ? rect.right - rect.left : rect.bottom - rect.top;
  const otherLength = orientation === "vertical" ? rect.bottom - rect.top : rect.right - rect.left;
  const minGap = Math.max(10, Math.floor(length * (visualType === "table" ? 0.045 : 0.035)));
  const minSegment = Math.max(24, Math.floor(length * (visualType === "table" ? 0.24 : 0.18)));
  const edgeMargin = Math.max(8, Math.floor(length * 0.055));
  if (length < minSegment * 2 + minGap || otherLength < 24) {
    return null;
  }

  const profile = buildInkProjection(pixels, rect, orientation);
  const gaps = findProjectionGaps(profile, {
    maxInk: Math.max(1, Math.floor(otherLength * 0.006)),
    minGap,
    edgeMargin,
    minSegment,
  }).slice(0, 3);
  if (!gaps.length) {
    return null;
  }

  const parts = buildSplitPartsFromGaps(pixels, rect, gaps, orientation, visualType)
    .filter((part) => isMeaningfulSplitPart(part, rect, visualType, orientation));
  if (parts.length < 2 || parts.length > 4) {
    return null;
  }

  const baseInk = countInkInPixelRect(pixels, rect);
  const coveredInk = parts.reduce((sum, part) => sum + part.inkPixels, 0);
  const coverage = baseInk ? coveredInk / baseInk : 0;
  if (coverage < 0.62) {
    return null;
  }

  const areas = parts.map((part) =>
    Math.max(1, (part.bounds.right - part.bounds.left) * (part.bounds.bottom - part.bounds.top)));
  const balance = Math.min(...areas) / Math.max(...areas);
  if (balance < 0.16) {
    return null;
  }

  const strongestGapRatio = Math.max(...gaps.map((gap) => gap.width)) / Math.max(1, length);
  return {
    orientation,
    parts,
    score: parts.length * 8 + coverage * 5 + balance * 4 + strongestGapRatio * 12 -
      (orientation === "vertical" && visualType === "table" ? 6 : 0),
  };
}

function buildInkProjection(pixels, rect, orientation) {
  const length = orientation === "vertical" ? rect.right - rect.left : rect.bottom - rect.top;
  const profile = new Array(length).fill(0);
  for (let y = rect.top; y < rect.bottom; y += 1) {
    const rowOffset = y * pixels.rowBytes;
    for (let x = rect.left; x < rect.right; x += 1) {
      const offset = rowOffset + x * pixels.channels;
      if (!isInkPixel(pixels, offset)) {
        continue;
      }
      if (orientation === "vertical") {
        profile[x - rect.left] += 1;
      } else {
        profile[y - rect.top] += 1;
      }
    }
  }
  return profile;
}

function findProjectionGaps(profile, options = {}) {
  const gaps = [];
  let start = -1;
  for (let index = 0; index <= profile.length; index += 1) {
    const isGap = index < profile.length && profile[index] <= options.maxInk;
    if (isGap && start === -1) {
      start = index;
    }
    if ((!isGap || index === profile.length) && start !== -1) {
      const end = index;
      const width = end - start;
      if (width >= options.minGap &&
        start >= options.edgeMargin &&
        profile.length - end >= options.edgeMargin &&
        start >= options.minSegment &&
        profile.length - end >= options.minSegment) {
        gaps.push({ start, end, width });
      }
      start = -1;
    }
  }

  return gaps
    .sort((a, b) => b.width - a.width)
    .slice(0, 4)
    .sort((a, b) => a.start - b.start);
}

function buildSplitPartsFromGaps(pixels, rect, gaps, orientation, visualType) {
  const length = orientation === "vertical" ? rect.right - rect.left : rect.bottom - rect.top;
  const boundaries = [0, ...gaps.map((gap) => Math.round((gap.start + gap.end) / 2)), length]
    .filter((value, index, all) => index === 0 || value > all[index - 1]);
  const parts = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    const rawBounds = orientation === "vertical"
      ? { left: rect.left + start, top: rect.top, right: rect.left + end, bottom: rect.bottom }
      : { left: rect.left, top: rect.top + start, right: rect.right, bottom: rect.top + end };
    const inkBounds = refinePixelRectToInkBounds(pixels, rawBounds, visualType);
    if (inkBounds) {
      parts.push(inkBounds);
    }
  }
  return parts;
}

function refinePixelRectToInkBounds(pixels, rect, visualType) {
  let minX = rect.right;
  let minY = rect.bottom;
  let maxX = rect.left;
  let maxY = rect.top;
  let inkPixels = 0;
  for (let y = rect.top; y < rect.bottom; y += 1) {
    const rowOffset = y * pixels.rowBytes;
    for (let x = rect.left; x < rect.right; x += 1) {
      const offset = rowOffset + x * pixels.channels;
      if (!isInkPixel(pixels, offset)) {
        continue;
      }
      inkPixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (inkPixels < getMinimumInkPixels(visualType)) {
    return null;
  }

  const padding = getPixelRefinementPadding(visualType);
  return {
    bounds: {
      left: clampInteger(minX - padding.x, rect.left, rect.right - 1),
      top: clampInteger(minY - padding.y, rect.top, rect.bottom - 1),
      right: clampInteger(maxX + 1 + padding.x, minX + 1, rect.right),
      bottom: clampInteger(maxY + 1 + padding.y, minY + 1, rect.bottom),
    },
    inkPixels,
  };
}

function isMeaningfulSplitPart(part, parentRect, visualType, orientation) {
  const width = part.bounds.right - part.bounds.left;
  const height = part.bounds.bottom - part.bounds.top;
  const parentWidth = parentRect.right - parentRect.left;
  const parentHeight = parentRect.bottom - parentRect.top;
  if (width < 18 || height < 14 || part.inkPixels < getMinimumInkPixels(visualType) * 1.5) {
    return false;
  }

  if (orientation === "vertical") {
    return width >= parentWidth * 0.14 && height >= parentHeight * 0.32;
  }

  return width >= parentWidth * 0.36 && height >= parentHeight * (visualType === "table" ? 0.16 : 0.13);
}

function countInkInPixelRect(pixels, rect) {
  let count = 0;
  for (let y = rect.top; y < rect.bottom; y += 1) {
    const rowOffset = y * pixels.rowBytes;
    for (let x = rect.left; x < rect.right; x += 1) {
      if (isInkPixel(pixels, rowOffset + x * pixels.channels)) {
        count += 1;
      }
    }
  }
  return count;
}

function buildSplitArtifactLabel(parentLabel, visualType, index) {
  const clean = normalizeArtifactText(parentLabel || "");
  const suffix = index >= 1 && index <= 26 ? String.fromCharCode(96 + index) : String(index);
  const match = clean.match(/^(Figure|Table)\s+(\d+)$/i);
  if (match) {
    const kind = /^table$/i.test(match[1]) ? "Table" : "Figure";
    return `${kind} ${match[2]}${suffix}`;
  }

  if (clean) {
    return `${clean}.${index}`;
  }

  return visualType === "table" ? `Table candidate ${index}` : `Figure candidate ${index}`;
}

function buildSplitArtifactText(text, parentLabel, splitLabel) {
  const clean = normalizeArtifactText(text || "");
  if (!clean || !parentLabel || !splitLabel) {
    return clean;
  }

  const pattern = new RegExp(`^${escapeRegExp(parentLabel)}\\b`, "i");
  if (pattern.test(clean)) {
    return clean.replace(pattern, splitLabel);
  }

  return `${splitLabel}: ${clean}`;
}

function getVisualCandidateBlocks(page, captionBlock, horizontal, pageHeight, isTable) {
  const blocks = Array.isArray(page.blocks) ? page.blocks : [];
  const captionY = Number(captionBlock.y || 0);
  const captionBottom = Number(captionBlock.y || 0) + Number(captionBlock.height || 0);
  const captionColumn = Number(captionBlock.column || 0);
  const nextCaptionBoundary = isTable
    ? findNextCaptionBoundary(page, captionBlock, horizontal, pageHeight)
    : null;

  return blocks.filter((block) => {
    if (block === captionBlock || !pickBlockBox(block)) {
      return false;
    }
    if (!overlapsHorizontal(block, horizontal, 0.06)) {
      return false;
    }
    if (classifyPageArtifact(block) === "caption") {
      return false;
    }
    if (captionColumn && Number(block.column || 0) && Number(block.column || 0) !== captionColumn) {
      const blockWidth = Number(block.width || 0);
      if (blockWidth < horizontal.width * 0.45) {
        return false;
      }
    }

    const y = Number(block.y || 0);
    const bottom = y + Number(block.height || 0);
    if (isTable) {
      if (nextCaptionBoundary !== null && y >= nextCaptionBoundary) {
        return false;
      }
      if (y < captionY - pageHeight * 0.06 || y > captionBottom + pageHeight * 0.42) {
        return false;
      }
      return isLikelyVisualCandidateBlock(block, true);
    }

    if (bottom > captionY + 2 || bottom < captionY - pageHeight * 0.52) {
      return false;
    }
    return isLikelyVisualCandidateBlock(block, false);
  });
}

function isLikelyVisualCandidateBlock(block, isTable) {
  const text = normalizeArtifactText(block?.text || "");
  if (!text) {
    return false;
  }

  const type = classifyPageArtifact(block);
  if (type && type !== "caption") {
    return true;
  }
  if (/^\([a-z]\)/i.test(text)) {
    return true;
  }

  const lineCount = Number(block.lineCount || 1);
  const averageLineLength = text.length / Math.max(1, lineCount);
  if (isTable) {
    const numberTokens = (text.match(/\b\d+(?:[.,]\d+)*\b/g) || []).length;
    const tableHeader = /\b(dataset|granularity|mae|rmse|accuracy|method|model|total|average|avg|horizon|time series|time points)\b|#/i.test(text);
    const longSentence = /[A-Za-z][^.!?。！？]{45,}[.!?。！？]\s+[A-Z]/.test(text);
    if (longSentence) {
      return false;
    }
    if (numberTokens >= 2) {
      return true;
    }
    if (tableHeader && text.length <= 220 && averageLineLength <= 70) {
      return true;
    }
  }

  const sentenceLike = /[.!?。！？][)"'\]]?(\s|$)/.test(text);
  const visualTokens = /\b(input|output|query|token|patch|layer|request|engine|latency|throughput|summary|manager|task|code|model|dataset|mae|ett|flops)\b/i.test(text);
  return lineCount >= 2 && averageLineLength <= 48 && (visualTokens || !sentenceLike);
}

function isLikelyFigureTextBlock(text, block = {}) {
  const clean = normalizeArtifactText(text);
  if (/^[❶-❾①-⑨]\s*Step\s+\d+\s*:/i.test(clean)) {
    return true;
  }
  if (clean.length <= 90 && /\b(?:FP4|FP6|metadata|idx|val)\s*\[[^\]]+]/i.test(clean)) {
    return true;
  }

  const lineCount = Number(block.lineCount || 1);
  const averageLineLength = text.length / Math.max(1, lineCount);
  const diagramTokens = /\b(LLM|Query|Chunk|Task|Final|Summary|Checker|Architect|Engineer|Code|Message Passing|FP4|FP6|metadata|MUX|Buffer|Decode Unit|Quantization Engine|Encoding Unit|Comp\.|Packer|Lookup Table)\b/i.test(text);
  return lineCount >= 6 && averageLineLength < 34 && diagramTokens ||
    lineCount >= 2 && averageLineLength <= 42 && /\b(?:FP4|FP6|metadata|MUX|Buffer|Decode Unit|Comp\.|Packer|Lookup Table)\b/i.test(text);
}

function isUsefulPageArtifact(artifact) {
  if (artifact?.modelGenerated) {
    return true;
  }
  if (artifact?.type !== "formula") {
    return true;
  }
  return isUsefulFormulaArtifactText(artifact.text || "");
}

function dedupePageArtifacts(artifacts = []) {
  const result = [];
  for (const artifact of artifacts) {
    const existing = result.find((item) => areDuplicatePageArtifacts(item, artifact));
    if (existing) {
      mergePageArtifact(existing, artifact);
      continue;
    }
    result.push(artifact);
  }

  return result;
}

function areDuplicatePageArtifacts(a, b) {
  if (!a || !b || a.type !== b.type || Number(a.pageNumber || 0) !== Number(b.pageNumber || 0)) {
    return false;
  }
  if (a.visualRegionId && b.visualRegionId && a.visualRegionId === b.visualRegionId) {
    return true;
  }
  if (!a.crop || !b.crop) {
    return false;
  }

  return regionOverlapRatio(a.crop, b.crop) >= 0.92;
}

function mergePageArtifact(target, source) {
  target.text = mergeArtifactText(target.text, source.text);
  target.lineCount = Math.max(Number(target.lineCount || 1), Number(source.lineCount || 1));
  target.label = target.label || source.label || "";
  target.cropQuality = chooseBetterCropQuality(target.cropQuality, source.cropQuality);
  if (target.type === "formula") {
    Object.assign(target, buildFormulaRenderFields(target));
  }
}

function mergeArtifactText(a, b) {
  const parts = [];
  for (const value of [a, b]) {
    const clean = normalizeArtifactText(value);
    if (!clean || parts.some((item) => item === clean || item.includes(clean) || clean.includes(item))) {
      continue;
    }
    parts.push(clean);
  }

  return parts.join(" ").trim();
}

function chooseBetterCropQuality(a = {}, b = {}) {
  const rank = { high: 3, medium: 2, low: 1, unknown: 0 };
  const aRank = rank[a.confidence || "unknown"] ?? 0;
  const bRank = rank[b.confidence || "unknown"] ?? 0;
  return bRank > aRank ? b : a;
}

function inferBlockArtifactCrop(page, seedBlock, type) {
  const pageWidth = Number(page.width || 0);
  const pageHeight = Number(page.height || 0);
  const seedBox = pickBlockBox(seedBlock);
  if (!pageWidth || !pageHeight || !seedBox) {
    return null;
  }

  const blocks = getClusteredArtifactBlocks(page, seedBlock, type);
  const bounds = getBlockBounds(blocks.length ? blocks : [seedBlock]);
  if (!bounds) {
    return null;
  }

  const paddingX = type === "code" ? pageWidth * 0.014 : pageWidth * 0.02;
  const paddingY = type === "code" ? pageHeight * 0.012 : pageHeight * 0.014;
  return normalizeCrop({
    x: bounds.x - paddingX,
    y: bounds.y - paddingY,
    width: bounds.width + paddingX * 2,
    height: bounds.height + paddingY * 2,
    pageWidth,
    pageHeight,
  });
}

function getClusteredArtifactBlocks(page, seedBlock, type) {
  const blocks = Array.isArray(page.blocks) ? page.blocks : [];
  const seedBox = pickBlockBox(seedBlock);
  const pageHeight = Number(page.height || 0) || 792;
  if (!seedBox) {
    return [seedBlock].filter(Boolean);
  }

  const maxGap = type === "formula" ? pageHeight * 0.028 : pageHeight * 0.04;
  const seedHorizontal = {
    x: seedBox.x - Math.max(seedBox.width * 0.08, 12),
    width: seedBox.width + Math.max(seedBox.width * 0.16, 24),
  };

  const cluster = [seedBlock];
  let bounds = seedBox;
  let changed = true;
  while (changed) {
    changed = false;
    for (const block of blocks) {
      if (cluster.includes(block) || !isCompatibleArtifactClusterBlock(block, type)) {
        continue;
      }

      const box = pickBlockBox(block);
      if (!box || !overlapsHorizontal(block, seedHorizontal, type === "formula" ? 0.08 : 0.24)) {
        continue;
      }
      if (getVerticalGap(bounds, box) > maxGap) {
        continue;
      }

      cluster.push(block);
      bounds = mergeBoxes(bounds, box);
      changed = true;
    }
  }

  return cluster;
}

function isCompatibleArtifactClusterBlock(block, type) {
  const text = normalizeArtifactText(block?.text || "");
  if (!text) {
    return false;
  }

  const blockType = classifyPageArtifact(block);
  if (blockType === type) {
    return true;
  }
  if (blockType) {
    return false;
  }
  if (type === "formula") {
    return isEquationNumberBlock(text) || isFormulaContinuationBlock(text, block);
  }
  if (type === "code") {
    return isCodeContinuationBlock(text, block);
  }

  return false;
}

function isEquationNumberBlock(text) {
  return /^\(?\d+[a-z]?\)?$/i.test(String(text || "").trim());
}

function isFormulaContinuationBlock(text, block = {}) {
  const lineCount = Number(block.lineCount || 1);
  const mathTokens = (text.match(/[=≤≥≠≈∑∏∫√∞→←↔±×÷∂λμσγαβθΩΔ]|\b(log|exp|min|max)\b/gi) || []).length;
  return lineCount <= 3 && text.length <= 180 && mathTokens >= 1 && !/[.!?。！？].{8,}/.test(text);
}

function isCodeContinuationBlock(text, block = {}) {
  const lineCount = Number(block.lineCount || 1);
  const codeSymbols = (text.match(/[{}\[\]();=<>]|=>|::/g) || []).length;
  const codeWords = (text.match(/\b(return|await|async|for|while|if|else|try|catch|throw|yield|print|self|this)\b/gi) || []).length;
  return text.length <= 1400 && (lineCount >= 2 || codeSymbols >= 3 || codeWords >= 2);
}

function isLikelyEmbeddedVisualTextBlock(text, block = {}, region = {}) {
  const clean = normalizeArtifactText(text);
  if (!clean || isLikelyCaptionBlockText(clean)) {
    return false;
  }

  const lineCount = Number(block.lineCount || 1);
  const averageLineLength = clean.length / Math.max(1, lineCount);
  const sentenceCount = (clean.match(/[.!?。！？]/g) || []).length;
  if (clean.length > 320 || sentenceCount >= 2 || averageLineLength > 82) {
    return false;
  }
  if (/^\([a-z]\)\s*/i.test(clean)) {
    return true;
  }
  if (region.visualType === "table") {
    const numberTokens = (clean.match(/\b\d+(?:[.,]\d+)*%?\b/g) || []).length;
    const tableTokens = /\b(dataset|granularity|method|model|metric|mae|mse|rmse|accuracy|precision|recall|total|average|avg|horizon|baseline|ours)\b|#/i.test(clean);
    return numberTokens >= 2 || (tableTokens && lineCount <= 5 && averageLineLength <= 72);
  }

  const diagramTokens = (clean.match(/\b(?:input|output|query|chunk|task|agent|model|token|layer|encoder|decoder|prompt|summary|code|step|final|manager|worker|score|loss)\b/gi) || []).length;
  const operatorTokens = (clean.match(/[→←↔=+\-*/]|=>|::/g) || []).length;
  const shortLabel = clean.length <= 90 && lineCount <= 3 && sentenceCount === 0;
  return (shortLabel && (diagramTokens >= 1 || operatorTokens >= 1)) ||
    (lineCount >= 2 && averageLineLength <= 46 && diagramTokens >= 2 && sentenceCount <= 1);
}

function refineCropWithPagePixels(page, crop, visualType = "", options = {}) {
  if (!crop || !page?.imagePath) {
    return crop;
  }

  const normalized = normalizeCrop(crop);
  const pageWidth = Number(normalized.pageWidth || page.width || 0);
  const pageHeight = Number(normalized.pageHeight || page.height || 0);
  if (!pageWidth || !pageHeight) {
    return normalized;
  }

  const pixels = getPagePixelData(page, options);
  if (!pixels) {
    return normalized;
  }

  const scaleX = pixels.width / pageWidth;
  const scaleY = pixels.height / pageHeight;
  const left = clampInteger(Math.floor(normalized.x * scaleX), 0, pixels.width - 1);
  const top = clampInteger(Math.floor(normalized.y * scaleY), 0, pixels.height - 1);
  const right = clampInteger(Math.ceil((normalized.x + normalized.width) * scaleX), left + 1, pixels.width);
  const bottom = clampInteger(Math.ceil((normalized.y + normalized.height) * scaleY), top + 1, pixels.height);

  let minX = right;
  let minY = bottom;
  let maxX = left;
  let maxY = top;
  let inkPixels = 0;
  for (let y = top; y < bottom; y += 1) {
    const rowOffset = y * pixels.rowBytes;
    for (let x = left; x < right; x += 1) {
      const offset = rowOffset + x * pixels.channels;
      if (!isInkPixel(pixels, offset)) {
        continue;
      }

      inkPixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (inkPixels < getMinimumInkPixels(visualType)) {
    return normalized;
  }

  const padding = getPixelRefinementPadding(visualType);
  const refinedLeft = clampInteger(minX - padding.x, left, right - 1);
  const refinedTop = clampInteger(minY - padding.y, top, bottom - 1);
  const refinedRight = clampInteger(maxX + 1 + padding.x, refinedLeft + 1, right);
  const refinedBottom = clampInteger(maxY + 1 + padding.y, refinedTop + 1, bottom);
  const refined = normalizeCrop({
    x: refinedLeft / scaleX,
    y: refinedTop / scaleY,
    width: (refinedRight - refinedLeft) / scaleX,
    height: (refinedBottom - refinedTop) / scaleY,
    pageWidth,
    pageHeight,
  });

  if (!shouldAcceptPixelRefinement(normalized, refined, visualType, inkPixels)) {
    return normalized;
  }

  return {
    ...refined,
    pixelRefined: true,
  };
}

function getPagePixelData(page, options = {}) {
  const filePath = getAssetPathFromPublicPath(page?.imagePath, options);
  if (!filePath) {
    return null;
  }
  if (pagePixelCache.has(filePath)) {
    return pagePixelCache.get(filePath);
  }

  let pixels = null;
  try {
    pixels = decodePng(readFileSync(filePath));
  } catch {
    pixels = null;
  }

  if (pagePixelCache.size > 24) {
    pagePixelCache.clear();
  }
  pagePixelCache.set(filePath, pixels);
  return pixels;
}

function getAssetPathFromPublicPath(publicPath, options = {}) {
  if (typeof options.resolveAssetPath === "function") {
    return options.resolveAssetPath(publicPath) || "";
  }

  let value = "";
  try {
    value = decodeURIComponent(String(publicPath || ""));
  } catch {
    return "";
  }
  if (!value || value.includes("\0") || value.includes("..")) {
    return "";
  }

  const assetDir = options.assetDir || path.join(ROOT_DIR, "paper-assets");
  const configuredBase = normalizePublicBase(options.assetPublicBase || "/assets");
  const fallbackBase = normalizePublicBase("/assets");
  let relativePath = "";
  for (const base of [configuredBase, fallbackBase]) {
    if (value.startsWith(base)) {
      relativePath = value.slice(base.length);
      break;
    }
  }
  if (!relativePath) {
    return "";
  }

  const normalized = path.normalize(path.join(assetDir, relativePath));
  return normalized.startsWith(`${assetDir}${path.sep}`) ? normalized : "";
}

function normalizePublicBase(value) {
  return `/${String(value || "assets").replace(/^\/+|\/+$/g, "")}/`;
}

function decodePng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33 ||
    buffer.readUInt32BE(0) !== 0x89504e47 || buffer.readUInt32BE(4) !== 0x0d0a1a0a) {
    return null;
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let palette = null;
  let transparency = null;
  const idatChunks = [];

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) {
      return null;
    }

    if (type === "IHDR") {
      width = buffer.readUInt32BE(dataStart);
      height = buffer.readUInt32BE(dataStart + 4);
      bitDepth = buffer[dataStart + 8];
      colorType = buffer[dataStart + 9];
    } else if (type === "PLTE") {
      palette = buffer.subarray(dataStart, dataEnd);
    } else if (type === "tRNS") {
      transparency = buffer.subarray(dataStart, dataEnd);
    } else if (type === "IDAT") {
      idatChunks.push(buffer.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      break;
    }

    offset = dataEnd + 4;
  }

  const channels = getPngChannelCount(colorType);
  if (!width || !height || bitDepth !== 8 || !channels || !idatChunks.length) {
    return null;
  }

  const rowBytes = width * channels;
  const raw = inflateSync(Buffer.concat(idatChunks));
  const data = new Uint8Array(height * rowBytes);
  let rawOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset];
    rawOffset += 1;
    const rowStart = y * rowBytes;
    const prevRowStart = y > 0 ? rowStart - rowBytes : -1;
    for (let x = 0; x < rowBytes; x += 1) {
      const rawValue = raw[rawOffset + x];
      const left = x >= channels ? data[rowStart + x - channels] : 0;
      const up = prevRowStart >= 0 ? data[prevRowStart + x] : 0;
      const upLeft = prevRowStart >= 0 && x >= channels ? data[prevRowStart + x - channels] : 0;
      data[rowStart + x] = unfilterPngByte(filter, rawValue, left, up, upLeft);
    }
    rawOffset += rowBytes;
  }

  return {
    width,
    height,
    colorType,
    channels,
    rowBytes,
    data,
    palette,
    transparency,
  };
}

function getPngChannelCount(colorType) {
  if (colorType === 0 || colorType === 3) {
    return 1;
  }
  if (colorType === 2) {
    return 3;
  }
  if (colorType === 4) {
    return 2;
  }
  if (colorType === 6) {
    return 4;
  }
  return 0;
}

function unfilterPngByte(filter, value, left, up, upLeft) {
  if (filter === 0) {
    return value;
  }
  if (filter === 1) {
    return (value + left) & 0xff;
  }
  if (filter === 2) {
    return (value + up) & 0xff;
  }
  if (filter === 3) {
    return (value + Math.floor((left + up) / 2)) & 0xff;
  }
  if (filter === 4) {
    return (value + paethPredictor(left, up, upLeft)) & 0xff;
  }
  return value;
}

function paethPredictor(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const distanceLeft = Math.abs(estimate - left);
  const distanceUp = Math.abs(estimate - up);
  const distanceUpLeft = Math.abs(estimate - upLeft);
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) {
    return left;
  }
  return distanceUp <= distanceUpLeft ? up : upLeft;
}

function isInkPixel(pixels, offset) {
  let red = 255;
  let green = 255;
  let blue = 255;
  let alpha = 255;
  if (pixels.colorType === 0) {
    red = green = blue = pixels.data[offset];
  } else if (pixels.colorType === 2) {
    red = pixels.data[offset];
    green = pixels.data[offset + 1];
    blue = pixels.data[offset + 2];
  } else if (pixels.colorType === 3) {
    const paletteIndex = pixels.data[offset];
    const paletteOffset = paletteIndex * 3;
    if (!pixels.palette || paletteOffset + 2 >= pixels.palette.length) {
      return false;
    }
    red = pixels.palette[paletteOffset];
    green = pixels.palette[paletteOffset + 1];
    blue = pixels.palette[paletteOffset + 2];
    alpha = pixels.transparency?.[paletteIndex] ?? 255;
  } else if (pixels.colorType === 4) {
    red = green = blue = pixels.data[offset];
    alpha = pixels.data[offset + 1];
  } else if (pixels.colorType === 6) {
    red = pixels.data[offset];
    green = pixels.data[offset + 1];
    blue = pixels.data[offset + 2];
    alpha = pixels.data[offset + 3];
  }

  if (alpha < 16) {
    return false;
  }

  const maxChannel = Math.max(red, green, blue);
  const minChannel = Math.min(red, green, blue);
  return maxChannel < 246 || maxChannel - minChannel > 18;
}

function getMinimumInkPixels(visualType) {
  if (visualType === "formula") {
    return 12;
  }
  if (visualType === "code") {
    return 28;
  }
  return 48;
}

function getPixelRefinementPadding(visualType) {
  if (visualType === "formula") {
    return { x: 8, y: 6 };
  }
  if (visualType === "code") {
    return { x: 10, y: 8 };
  }
  if (visualType === "table") {
    return { x: 14, y: 12 };
  }
  return { x: 12, y: 10 };
}

function shouldAcceptPixelRefinement(original, refined, visualType, inkPixels) {
  const area = Math.max(1, original.width * original.height);
  const refinedArea = Math.max(1, refined.width * refined.height);
  const widthRatio = refined.width / Math.max(1, original.width);
  const heightRatio = refined.height / Math.max(1, original.height);
  const inkDensity = inkPixels / area;
  if (refined.width < 4 || refined.height < 4) {
    return false;
  }
  if (visualType === "formula") {
    return widthRatio >= 0.04 && heightRatio >= 0.035 && inkDensity >= 0.0002;
  }
  if (visualType === "code") {
    return widthRatio >= 0.08 && heightRatio >= 0.05 && inkDensity >= 0.00035;
  }
  if (visualType === "table") {
    return widthRatio >= 0.18 && heightRatio >= 0.08 && refinedArea >= area * 0.015;
  }
  return widthRatio >= 0.12 && heightRatio >= 0.08 && refinedArea >= area * 0.012;
}

function getBlockBounds(blocks) {
  const boxes = blocks.map(pickBlockBox).filter(Boolean);
  if (!boxes.length) {
    return null;
  }

  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

function inferVisualHorizontalBounds(page, captionBlock, pageWidth) {
  const blocks = Array.isArray(page.blocks) ? page.blocks : [];
  const content = getContentBounds(blocks, pageWidth);
  const captionColumn = Number(captionBlock.column || 0);
  const captionBox = pickBlockBox(captionBlock);
  if (captionColumn === 1 || captionColumn === 2) {
    const columnBlocks = blocks.filter((block) => Number(block.column || 0) === captionColumn);
    const columnBounds = getContentBounds(columnBlocks, pageWidth);
    return expandHorizontalBounds(columnBounds, pageWidth, pageWidth * 0.015);
  }

  if (captionBox) {
    const captionCenter = captionBox.x + captionBox.width / 2;
    const contentCenter = content.x + content.width / 2;
    const looksSingleColumnCaption = captionBox.width < content.width * 0.58 ||
      (captionBox.width < content.width * 0.68 && Number(captionBlock.lineCount || 1) <= 3);
    if (looksSingleColumnCaption) {
      const inferredColumn = captionCenter < contentCenter ? 1 : 2;
      const columnBlocks = getLikelyColumnBlocks(blocks, content, inferredColumn);
      const columnBounds = getContentBounds(columnBlocks, pageWidth);
      return expandHorizontalBounds(columnBounds, pageWidth, pageWidth * 0.015);
    }
  }

  return expandHorizontalBounds(content, pageWidth, pageWidth * 0.02);
}

function getLikelyColumnBlocks(blocks, content, column) {
  const midpoint = content.x + content.width / 2;
  const explicit = blocks.filter((block) => Number(block.column || 0) === column);
  if (explicit.length >= 3) {
    return explicit;
  }

  const inferred = blocks.filter((block) => {
    const box = pickBlockBox(block);
    if (!box) {
      return false;
    }

    const center = box.x + box.width / 2;
    return column === 1 ? center < midpoint : center >= midpoint;
  });
  return inferred.length ? inferred : blocks;
}

function getContentBounds(blocks, pageWidth) {
  const valid = blocks
    .map(pickBlockBox)
    .filter((box) => box && box.width > 0);
  if (!valid.length) {
    return {
      x: pageWidth * 0.06,
      width: pageWidth * 0.88,
    };
  }

  const minX = Math.min(...valid.map((box) => box.x));
  const maxX = Math.max(...valid.map((box) => box.x + box.width));
  return {
    x: clampNumber(minX, 0, pageWidth),
    width: clampNumber(maxX - minX, pageWidth * 0.18, pageWidth),
  };
}

function expandHorizontalBounds(bounds, pageWidth, padding) {
  const x = clampNumber(bounds.x - padding, 0, pageWidth);
  const right = clampNumber(bounds.x + bounds.width + padding, 0, pageWidth);
  return {
    x,
    width: Math.max(1, right - x),
  };
}

function findPreviousTextBoundary(page, captionBlock, horizontal) {
  const captionY = Number(captionBlock.y || 0);
  const regularAbove = getRegularBoundaryBlocks(page, captionBlock, horizontal)
    .filter((block) => Number(block.y || 0) + Number(block.height || 0) <= captionY)
    .sort((a, b) => (Number(b.y || 0) + Number(b.height || 0)) - (Number(a.y || 0) + Number(a.height || 0)));
  const boundary = regularAbove[0];
  return boundary ? Number(boundary.y || 0) + Number(boundary.height || 0) + 4 : null;
}

function findNextTextBoundary(page, captionBlock, horizontal, pageHeight) {
  const captionBottom = Number(captionBlock.y || 0) + Number(captionBlock.height || 0);
  const regularBelow = getRegularBoundaryBlocks(page, captionBlock, horizontal)
    .filter((block) => Number(block.y || 0) >= captionBottom)
    .sort((a, b) => Number(a.y || 0) - Number(b.y || 0));
  const boundary = regularBelow[0];
  return boundary ? clampNumber(Number(boundary.y || 0) - 4, captionBottom, pageHeight) : null;
}

function findPreviousCaptionBoundary(page, captionBlock, horizontal) {
  const captionY = Number(captionBlock.y || 0);
  const captionsAbove = getNeighborCaptionBlocks(page, captionBlock, horizontal)
    .filter((block) => Number(block.y || 0) + Number(block.height || 0) <= captionY)
    .sort((a, b) => (Number(b.y || 0) + Number(b.height || 0)) - (Number(a.y || 0) + Number(a.height || 0)));
  const boundary = captionsAbove[0];
  return boundary ? Number(boundary.y || 0) + Number(boundary.height || 0) + 4 : null;
}

function findNextCaptionBoundary(page, captionBlock, horizontal, pageHeight) {
  const captionBottom = Number(captionBlock.y || 0) + Number(captionBlock.height || 0);
  const captionsBelow = getNeighborCaptionBlocks(page, captionBlock, horizontal)
    .filter((block) => Number(block.y || 0) >= captionBottom)
    .sort((a, b) => Number(a.y || 0) - Number(b.y || 0));
  const boundary = captionsBelow[0];
  return boundary ? clampNumber(Number(boundary.y || 0) - 4, captionBottom, pageHeight) : null;
}

function getNeighborCaptionBlocks(page, captionBlock, horizontal) {
  const blocks = Array.isArray(page.blocks) ? page.blocks : [];
  return blocks.filter((block) => {
    if (block === captionBlock) {
      return false;
    }
    return classifyPageArtifact(block) === "caption" && overlapsHorizontal(block, horizontal, 0.04);
  });
}

function getRegularBoundaryBlocks(page, captionBlock, horizontal) {
  const blocks = Array.isArray(page.blocks) ? page.blocks : [];
  return blocks.filter((block) => {
    if (block === captionBlock || !overlapsHorizontal(block, horizontal) || classifyPageArtifact(block)) {
      return false;
    }

    const text = normalizeArtifactText(block.text || "");
    return text.length >= 45 && /[.!?。！？]/.test(text);
  });
}

function overlapsHorizontal(block, horizontal, ratio = 0.18) {
  const box = pickBlockBox(block);
  if (!box) {
    return false;
  }

  const left = Math.max(box.x, horizontal.x);
  const right = Math.min(box.x + box.width, horizontal.x + horizontal.width);
  return right - left > Math.min(box.width, horizontal.width) * ratio;
}

function getVerticalGap(a, b) {
  const aBottom = a.y + a.height;
  const bBottom = b.y + b.height;
  if (b.y > aBottom) {
    return b.y - aBottom;
  }
  if (a.y > bBottom) {
    return a.y - bBottom;
  }
  return 0;
}

function mergeBoxes(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

function boxOverlapRatio(a, b) {
  const left = Math.max(Number(a.x || 0), Number(b.x || 0));
  const top = Math.max(Number(a.y || 0), Number(b.y || 0));
  const right = Math.min(Number(a.x || 0) + Number(a.width || 0), Number(b.x || 0) + Number(b.width || 0));
  const bottom = Math.min(Number(a.y || 0) + Number(a.height || 0), Number(b.y || 0) + Number(b.height || 0));
  const overlap = Math.max(0, right - left) * Math.max(0, bottom - top);
  const area = Math.max(1, Number(a.width || 0) * Number(a.height || 0));
  return overlap / area;
}

function regionOverlapRatio(a, b) {
  const overlapA = boxOverlapRatio(a, b);
  const overlapB = boxOverlapRatio(b, a);
  return Math.min(overlapA, overlapB);
}

function clampInteger(value, min, max) {
  return Math.trunc(clampNumber(value, min, max));
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toAbsolutePublicUrl(value, baseUrl = "") {
  const url = String(value || "");
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  const prefix = String(baseUrl || "").replace(/\/+$/, "");
  return `${prefix}${url.startsWith("/") ? url : `/${url}`}`;
}

function formatSvgNumber(value) {
  return Number(value).toFixed(3).replace(/\.?0+$/, "");
}

function normalizeExportLine(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function escapeXmlText(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeXmlAttribute(text) {
  return escapeXmlText(text)
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
