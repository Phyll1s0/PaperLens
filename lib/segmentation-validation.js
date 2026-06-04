import {
  endsWithSentence,
  isLikelyBibliographyEntryText,
  isLikelyPageNumberOrRunningHeaderText,
  isLikelyPdfExtractionGarbageText,
  isLikelyPublicationMetadataText,
  isReferencesSectionTitleText,
  shouldMergeSegmentedText,
  startsLikeTextContinuation,
  stripPublicationMetadataFragments,
} from "./segmentation-repair.js";
import {
  isLikelyDiagramOnlyText,
} from "./segmentation-visual-noise.js";

const SEGMENTATION_AUDIT_VERSION = 1;
const SEGMENTATION_VALIDATION_VERSION = 1;

export function validateAndRepairSegmentedParagraphs(paragraphs, structureMap = null) {
  const repaired = [];
  const seen = new Set();
  const repeatedTextIndex = buildRepeatedSegmentationTextIndex(paragraphs || []);
  const stats = {
    version: SEGMENTATION_VALIDATION_VERSION,
    inputParagraphs: Array.isArray(paragraphs) ? paragraphs.length : 0,
    outputParagraphs: 0,
    plannedSections: getSegmentationPlan(structureMap).length,
    removedNonReading: 0,
    removedDuplicates: 0,
    mergedFragments: 0,
    sectionAssignments: 0,
    qualityAudit: createSegmentationAuditStats(Array.isArray(paragraphs) ? paragraphs.length : 0),
    warnings: [],
    updatedAt: new Date().toISOString(),
  };

  for (const paragraph of paragraphs || []) {
    const rawSourceText = paragraph?.rawSourceText || paragraph?.sourceText || "";
    const originalClean = normalizeSegmentationParagraph(rawSourceText);
    const clean = normalizeSegmentationParagraph(stripPublicationMetadataFragments(originalClean));
    const auditTarget = {
      ...paragraph,
      rawSourceText,
      sourceText: clean || originalClean,
    };
    const audit = auditSegmentedParagraphNoise(auditTarget, structureMap, repeatedTextIndex);
    if (!clean || audit.action === "drop" || (!audit.action && shouldDropParagraphDuringSegmentationValidation(paragraph, structureMap))) {
      stats.removedNonReading += 1;
      recordSegmentationAuditReason(stats.qualityAudit, audit.reasons.length ? audit.reasons : ["heuristic-nonreading"], "removed");
      continue;
    }

    const dedupeKey = buildSegmentationValidationDedupeKey(paragraph, clean);
    if (seen.has(dedupeKey)) {
      stats.removedDuplicates += 1;
      continue;
    }
    seen.add(dedupeKey);

    const next = {
      ...paragraph,
      sourceText: clean,
      pageNumber: normalizePositivePageNumber(paragraph?.pageNumber, 1),
      pageEndNumber: normalizePositivePageNumber(paragraph?.pageEndNumber || paragraph?.pageNumber, paragraph?.pageNumber || 1),
    };
    if (next.pageEndNumber < next.pageNumber) {
      next.pageEndNumber = next.pageNumber;
    }

    const plannedSection = resolveSegmentationPlanSection(next, structureMap);
    if (plannedSection) {
      if (next.plannedSectionId !== plannedSection.id || !next.sectionTitleHint) {
        stats.sectionAssignments += 1;
      }
      next.plannedSectionId = plannedSection.id;
      next.sectionTitleHint = normalizeSectionTitleHint(next.sectionTitleHint || plannedSection.title);
      next.segmentationRole = normalizeSegmentationRole(next.segmentationRole || plannedSection.role || "");
    }

    if (audit.action === "skip-analysis") {
      applySegmentationNoiseMark(next, audit);
      recordSegmentationAuditReason(stats.qualityAudit, audit.reasons, "marked");
      repaired.push(next);
      continue;
    }

    const previous = repaired.at(-1);
    if (shouldMergeDuringSegmentationValidation(previous, next)) {
      mergeParagraphIntoPrevious(previous, next);
      stats.mergedFragments += 1;
      continue;
    }

    repaired.push(next);
  }

  repaired.forEach((paragraph, index) => {
    paragraph.order = index;
  });
  stats.outputParagraphs = repaired.length;
  stats.qualityAudit.outputParagraphs = repaired.length;

  const readingCount = repaired.filter((paragraph) => isReadingParagraph(paragraph)).length;
  if (readingCount < 3) {
    stats.warnings.push("reading-paragraph-count-low");
  }
  if (!stats.plannedSections) {
    stats.warnings.push("segmentation-plan-empty");
  }

  return { paragraphs: repaired, summary: stats };
}

