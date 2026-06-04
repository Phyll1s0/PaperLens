export function getPageRangeBoundsFromPages(pages = []) {
  const numbers = pages
    .map((page) => Number(page?.pageNumber))
    .filter((number) => Number.isFinite(number) && number > 0);
  if (!numbers.length) {
    return { startPage: 1, endPage: 1 };
  }

  return {
    startPage: Math.min(...numbers),
    endPage: Math.max(...numbers),
  };
}

export function formatChunkPageRange(pages = []) {
  const { startPage, endPage } = getPageRangeBoundsFromPages(pages);
  return startPage === endPage ? `p.${startPage}` : `p.${startPage}-${endPage}`;
}

export function normalizeTargetPageRange(range) {
  if (Array.isArray(range)) {
    return getPageRangeBoundsFromPages(range);
  }

  const startPage = Number(range?.startPage ?? range?.pageNumber ?? range?.start);
  const endPage = Number(range?.endPage ?? range?.pageEndNumber ?? range?.end ?? startPage);
  if (!Number.isFinite(startPage) || startPage <= 0) {
    return null;
  }

  return {
    startPage: Math.trunc(startPage),
    endPage: Math.max(Math.trunc(startPage), Math.trunc(Number.isFinite(endPage) && endPage > 0 ? endPage : startPage)),
  };
}

export function paragraphOverlapsAnyRange(paragraph, targetRanges = []) {
  const startPage = Number(paragraph?.pageNumber || 0);
  const endPage = Number(paragraph?.pageEndNumber || paragraph?.pageNumber || 0);
  if (!Number.isFinite(startPage) || startPage <= 0 || !Number.isFinite(endPage) || endPage <= 0) {
    return false;
  }

  return targetRanges.some((range) => {
    const normalized = normalizeTargetPageRange(range);
    return normalized && startPage <= normalized.endPage && endPage >= normalized.startPage;
  });
}

export function mergeRetriedChunkParagraphs(existingParagraphs = [], retriedParagraphs = [], targetRanges = []) {
  const normalizedRanges = targetRanges
    .map(normalizeTargetPageRange)
    .filter(Boolean);
  if (!normalizedRanges.length) {
    return existingParagraphs.map((paragraph, index) => ({ ...paragraph, order: index }));
  }

  const kept = existingParagraphs
    .filter((paragraph) => !paragraphOverlapsAnyRange(paragraph, normalizedRanges))
    .map((paragraph, index) => ({
      ...paragraph,
      __paperLensSortOrder: Number.isFinite(Number(paragraph.order)) ? Number(paragraph.order) : index,
    }));
  const inserted = retriedParagraphs.map((paragraph, index) => ({
    ...paragraph,
    __paperLensSortOrder: Number.isFinite(Number(paragraph.order)) ? Number(paragraph.order) : index,
  }));

  return [...kept, ...inserted]
    .sort((a, b) => {
      const pageA = Number(a.pageNumber || 0);
      const pageB = Number(b.pageNumber || 0);
      if (pageA !== pageB) {
        return pageA - pageB;
      }
      return Number(a.__paperLensSortOrder || 0) - Number(b.__paperLensSortOrder || 0);
    })
    .map((paragraph, index) => {
      const { __paperLensSortOrder, ...clean } = paragraph;
      return {
        ...clean,
        order: index,
      };
    });
}

export function buildSegmentationChunkMap({
  chunks = [],
  paragraphs = [],
  chunkSummaries = [],
  fallbackChunks = [],
  targetIndices = null,
  now = new Date().toISOString(),
} = {}) {
  const allowed = Array.isArray(targetIndices) && targetIndices.length
    ? new Set(targetIndices.map((index) => Number(index)).filter(Number.isFinite))
    : null;
  const summaryByIndex = new Map(chunkSummaries.map((summary) => [Number(summary.index), summary]));
  const fallbackByIndex = new Map(fallbackChunks.map((fallback) => [Number(fallback.index), fallback]));
  const entries = [];

  for (const [index, chunk] of chunks.entries()) {
    if (allowed && !allowed.has(index)) {
      continue;
    }

    const range = getPageRangeBoundsFromPages(chunk);
    const chunkParagraphs = paragraphs.filter((paragraph) => Number(paragraph.segmentationChunkIndex) === index);
    const summary = summaryByIndex.get(index) || {};
    const fallback = fallbackByIndex.get(index) || null;
    entries.push({
      index,
      pageRange: formatChunkPageRange(chunk),
      startPage: range.startPage,
      endPage: range.endPage,
      paragraphIds: chunkParagraphs.map((paragraph) => paragraph.id).filter(Boolean),
      paragraphCount: chunkParagraphs.length,
      summary: summary.summary || "",
      keywords: Array.isArray(summary.keywords) ? summary.keywords.slice(0, 12) : [],
      fallback: Boolean(fallback || summary.fallback),
      fallbackReason: fallback?.reason || summary.fallbackReason || "",
      updatedAt: now,
    });
  }

  return {
    version: 1,
    updatedAt: now,
    chunks: entries,
  };
}

export function mergeSegmentationChunkMaps(existingMap, patchMap, now = new Date().toISOString()) {
  const existingEntries = Array.isArray(existingMap?.chunks) ? existingMap.chunks : [];
  const patchEntries = Array.isArray(patchMap?.chunks) ? patchMap.chunks : [];
  const byIndex = new Map(existingEntries.map((entry) => [Number(entry.index), entry]));
  for (const entry of patchEntries) {
    byIndex.set(Number(entry.index), entry);
  }

  return {
    version: 1,
    updatedAt: now,
    chunks: [...byIndex.values()].sort((a, b) => Number(a.index || 0) - Number(b.index || 0)),
  };
}
