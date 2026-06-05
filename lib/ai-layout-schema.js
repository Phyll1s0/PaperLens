export const AI_LAYOUT_SCHEMA_VERSION = 1;

const REGION_TYPE_ALIASES = new Map([
  ["text", "paragraph"],
  ["body", "paragraph"],
  ["para", "paragraph"],
  ["section", "heading"],
  ["title", "heading"],
  ["image", "figure"],
  ["chart", "figure"],
  ["diagram", "figure"],
  ["equation", "formula"],
  ["math", "formula"],
  ["algorithm", "code"],
  ["listing", "code"],
  ["footer", "header-footer"],
  ["header", "header-footer"],
  ["page-header", "header-footer"],
  ["page-footer", "header-footer"],
  ["bibliography", "reference"],
  ["references", "reference"],
]);

const REGION_TYPES = new Set([
  "paragraph",
  "heading",
  "caption",
  "figure",
  "table",
  "formula",
  "code",
  "reference",
  "header-footer",
  "noise",
]);

const VISUAL_REGION_TYPES = new Set(["figure", "table", "formula", "code"]);

export function normalizeAiLayoutResult(payload, options = {}) {
  const warnings = [];
  const source = payload?.layout && typeof payload.layout === "object" ? payload.layout : payload || {};
  const sourcePages = normalizePageSpecs(options.pages || source.pageSpecs || source.pageDimensions || []);
  const pages = normalizeAiLayoutPages(source.pages || source.document?.pages || [], sourcePages, warnings);
  const pageMap = new Map(pages.map((page) => [page.pageNumber, page]));
  for (const page of sourcePages) {
    if (!pageMap.has(page.pageNumber)) {
      pages.push(page);
      pageMap.set(page.pageNumber, page);
    }
  }
  pages.sort((a, b) => a.pageNumber - b.pageNumber);

  const regions = normalizeAiLayoutRegions(source, pageMap, warnings);
  const paragraphs = normalizeAiLayoutParagraphs(source, regions, pageMap, warnings);
  const sections = normalizeAiLayoutSections(source.sections || source.structure?.sections || [], pageMap, warnings);
  const document = normalizeAiLayoutDocument(source, sections, pageMap);

  return {
    version: AI_LAYOUT_SCHEMA_VERSION,
    provider: String(source.provider || payload?.provider || options.provider || "ai-layout").trim() || "ai-layout",
    status: warnings.length ? "warn" : "ok",
    document,
    pages,
    sections,
    regions,
    paragraphs,
    visualRegions: extractVisualRegionsFromAiLayoutRegions(regions),
    diagnostics: {
      warnings,
      pageCount: pages.length,
      sectionCount: sections.length,
      regionCount: regions.length,
      paragraphCount: paragraphs.length,
      visualRegionCount: regions.filter((region) => VISUAL_REGION_TYPES.has(region.type)).length,
    },
  };
}

export function extractVisualRegionsFromAiLayout(layout) {
  const regions = Array.isArray(layout?.regions) ? layout.regions : Array.isArray(layout) ? layout : [];
  return extractVisualRegionsFromAiLayoutRegions(regions);
}

export function extractParagraphsFromAiLayout(layout) {
  if (!layout || typeof layout !== "object") {
    return [];
  }
  if (Array.isArray(layout.paragraphs)) {
    return layout.paragraphs.filter((paragraph) => paragraph?.text);
  }
  return [];
}

function normalizeAiLayoutDocument(source, sections, pageMap) {
  const pageNumbers = [...pageMap.keys()].sort((a, b) => a - b);
  const referencesStartPage = normalizePageNumber(
    source.referencesStartPage || source.structure?.referencesStartPage || source.document?.referencesStartPage,
    pageMap,
    null,
  );
  return {
    title: normalizeText(source.title || source.document?.title || ""),
    abstract: normalizeText(source.abstract || source.document?.abstract || ""),
    bodyStartPage: normalizePageNumber(source.bodyStartPage || source.structure?.bodyStartPage, pageMap, pageNumbers[0] || 1),
    referencesStartPage,
    bodyEndPage: normalizePageNumber(
      source.bodyEndPage || source.structure?.bodyEndPage,
      pageMap,
      referencesStartPage ? Math.max(pageNumbers[0] || 1, referencesStartPage - 1) : pageNumbers.at(-1) || 1,
    ),
    sectionTitles: sections.map((section) => section.title).filter(Boolean),
  };
}

