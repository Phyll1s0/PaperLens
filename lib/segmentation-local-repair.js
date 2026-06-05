import {
  normalizeSegmentationParagraph,
  validateAndRepairSegmentedParagraphs,
} from "./segmentation-validation.js";
import {
  buildSourceMarkdown,
  detectSourceLeadIn,
} from "../public/rich-text-utils.js";

const LOCAL_SEGMENTATION_REPAIR_VERSION = 1;

export function repairExistingPaperSegmentation(paper, options = {}) {
  const originalParagraphs = Array.isArray(paper?.paragraphs) ? paper.paragraphs : [];
  const originalOrder = buildOriginalOrderMap(originalParagraphs);
  const readingCandidates = [];
  const preservedParagraphs = [];

  for (const paragraph of originalParagraphs) {
    const clone = clonePlain(paragraph);
    if (isLocalRepairCandidate(clone)) {
      readingCandidates.push(clone);
    } else {
      preservedParagraphs.push(clone);
    }
  }

  const validation = validateAndRepairSegmentedParagraphs(
    readingCandidates,
    paper?.structureMap || null,
    { pageMetrics: options.pageMetrics || buildLocalRepairPageMetrics(paper?.extractionPages || []) },
  );

  const beforeById = new Map(readingCandidates.map((paragraph) => [paragraph.id, paragraph]));
  const afterById = new Map(validation.paragraphs.map((paragraph) => [paragraph.id, paragraph]));
  const mergedRemovedIds = collectMergedParagraphIds(validation.paragraphs);
  const removedCandidateIds = readingCandidates
    .map((paragraph) => paragraph.id)
    .filter((id) => id && !afterById.has(id));
  const hiddenByLocalRepair = removedCandidateIds
    .filter((id) => !mergedRemovedIds.has(id))
    .map((id) => hideRemovedRepairCandidate(beforeById.get(id)));

  const changedParagraphIds = [];
  const metadataChangedParagraphIds = [];
  const repairedReadingParagraphs = validation.paragraphs.map((paragraph) => {
    const next = clonePlain(paragraph);
    const before = beforeById.get(next.id);
    if (!before) {
      resetLocalRepairAnalysis(next);
      updateLocalRepairRichText(next);
      changedParagraphIds.push(next.id);
      return next;
    }

    if (hasRepairContentChanged(before, next)) {
      next.rawSourceText = next.sourceText;
      resetLocalRepairAnalysis(next);
      updateLocalRepairRichText(next);
      changedParagraphIds.push(next.id);
      return next;
    }

    if (hasRepairMetadataChanged(before, next)) {
      metadataChangedParagraphIds.push(next.id);
    }
    return next;
  });

  const paragraphs = [
    ...repairedReadingParagraphs,
    ...preservedParagraphs,
    ...hiddenByLocalRepair,
  ].sort((a, b) => compareParagraphDocumentOrder(a, b, originalOrder));

  paragraphs.forEach((paragraph, index) => {
    paragraph.order = index;
  });

  const changed = changedParagraphIds.length > 0 ||
    metadataChangedParagraphIds.length > 0 ||
    removedCandidateIds.length > 0 ||
    haveParagraphIdOrderChanged(originalParagraphs, paragraphs);

  const summary = {
    version: LOCAL_SEGMENTATION_REPAIR_VERSION,
    updatedAt: new Date().toISOString(),
    inputParagraphs: originalParagraphs.length,
    inputVisibleParagraphs: readingCandidates.length,
    outputParagraphs: paragraphs.length,
    outputVisibleParagraphs: repairedReadingParagraphs.length,
    preservedHiddenParagraphs: preservedParagraphs.length,
    hiddenByLocalRepair: hiddenByLocalRepair.length,
    changedParagraphs: changedParagraphIds.length,
    metadataChangedParagraphs: metadataChangedParagraphIds.length,
    removedParagraphs: removedCandidateIds.length,
    mergedParagraphs: mergedRemovedIds.size,
    validation: validation.summary,
  };

  return {
    changed,
    paragraphs,
    summary,
    validationSummary: validation.summary,
    changedParagraphIds,
    metadataChangedParagraphIds,
    removedParagraphIds: removedCandidateIds,
    hiddenParagraphIds: hiddenByLocalRepair.map((paragraph) => paragraph.id).filter(Boolean),
    mergedParagraphIds: [...mergedRemovedIds],
  };
}

export function buildLocalRepairPageMetrics(pages = []) {
  return (Array.isArray(pages) ? pages : [])
    .map((page) => ({
      pageNumber: Number(page?.pageNumber || 0),
      pageWidth: Number(page?.width || page?.pageWidth || 0),
      pageHeight: Number(page?.height || page?.pageHeight || 0),
    }))
    .filter((page) => page.pageNumber > 0 && (page.pageWidth > 0 || page.pageHeight > 0));
}

function isLocalRepairCandidate(paragraph) {
  if (!paragraph || paragraph.hidden || paragraph.analysisEligible === false) {
    return false;
  }
  if (paragraph.manualSegmentationOverride || paragraph.manualSegmentationEdit) {
    return false;
  }
  return paragraph.kind === "paragraph" || paragraph.kind === "heading";
}

function collectMergedParagraphIds(paragraphs = []) {
  const ids = new Set();
  for (const paragraph of paragraphs) {
    for (const trace of Array.isArray(paragraph?.segmentationMergeTrace) ? paragraph.segmentationMergeTrace : []) {
      if (trace?.mergedParagraphId) {
        ids.add(String(trace.mergedParagraphId));
      }
    }
  }
  return ids;
}