export function auditSegmentedParagraphNoise(paragraph, structureMap = null, repeatedTextIndex = new Map()) {
  const raw = normalizeArtifactText(paragraph?.rawSourceText || paragraph?.sourceText || "");
  const clean = normalizeSegmentationParagraph(paragraph?.sourceText || raw);
  const reasons = [];
  if (!clean) {
    if (isLikelyCaptionText(raw)) {
      return { action: "drop", confidence: "high", reasons: ["caption"] };
    }
    if (isLikelyPdfExtractionGarbageText(paragraph?.rawSourceText || paragraph?.sourceText || raw)) {
      return { action: "drop", confidence: "high", reasons: ["pdf-extraction-garbage"] };
    }
    return { action: "drop", confidence: "high", reasons: ["empty"] };
  }

  const context = {
    ...paragraph,
    sourceText: clean,
  };

  if (isLikelyPublicationMetadataText(clean)) {
    reasons.push("publication-metadata");
  }

  if (isNonReadingByStructureMap(paragraph, structureMap)) {
    reasons.push("structure-nonbody-zone");
  }
  if (isReferencesSectionTitleText(clean) || isReferencesSectionTitleText(paragraph?.sectionTitleHint)) {
    reasons.push("references-section");
  }

  const kind = paragraph?.kind === "heading" || isLikelyHeading(clean) ? "heading" : "paragraph";
  if (kind === "heading" && !reasons.length) {
    return { action: "", confidence: "low", reasons: [] };
  }
  if (isLikelyCaptionText(raw) || isLikelyCaptionText(clean)) {
    reasons.push("caption");
  }
  if (isLikelyAuthorOrAffiliationText(clean, context)) {
    reasons.push("author-affiliation");
  }
  if (isLikelyStandaloneLinkText(clean) || isLikelyArtifactOnlyLinkText(clean)) {
    reasons.push("standalone-link");
  }
  if (isLikelyBibliographyEntryText(clean)) {
    reasons.push("bibliography-entry");
  }
  if (isRepeatedHeaderFooterText(clean, repeatedTextIndex)) {
    reasons.push("header-footer");
  }
  if (isLikelyPageNumberOrRunningHeaderText(clean)) {
    reasons.push("header-footer");
  }
  if (isLikelyDiagramOnlyText(clean, context)) {
    reasons.push("visual-text");
  }
  if (isLikelyTableBodyText(clean, context)) {
    reasons.push("table-body");
  }
  if (isLikelyPdfExtractionGarbageText(paragraph?.rawSourceText || paragraph?.sourceText || clean)) {
    reasons.push("pdf-extraction-garbage");
  }

  const normalizedReasons = normalizeSegmentationNoiseReasons(reasons);
  if (!normalizedReasons.length) {
    return { action: "", confidence: "low", reasons: [] };
  }

  const dropReasons = new Set([
    "structure-nonbody-zone",
    "references-section",
    "caption",
    "author-affiliation",
    "publication-metadata",
    "standalone-link",
    "bibliography-entry",
    "pdf-extraction-garbage",
    "table-body",
    "visual-text",
  ]);
  const action = normalizedReasons.some((reason) => dropReasons.has(reason)) ? "drop" : "skip-analysis";
  const confidence = action === "drop" || normalizedReasons.length >= 2 ? "high" : "medium";
  return { action, confidence, reasons: normalizedReasons };
}