function normalizeAiLayoutPages(pages, sourcePages, warnings) {
  const normalized = [];
  const sourcePageMap = new Map(sourcePages.map((page) => [page.pageNumber, page]));
  for (const page of Array.isArray(pages) ? pages : []) {
    const pageNumber = Number(page?.pageNumber || page?.page || page?.index || 0);
    if (!Number.isFinite(pageNumber) || pageNumber <= 0) {
      warnings.push("Dropped page with missing pageNumber.");
      continue;
    }
    const sourcePage = sourcePageMap.get(pageNumber) || {};
    normalized.push({
      pageNumber,
      width: positiveNumber(page?.width, sourcePage.width || null),
      height: positiveNumber(page?.height, sourcePage.height || null),
      rotation: clampNumber(page?.rotation, 0, 0, 360),
      imagePath: String(page?.imagePath || sourcePage.imagePath || "").trim(),
    });
  }
  return dedupeByPageNumber(normalized);
}

function normalizeAiLayoutRegions(source, pageMap, warnings) {
  const regions = [];
  const seenIds = new Set();
  const pageEntries = Array.isArray(source.pages) ? source.pages : [];
  for (const page of pageEntries) {
    const pageNumber = Number(page?.pageNumber || page?.page || page?.index || 0);
    const pageRegions = Array.isArray(page?.regions)
      ? page.regions
      : Array.isArray(page?.layoutRegions)
        ? page.layoutRegions
        : [];
    for (const region of pageRegions) {
      const normalized = normalizeAiLayoutRegion({ ...region, pageNumber: region?.pageNumber || pageNumber }, pageMap, seenIds, warnings);
      if (normalized) {
        regions.push(normalized);
      }
    }
  }

  const topLevelRegions = Array.isArray(source.regions) ? source.regions : Array.isArray(source.layoutRegions) ? source.layoutRegions : [];
  for (const region of topLevelRegions) {
    const normalized = normalizeAiLayoutRegion(region, pageMap, seenIds, warnings);
    if (normalized) {
      regions.push(normalized);
    }
  }

  return regions.sort(compareLayoutItems);
}

function normalizeAiLayoutRegion(region, pageMap, seenIds, warnings) {
  const pageNumber = normalizePageNumber(region?.pageNumber || region?.page, pageMap, null);
  if (!pageNumber) {
    warnings.push("Dropped region with missing or out-of-range pageNumber.");
    return null;
  }
  const type = normalizeRegionType(region?.type || region?.role || region?.kind);
  if (!REGION_TYPES.has(type)) {
    warnings.push(`Dropped region with unsupported type: ${String(region?.type || region?.role || region?.kind || "")}`);
    return null;
  }
  const page = pageMap.get(pageNumber) || {};
  const bbox = normalizeBbox(region, page, warnings);
  if (!bbox) {
    warnings.push(`Dropped ${type} region on page ${pageNumber} without a valid bbox.`);
    return null;
  }
  const id = uniqueId(String(region?.id || `${type}-p${pageNumber}-${Math.round(bbox.x)}-${Math.round(bbox.y)}`), seenIds);
  return {
    id,
    type,
    pageNumber,
    text: normalizeText(region?.text || region?.content || region?.caption || ""),
    label: normalizeText(region?.label || region?.title || ""),
    readingOrder: integerOrNull(region?.readingOrder ?? region?.order),
    sectionId: normalizeText(region?.sectionId || ""),
    confidence: normalizeConfidence(region?.confidence),
    bbox,
    source: "ai-layout",
  };
}