function hideRemovedRepairCandidate(paragraph) {
  const next = clonePlain(paragraph);
  if (!next) {
    return null;
  }
  const now = new Date().toISOString();
  next.hidden = true;
  next.analysisEligible = false;
  next.analysisStatus = "done";
  next.analysisError = "";
  next.segmentationNoise = {
    version: LOCAL_SEGMENTATION_REPAIR_VERSION,
    action: "local-repair-hide",
    confidence: "medium",
    reasons: ["local-validation-removed"],
    updatedAt: now,
  };
  next.localSegmentationRepair = {
    action: "hide-removed-candidate",
    updatedAt: now,
  };
  return next;
}

function hasRepairContentChanged(before, after) {
  if (!before || !after) {
    return true;
  }
  return normalizeSegmentationParagraph(before.sourceText || "") !== normalizeSegmentationParagraph(after.sourceText || "") ||
    normalizePositivePageNumber(before.pageNumber, 0) !== normalizePositivePageNumber(after.pageNumber, 0) ||
    normalizePositivePageNumber(before.pageEndNumber || before.pageNumber, 0) !== normalizePositivePageNumber(after.pageEndNumber || after.pageNumber, 0) ||
    Boolean(before.continuesToNext) !== Boolean(after.continuesToNext) ||
    Boolean(before.continuesFromPrevious) !== Boolean(after.continuesFromPrevious) ||
    stableStringify(before.segmentationMergeTrace || []) !== stableStringify(after.segmentationMergeTrace || []);
}

function hasRepairMetadataChanged(before, after) {
  return String(before?.plannedSectionId || "") !== String(after?.plannedSectionId || "") ||
    String(before?.sectionTitleHint || "") !== String(after?.sectionTitleHint || "") ||
    String(before?.segmentationRole || "") !== String(after?.segmentationRole || "");
}

function resetLocalRepairAnalysis(paragraph) {
  paragraph.translation = "";
  paragraph.explanation = "";
  paragraph.keyTerms = [];
  paragraph.analysisStatus = "pending";
  paragraph.analysisError = "";
  paragraph.analysisCacheHit = false;
  paragraph.analysisCachedAt = "";
}

function updateLocalRepairRichText(paragraph) {
  const sourceText = normalizeSegmentationParagraph(paragraph?.sourceText || "");
  if (!sourceText) {
    delete paragraph.sourceMarkdown;
    delete paragraph.sourceLeadIn;
    delete paragraph.sourceLeadInSource;
    return;
  }

  const sourceMarkdown = buildSourceMarkdown(sourceText);
  if (sourceMarkdown && sourceMarkdown !== sourceText) {
    paragraph.sourceMarkdown = sourceMarkdown;
  } else {
    delete paragraph.sourceMarkdown;
  }

  const leadIn = detectSourceLeadIn(sourceText);
  if (leadIn?.text) {
    paragraph.sourceLeadIn = leadIn.text;
    paragraph.sourceLeadInSource = leadIn.source || "local-repair";
  } else {
    delete paragraph.sourceLeadIn;
    delete paragraph.sourceLeadInSource;
  }
}

function buildOriginalOrderMap(paragraphs = []) {
  const map = new Map();
  for (const [index, paragraph] of paragraphs.entries()) {
    if (paragraph?.id) {
      const order = Number(paragraph.order);
      map.set(paragraph.id, Number.isFinite(order) ? order : index);
    }
  }
  return map;
}

function compareParagraphDocumentOrder(a, b, originalOrder) {
  const orderA = getOriginalOrder(a, originalOrder);
  const orderB = getOriginalOrder(b, originalOrder);
  if (orderA !== orderB) {
    return orderA - orderB;
  }

  const pageA = normalizePositivePageNumber(a?.pageNumber || a?.sourceBox?.pageNumber, 999999);
  const pageB = normalizePositivePageNumber(b?.pageNumber || b?.sourceBox?.pageNumber, 999999);
  if (pageA !== pageB) {
    return pageA - pageB;
  }

  const boxA = normalizeSourceBoxForSort(a?.sourceBox);
  const boxB = normalizeSourceBoxForSort(b?.sourceBox);
  if (boxA.y !== boxB.y) {
    return boxA.y - boxB.y;
  }
  if (boxA.x !== boxB.x) {
    return boxA.x - boxB.x;
  }
  return String(a?.id || "").localeCompare(String(b?.id || ""));
}

function getOriginalOrder(paragraph, originalOrder) {
  if (paragraph?.id && originalOrder.has(paragraph.id)) {
    return originalOrder.get(paragraph.id);
  }
  const order = Number(paragraph?.order);
  return Number.isFinite(order) ? order : 999999;
}

function normalizeSourceBoxForSort(box = {}) {
  const x = Number(box?.x);
  const y = Number(box?.y);
  return {
    x: Number.isFinite(x) ? x : 999999,
    y: Number.isFinite(y) ? y : 999999,
  };
}

function haveParagraphIdOrderChanged(before = [], after = []) {
  if (before.length !== after.length) {
    return true;
  }
  for (let index = 0; index < before.length; index += 1) {
    if (before[index]?.id !== after[index]?.id) {
      return true;
    }
  }
  return false;
}

function normalizePositivePageNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : fallback;
}

function stableStringify(value) {
  return JSON.stringify(value || []);
}

function clonePlain(value) {
  if (value === null || value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}