export function normalizeSegmentationParagraph(text) {
  return String(text || "")
    .replace(/^(?:Figure|Fig\.|Table)\s+\d+[a-z]?\s*:[^.!?。！？]*(?:[.!?。！？]|$)/i, " ")
    .replace(/\s+(?:Figure|Fig\.|Table)\s+\d+[a-z]?\s*:[^.!?。！？]*(?:[.!?。！？]|$)/gi, " ")
    .replace(/[ \t]*\n[ \t]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shouldDropParagraphDuringSegmentationValidation(paragraph, structureMap) {
  const text = normalizeSegmentationParagraph(paragraph?.sourceText || "");
  if (!text) {
    return true;
  }

  const kind = paragraph?.kind === "heading" || isLikelyHeading(text) ? "heading" : "paragraph";
  if (isReferencesSectionTitleText(text) || isReferencesSectionTitleText(paragraph?.sectionTitleHint)) {
    return true;
  }

  if (kind !== "heading" && (
    isNonReadingByStructureMap(paragraph, structureMap) ||
    isLikelyNonReadingParagraphText(paragraph?.rawSourceText || text, paragraph) ||
    isLikelyNonReadingParagraphText(text, paragraph)
  )) {
    return true;
  }

  return kind !== "heading" && text.length < 20 && !isLikelyHeading(text);
}

function isLikelyNonReadingParagraphText(text, context = {}) {
  const raw = normalizeArtifactText(text);
  if (isLikelyPdfExtractionGarbageText(text)) {
    return true;
  }

  if (isLikelyCaptionText(raw)) {
    return true;
  }

  const clean = normalizeSegmentationParagraph(text);
  if (!clean) {
    return true;
  }

  if (isLikelyPublicationMetadataText(clean)) {
    return true;
  }

  if (isLikelyHeading(clean)) {
    return false;
  }

  if (isReferencesSectionTitleText(context?.sectionTitle || context?.sectionTitleHint)) {
    return true;
  }

  return isLikelyAuthorOrAffiliationText(clean, context) ||
    isLikelyStandaloneLinkText(clean) ||
    isLikelyBibliographyEntryText(clean) ||
    isLikelyDiagramOnlyText(clean, context) ||
    isLikelyTableBodyText(clean, context);
}

function isLikelyTableBodyText(text, context = {}) {
  const clean = normalizeArtifactText(text);
  if (!clean || clean.length > 360 || /[.!?。！？][)"'\]]?(\s|$)/.test(clean)) {
    return false;
  }

  const lineCount = Number(context?.lineCount || 1);
  const averageLineLength = clean.length / Math.max(1, lineCount);
  const numberTokens = (clean.match(/\b\d+(?:[.,]\d+)*%?\b/g) || []).length;
  const metricTokens = (clean.match(/\b(?:dataset|granularity|horizon|method|model|metric|mae|mse|rmse|mape|wql|smape|accuracy|precision|recall|f1|perplexity|baseline|ours|chronos|kronos|m2xfp|total|average|avg|cost|latency|throughput)\b/gi) || []).length;
  const separatorTokens = (clean.match(/\||\s{2,}|(?:^|\s)[|:](?:\s|$)/g) || []).length;
  const compactRows = lineCount >= 2 && averageLineLength <= 80;

  if (/^\|?.+\|.+\|/.test(clean) && metricTokens >= 2) {
    return true;
  }
  if (metricTokens >= 3 && numberTokens >= 2 && (compactRows || separatorTokens >= 1)) {
    return true;
  }
  if (metricTokens >= 4 && numberTokens >= 3 && averageLineLength <= 96) {
    return true;
  }

  return false;
}

function isLikelyCaptionText(text) {
  return /^(?:figure|fig\.|table)\s+\d+[a-z]?\s*[:.]/i.test(text);
}

function isLikelyAuthorOrAffiliationText(text, context = {}) {
  const pageNumber = Number(context.pageNumber || 0);
  const emails = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  if (emails.length >= 2 && (text.length < 520 || pageNumber <= 2 && text.length < 1400)) {
    return true;
  }

  if (emails.length && pageNumber <= 2 && text.length < 260 && !/[.!?。！？]/.test(text)) {
    return true;
  }

  if (/^\{[^}]+}\s*@/i.test(text) || /\b(?:university|institute|college|department|laboratory|labs|technologies)\b/i.test(text) &&
    emails.length && text.length < 420) {
    return true;
  }

  return /\b(?:author names are listed|equal contribution|corresponding author|correspondence to|authors contributed equally)\b/i.test(text);
}

function isLikelyStandaloneLinkText(text) {
  const urls = text.match(/(?:https?:\/\/|www\.)\S+/gi) || [];
  if (!urls.length) {
    return false;
  }

  const stripped = text
    .replace(/(?:https?:\/\/|www\.)\S+/gi, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/[^\p{L}]+/gu, " ")
    .trim();
  const wordCount = stripped ? stripped.split(/\s+/).length : 0;
  const urlChars = urls.join("").length;
  return text.length < 260 && (wordCount <= 10 || urlChars / Math.max(1, text.length) > 0.35);
}

function isLikelyArtifactOnlyLinkText(text) {
  const clean = normalizeSegmentationParagraph(text);
  if (!clean || clean.length > 320) {
    return false;
  }

  if (/\b(?:figure|fig\.|table|appendix|supplementary|github|code|dataset|artifact|artifact\s+available)\b/i.test(clean) &&
    /(?:https?:\/\/|www\.|doi\.org|arxiv\.org|github\.com|huggingface\.co)/i.test(clean)) {
    const words = clean.replace(/(?:https?:\/\/|www\.)\S+/gi, " ").trim().split(/\s+/).filter(Boolean);
    return words.length <= 22;
  }

  return false;
}

function buildRepeatedSegmentationTextIndex(paragraphs = []) {
  const index = new Map();
  for (const paragraph of paragraphs) {
    if (!paragraph || paragraph.kind === "heading") {
      continue;
    }

    const clean = normalizeSegmentationParagraph(paragraph.sourceText || "");
    const key = normalizeRepeatedSegmentationTextKey(clean);
    if (!key) {
      continue;
    }

    const entry = index.get(key) || {
      count: 0,
      pages: new Set(),
      text: clean,
    };
    entry.count += 1;
    entry.pages.add(normalizePositivePageNumber(paragraph.pageNumber, 0));
    index.set(key, entry);
  }

  return index;
}

function normalizeRepeatedSegmentationTextKey(text) {
  const clean = normalizeSegmentationParagraph(text);
  if (!clean || clean.length < 6 || clean.length > 160 || isLikelyHeading(clean)) {
    return "";
  }

  return clean
    .toLowerCase()
    .replace(/\b\d+\b/g, "#")
    .replace(/[^\p{L}\p{N}#]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isRepeatedHeaderFooterText(text, repeatedTextIndex = new Map()) {
  const key = normalizeRepeatedSegmentationTextKey(text);
  if (!key) {
    return false;
  }

  const entry = repeatedTextIndex.get(key);
  if (!entry || entry.pages.size < 2) {
    return false;
  }

  const clean = normalizeSegmentationParagraph(text);
  const sentenceLike = /[.!?。！？][)"'\]]?(\s|$)/.test(clean);
  return clean.length <= 96 ||
    isLikelyPublicationMetadataText(clean) ||
    isLikelyPageNumberOrRunningHeaderText(clean) ||
    (!sentenceLike && entry.pages.size >= 3);
}

function shouldMergeDuringSegmentationValidation(previous, paragraph) {
  if (!previous || previous.kind !== "paragraph" || paragraph.kind !== "paragraph") {
    return false;
  }

  if (previous.plannedSectionId && paragraph.plannedSectionId &&
    previous.plannedSectionId !== paragraph.plannedSectionId) {
    return false;
  }

  if (previous.sectionTitleHint && paragraph.sectionTitleHint &&
    previous.sectionTitleHint !== paragraph.sectionTitleHint) {
    return false;
  }

  return shouldMergeAcrossPage(previous, paragraph);
}

function shouldMergeAcrossPage(previous, paragraph) {
  if (!previous || previous.kind !== "paragraph" || paragraph.kind !== "paragraph") {
    return false;
  }

  const previousEndPage = previous.pageEndNumber || previous.pageNumber;
  if (paragraph.pageNumber === previousEndPage) {
    return shouldMergeSamePageParagraphs(previous, paragraph);
  }

  if (paragraph.pageNumber !== previousEndPage + 1) {
    return false;
  }

  if (previous.sectionTitleHint && paragraph.sectionTitleHint &&
    previous.sectionTitleHint !== paragraph.sectionTitleHint) {
    return false;
  }

  if (isLikelyHeading(paragraph.sourceText) || isLikelySectionOpening(paragraph.sourceText)) {
    return false;
  }

  if (previous.continuesToNext || paragraph.continuesFromPrevious) {
    return true;
  }

  if (shouldMergeSegmentedText(previous.sourceText, paragraph.sourceText, {
    sameSection: true,
    previousContinuesToNext: previous.continuesToNext,
    nextContinuesFromPrevious: paragraph.continuesFromPrevious,
    nextIsHeading: isLikelyHeading(paragraph.sourceText) || isLikelySectionOpening(paragraph.sourceText),
  })) {
    return true;
  }

  return previous.sourceText.endsWith("-") ||
    !endsWithSentence(previous.sourceText) ||
    startsLikeTextContinuation(paragraph.sourceText);
}

function shouldMergeSamePageParagraphs(previous, paragraph) {
  if (previous.sectionTitleHint && paragraph.sectionTitleHint &&
    previous.sectionTitleHint !== paragraph.sectionTitleHint) {
    return false;
  }

  if (isLikelyHeading(paragraph.sourceText) || isLikelySectionOpening(paragraph.sourceText)) {
    return false;
  }

  if (isLikelyNonReadingParagraphText(previous.sourceText) || isLikelyNonReadingParagraphText(paragraph.sourceText)) {
    return false;
  }

  if (previous.sourceText.endsWith("-") && startsLikeTextContinuation(paragraph.sourceText)) {
    return true;
  }

  if (paragraph.continuesFromPrevious || previous.continuesToNext) {
    return true;
  }

  if (shouldMergeSegmentedText(previous.sourceText, paragraph.sourceText, {
    sameSection: true,
    previousContinuesToNext: previous.continuesToNext,
    nextContinuesFromPrevious: paragraph.continuesFromPrevious,
    nextIsHeading: isLikelyHeading(paragraph.sourceText) || isLikelySectionOpening(paragraph.sourceText),
  })) {
    return true;
  }

  const previousShortOpen = previous.sourceText.length < 900 && !endsWithSentence(previous.sourceText);
  return previousShortOpen && startsLikeTextContinuation(paragraph.sourceText);
}

function mergeParagraphIntoPrevious(previous, paragraph) {
  previous.sourceText = mergeParagraphText(previous.sourceText, paragraph.sourceText);
  previous.pageEndNumber = Math.max(
    normalizePositivePageNumber(previous.pageEndNumber || previous.pageNumber, previous.pageNumber || 1),
    normalizePositivePageNumber(paragraph.pageEndNumber || paragraph.pageNumber, paragraph.pageNumber || 1),
  );
  previous.continuesToNext = Boolean(paragraph.continuesToNext);
  previous.contextKeywords = [
    ...normalizeKeywordList(previous.contextKeywords),
    ...normalizeKeywordList(paragraph.contextKeywords),
  ].filter((term, index, all) => all.findIndex((item) => item.toLowerCase() === term.toLowerCase()) === index)
    .slice(0, 12);
  previous.plannedSectionId = previous.plannedSectionId || paragraph.plannedSectionId || "";
  previous.segmentationRole = previous.segmentationRole || paragraph.segmentationRole || "";
}

function mergeParagraphText(previous, next) {
  if (previous.endsWith("-") && /^[a-z]/.test(next)) {
    return `${previous.slice(0, -1)}${next}`;
  }

  return `${previous} ${next}`.replace(/\s+/g, " ").trim();
}

function isNonReadingByStructureMap(item, structureMap) {
  const pageNumber = Number(item?.pageNumber || 0);
  if (!pageNumber || !Array.isArray(structureMap?.nonBodyZones)) {
    return false;
  }

  return structureMap.nonBodyZones.some((zone) => {
    const type = String(zone?.type || "").trim().toLowerCase();
    if (!type || type === "body") {
      return false;
    }
    const startPage = Number(zone.startPage || 0);
    const endPage = Number(zone.endPage || zone.startPage || 0);
    return pageNumber >= startPage && pageNumber <= endPage;
  });
}

function getSegmentationPlan(structureMap) {
  return Array.isArray(structureMap?.segmentationPlan) ? structureMap.segmentationPlan : [];
}

function resolveSegmentationPlanSection(item, structureMap) {
  const plan = getSegmentationPlan(structureMap);
  if (!plan.length) {
    return null;
  }

  const plannedSectionId = normalizeSegmentationPlanId(item?.plannedSectionId || "");
  if (plannedSectionId) {
    const matchedById = plan.find((section) => section.id === plannedSectionId);
    if (matchedById) {
      return matchedById;
    }
  }

  const sectionTitle = normalizeSectionTitleHint(item?.sectionTitle || item?.sectionTitleHint || "");
  if (sectionTitle) {
    const matchedByTitle = plan.find((section) =>
      String(section.title || "").toLowerCase() === sectionTitle.toLowerCase());
    if (matchedByTitle) {
      return matchedByTitle;
    }
  }

  const pageNumber = Number(item?.pageNumber || 0);
  const pageEndNumber = Number(item?.pageEndNumber || pageNumber);
  if (Number.isFinite(pageNumber) && pageNumber > 0) {
    const overlapping = plan.filter((section) =>
      rangesOverlap(
        Number(section.startPage || 0),
        Number(section.endPage || section.startPage || 0),
        pageNumber,
        Number.isFinite(pageEndNumber) && pageEndNumber > 0 ? pageEndNumber : pageNumber,
      ));
    if (overlapping.length === 1) {
      return overlapping[0];
    }
    if (overlapping.length > 1 && sectionTitle) {
      return overlapping.find((section) =>
        String(section.title || "").toLowerCase().includes(sectionTitle.toLowerCase()) ||
        sectionTitle.toLowerCase().includes(String(section.title || "").toLowerCase())) || overlapping[0];
    }

    const previous = [...plan]
      .reverse()
      .find((section) => Number(section.startPage || 0) <= pageNumber);
    return previous || plan[0];
  }

  return plan[0] || null;
}

function rangesOverlap(startA, endA, startB, endB) {
  if (!startA || !startB) {
    return false;
  }
  return Math.max(startA, startB) <= Math.min(endA || startA, endB || startB);
}

function normalizeSectionTitleHint(title) {
  const clean = normalizeSegmentationParagraph(title)
    .replace(/^\d+(?:\.\d+)*\.?\s+/, "")
    .replace(/[:：]+$/g, "")
    .trim();
  if (!clean || clean.length < 2 || clean.length > 90) {
    return "";
  }

  if (/^(正文|body|unknown|n\/a|null|none)$/i.test(clean)) {
    return "";
  }

  return clean;
}

function normalizeSegmentationRole(role) {
  const clean = String(role || "").trim().toLowerCase();
  if (["abstract", "background", "method", "result", "discussion", "limitation", "conclusion"].includes(clean)) {
    return clean;
  }

  return "";
}

function normalizeSegmentationPlanId(value) {
  return String(value || "").trim();
}

function normalizePositivePageNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return Number(fallback) || 1;
  }
  return Math.trunc(number);
}

function buildSegmentationValidationDedupeKey(paragraph, text) {
  const pageNumber = normalizePositivePageNumber(paragraph?.pageNumber, 1);
  const normalized = text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .slice(0, 220);
  return `${paragraph?.kind || "paragraph"}:${pageNumber}:${normalized}`;
}

function createSegmentationAuditStats(inputParagraphs = 0) {
  return {
    version: SEGMENTATION_AUDIT_VERSION,
    inputParagraphs,
    outputParagraphs: 0,
    removedNoise: 0,
    markedIneligible: 0,
    reasons: {},
  };
}

function recordSegmentationAuditReason(stats, reasons = [], action = "marked") {
  if (!stats) {
    return;
  }

  const normalizedReasons = normalizeSegmentationNoiseReasons(reasons);
  if (action === "removed") {
    stats.removedNoise += 1;
  } else if (action === "marked") {
    stats.markedIneligible += 1;
  }

  for (const reason of normalizedReasons.length ? normalizedReasons : ["unknown-noise"]) {
    stats.reasons[reason] = Number(stats.reasons[reason] || 0) + 1;
  }
}

function applySegmentationNoiseMark(paragraph, audit) {
  paragraph.analysisEligible = false;
  paragraph.analysisStatus = "done";
  paragraph.analysisError = "";
  paragraph.segmentationNoise = {
    version: SEGMENTATION_AUDIT_VERSION,
    action: "skip-analysis",
    confidence: audit.confidence || "medium",
    reasons: normalizeSegmentationNoiseReasons(audit.reasons),
  };
}

function normalizeSegmentationNoiseReasons(reasons = []) {
  return [...new Set((Array.isArray(reasons) ? reasons : [reasons])
    .map((reason) => String(reason || "").trim().toLowerCase())
    .filter(Boolean))]
    .sort();
}

function normalizeKeywordList(values) {
  const list = Array.isArray(values) ? values : [];
  return [...new Set(list
    .map((value) => String(value || "").trim())
    .filter(Boolean))]
    .slice(0, 12);
}

function isReadingParagraph(paragraph) {
  if (!paragraph || paragraph.kind === "heading" || paragraph.analysisEligible === false) {
    return false;
  }

  const text = normalizeSegmentationParagraph(paragraph.sourceText || "");
  return text.length >= 20 && !isReferencesSectionTitleText(text);
}

function isLikelySectionOpening(text) {
  return /^(abstract|introduction|related work|background|method|methods|methodology|experiments|results|discussion|conclusion|references|appendix)\b/i
    .test(String(text || "").trim());
}

function isLikelyHeading(line) {
  const text = String(line || "").trim();
  if (text.length < 3 || text.length > 90) {
    return false;
  }

  if (/^\d+(\.\d+)*\.?\s+[A-Z][\w\s:-]+$/.test(text)) {
    return true;
  }

  const known = [
    "abstract",
    "introduction",
    "related work",
    "background",
    "method",
    "methods",
    "methodology",
    "experiments",
    "experiment",
    "results",
    "discussion",
    "conclusion",
    "references",
    "appendix",
  ];

  return known.includes(text.toLowerCase());
}

function normalizeArtifactText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}