function normalizeAiLayoutParagraphs(source, regions, pageMap, warnings) {
  const seenIds = new Set();
  const candidates = Array.isArray(source.paragraphs)
    ? source.paragraphs
    : Array.isArray(source.readingOrder)
      ? source.readingOrder
      : [];
  const paragraphs = [];
  for (const paragraph of candidates) {
    const normalized = normalizeAiLayoutParagraph(paragraph, pageMap, seenIds, warnings);
    if (normalized) {
      paragraphs.push(normalized);
    }
  }

  if (!paragraphs.length) {
    for (const region of regions) {
      if (!["paragraph", "heading"].includes(region.type) || !region.text) {
        continue;
      }
      paragraphs.push({
        id: uniqueId(`p-${region.id}`, seenIds),
        type: region.type,
        text: region.text,
        pageNumber: region.pageNumber,
        bbox: region.bbox,
        sectionId: region.sectionId,
        readingOrder: region.readingOrder,
        confidence: region.confidence,
        sourceRegionId: region.id,
      });
    }
  }

  return paragraphs.sort(compareLayoutItems);
}

function normalizeAiLayoutParagraph(paragraph, pageMap, seenIds, warnings) {
  const text = normalizeText(paragraph?.text || paragraph?.content || "");
  if (!text) {
    warnings.push("Dropped paragraph candidate without text.");
    return null;
  }
  const pageNumber = normalizePageNumber(paragraph?.pageNumber || paragraph?.page, pageMap, null);
  if (!pageNumber) {
    warnings.push("Dropped paragraph candidate with missing or out-of-range pageNumber.");
    return null;
  }
  const bbox = normalizeBbox(paragraph, pageMap.get(pageNumber) || {}, warnings);
  return {
    id: uniqueId(String(paragraph?.id || `paragraph-p${pageNumber}-${seenIds.size + 1}`), seenIds),
    type: normalizeRegionType(paragraph?.type || paragraph?.role || "paragraph") === "heading" ? "heading" : "paragraph",
    text,
    pageNumber,
    bbox,
    sectionId: normalizeText(paragraph?.sectionId || ""),
    readingOrder: integerOrNull(paragraph?.readingOrder ?? paragraph?.order),
    confidence: normalizeConfidence(paragraph?.confidence),
    sourceRegionId: normalizeText(paragraph?.sourceRegionId || paragraph?.regionId || ""),
  };
}

function normalizeAiLayoutSections(sections, pageMap, warnings) {
  const seenIds = new Set();
  const normalized = [];
  for (const section of Array.isArray(sections) ? sections : []) {
    const title = normalizeText(section?.title || section?.heading || "");
    if (!title) {
      warnings.push("Dropped section without title.");
      continue;
    }
    const startPage = normalizePageNumber(section?.startPage || section?.pageNumber || section?.page, pageMap, null);
    if (!startPage) {
      warnings.push(`Dropped section without valid page: ${title}`);
      continue;
    }
    normalized.push({
      id: uniqueId(String(section?.id || slugify(title) || `section-${normalized.length + 1}`), seenIds),
      title,
      startPage,
      endPage: normalizePageNumber(section?.endPage, pageMap, startPage),
      level: clampNumber(section?.level, 1, 1, 6),
      confidence: normalizeConfidence(section?.confidence),
    });
  }
  return normalized.sort((a, b) => a.startPage - b.startPage || a.level - b.level || a.title.localeCompare(b.title));
}

function extractVisualRegionsFromAiLayoutRegions(regions) {
  return regions
    .filter((region) => VISUAL_REGION_TYPES.has(region.type))
    .map((region) => ({
      id: region.id,
      type: region.type,
      visualType: region.type,
      label: region.label,
      text: region.text,
      pageNumber: region.pageNumber,
      x: region.bbox.x,
      y: region.bbox.y,
      width: region.bbox.width,
      height: region.bbox.height,
      confidence: region.confidence,
      modelConfidence: region.confidence,
      source: "ai-layout",
      modelProvider: "ai-layout",
    }));
}

function normalizePageSpecs(pages) {
  return dedupeByPageNumber((Array.isArray(pages) ? pages : []).map((page) => {
    const pageNumber = Number(page?.pageNumber || page?.page || page?.index || 0);
    if (!Number.isFinite(pageNumber) || pageNumber <= 0) {
      return null;
    }
    return {
      pageNumber,
      width: positiveNumber(page?.width, null),
      height: positiveNumber(page?.height, null),
      rotation: clampNumber(page?.rotation, 0, 0, 360),
      imagePath: String(page?.imagePath || "").trim(),
    };
  }).filter(Boolean));
}

function dedupeByPageNumber(pages) {
  const map = new Map();
  for (const page of pages) {
    map.set(page.pageNumber, { ...(map.get(page.pageNumber) || {}), ...page });
  }
  return [...map.values()].sort((a, b) => a.pageNumber - b.pageNumber);
}

function normalizeRegionType(value) {
  const clean = String(value || "paragraph").trim().toLowerCase().replace(/[_\s]+/g, "-");
  return REGION_TYPE_ALIASES.get(clean) || clean;
}

function normalizeBbox(item, page, warnings) {
  const raw = Array.isArray(item?.bbox)
    ? { x: item.bbox[0], y: item.bbox[1], width: item.bbox[2], height: item.bbox[3] }
    : {
        x: item?.x ?? item?.left,
        y: item?.y ?? item?.top,
        width: item?.width ?? item?.w,
        height: item?.height ?? item?.h,
      };
  const x = Number(raw.x);
  const y = Number(raw.y);
  const width = Number(raw.width);
  const height = Number(raw.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return null;
  }
  const pageWidth = positiveNumber(page?.width, null);
  const pageHeight = positiveNumber(page?.height, null);
  const clampedX = pageWidth ? clampNumber(x, 0, 0, pageWidth) : x;
  const clampedY = pageHeight ? clampNumber(y, 0, 0, pageHeight) : y;
  const maxWidth = pageWidth ? Math.max(1, pageWidth - clampedX) : width;
  const maxHeight = pageHeight ? Math.max(1, pageHeight - clampedY) : height;
  const clampedWidth = pageWidth ? clampNumber(width, maxWidth, 1, maxWidth) : width;
  const clampedHeight = pageHeight ? clampNumber(height, maxHeight, 1, maxHeight) : height;
  if (pageWidth && (x !== clampedX || width !== clampedWidth)) {
    warnings.push("Clamped bbox horizontally to page bounds.");
  }
  if (pageHeight && (y !== clampedY || height !== clampedHeight)) {
    warnings.push("Clamped bbox vertically to page bounds.");
  }
  return {
    x: roundNumber(clampedX),
    y: roundNumber(clampedY),
    width: roundNumber(clampedWidth),
    height: roundNumber(clampedHeight),
  };
}

function normalizePageNumber(value, pageMap, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }
  const pageNumber = Math.trunc(number);
  if (pageMap.size && !pageMap.has(pageNumber)) {
    return fallback;
  }
  return pageNumber;
}

function normalizeConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }
  if (number > 1 && number <= 100) {
    return roundNumber(number / 100);
  }
  return roundNumber(clampNumber(number, 0, 0, 1));
}

function compareLayoutItems(a, b) {
  if (a.readingOrder != null && b.readingOrder != null && Number(a.readingOrder) !== Number(b.readingOrder)) {
    return Number(a.readingOrder) - Number(b.readingOrder);
  }
  if (a.readingOrder != null && b.readingOrder == null) {
    return -1;
  }
  if (a.readingOrder == null && b.readingOrder != null) {
    return 1;
  }
  if (a.pageNumber !== b.pageNumber) {
    return a.pageNumber - b.pageNumber;
  }
  const ay = Number(a.bbox?.y || 0);
  const by = Number(b.bbox?.y || 0);
  if (Math.abs(ay - by) > 2) {
    return ay - by;
  }
  return Number(a.bbox?.x || 0) - Number(b.bbox?.x || 0);
}

function uniqueId(base, seenIds) {
  const clean = slugify(base) || "item";
  if (!seenIds.has(clean)) {
    seenIds.add(clean);
    return clean;
  }
  let suffix = 2;
  while (seenIds.has(`${clean}-${suffix}`)) {
    suffix += 1;
  }
  const id = `${clean}-${suffix}`;
  seenIds.add(id);
  return id;
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

function integerOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function roundNumber(value) {
  return Math.round(Number(value) * 1000) / 1000;
}
