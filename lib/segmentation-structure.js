import {
  isLikelyFrontMatterTitleText,
  isLikelyPublicationMetadataText,
  isReferencesSectionTitleText,
  stripPublicationMetadataFragments,
} from "./segmentation-repair.js";

const KNOWN_SECTION_TITLE_RE = /^(?:abstract|introduction|related work|background|preliminaries|methodology|approach|design|architecture|implementation|system overview|algorithm|experiments?|evaluation|results?|analysis|discussion|limitations?|conclusion|future work|acknowledg(?:e)?ments?|appendix)(?:\b|$)/i;
const NUMBERED_SECTION_TITLE_RE = /^(?:[1-9](?:\.\d+)*|[A-Z])\.?\s+[A-Z][\p{L}\p{N}\s,;:()&+\-/]{2,}$/u;

export function inferHeuristicStructureSectionsFromPages(pages, options = {}) {
  const pageNumbers = (pages || []).map((page) => Number(page?.pageNumber)).filter(Number.isFinite);
  const firstPage = Number(options.firstPage || (pageNumbers.length ? Math.min(...pageNumbers) : 1));
  const lastPage = Number(options.lastPage || (pageNumbers.length ? Math.max(...pageNumbers) : firstPage));
  const referencesStartPage = Number(options.referencesStartPage || 0) || null;
  const bodyEndPage = Number(options.bodyEndPage || (referencesStartPage ? Math.max(firstPage, referencesStartPage - 1) : lastPage));
  const candidates = [];

  for (const page of pages || []) {
    const pageNumber = normalizePageNumber(page?.pageNumber, firstPage, lastPage, null);
    if (!pageNumber || pageNumber > bodyEndPage) {
      continue;
    }

    const blocks = Array.isArray(page.blocks) && page.blocks.length
      ? page.blocks
      : String(page.text || "").split(/\n+/).map((text, index) => ({ text, y: index * 20, lineCount: 1 }));

    blocks.forEach((block, index) => {
      const title = normalizeStructureHeadingText(block?.text || "");
      const context = {
        ...block,
        pageNumber,
        index,
      };
      if (!isLikelyStructureSectionHeading(title, context)) {
        return;
      }

      candidates.push({
        title,
        pageNumber,
        y: Number(block?.y ?? index * 20),
        index,
      });
    });
  }

  const deduped = [];
  for (const candidate of candidates.sort(compareSectionCandidates)) {
    const duplicate = deduped.some((item) =>
      item.title.toLowerCase() === candidate.title.toLowerCase() &&
      Math.abs(item.pageNumber - candidate.pageNumber) <= 1);
    if (!duplicate) {
      deduped.push(candidate);
    }
  }

  return deduped
    .map((candidate, index, all) => {
      const next = all[index + 1] || null;
      const endPage = next
        ? Math.max(candidate.pageNumber, next.pageNumber - 1)
        : bodyEndPage;
      return {
        title: candidate.title,
        startPage: candidate.pageNumber,
        endPage: Math.max(candidate.pageNumber, endPage),
      };
    })
    .slice(0, 32);
}

export function isLikelyStructureSectionHeading(text, context = {}) {
  const clean = normalizeStructureHeadingText(text);
  if (!clean || clean.length < 3 || clean.length > 110) {
    return false;
  }

  if (isLikelyFrontMatterTitleText(clean, context) ||
    isLikelyPublicationMetadataText(clean) ||
    isReferencesSectionTitleText(clean)) {
    return false;
  }

  if (/^(?:figure|fig\.|table|tbl\.|algorithm|listing)\s+\d/i.test(clean) ||
    /^(?:[1-9](?:\.\d+)*|[A-Z])\.?\s+(?:figure|fig\.|table|tbl\.)\s+\d/i.test(clean) ||
    /^(?:keywords?|acm reference format|ccs concepts)\b/i.test(clean) ||
    /^(?:method|model|dataset|metric|baseline|ours|ground truth|reconstruction)$/i.test(clean) ||
    /@|https?:\/\/|www\.|doi\.org/i.test(clean)) {
    return false;
  }

  if (/[.!?。！？]$/.test(clean) && !/^(?:\d+|[A-Z])(?:\.\d+)*\.?\s+/.test(clean)) {
    return false;
  }

  if (KNOWN_SECTION_TITLE_RE.test(clean)) {
    return true;
  }

  return NUMBERED_SECTION_TITLE_RE.test(clean);
}

export function normalizeStructureHeadingText(text) {
  return stripPublicationMetadataFragments(text)
    .replace(/\s+/g, " ")
    .replace(/[:：]+$/g, "")
    .trim();
}

function compareSectionCandidates(a, b) {
  if (a.pageNumber !== b.pageNumber) {
    return a.pageNumber - b.pageNumber;
  }
  const aNumber = parseSectionNumberPrefix(a.title);
  const bNumber = parseSectionNumberPrefix(b.title);
  if (aNumber && bNumber) {
    const numberComparison = compareSectionNumberParts(aNumber, bNumber);
    if (numberComparison) {
      return numberComparison;
    }
  }
  if (Math.abs(a.y - b.y) > 2) {
    return a.y - b.y;
  }
  return a.index - b.index;
}

function parseSectionNumberPrefix(title) {
  const match = String(title || "").match(/^([1-9](?:\.\d+)*)\.?\s+/);
  if (!match) {
    return null;
  }

  return match[1].split(".").map((part) => Number(part));
}

function compareSectionNumberParts(a, b) {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const left = a[index] ?? -1;
    const right = b[index] ?? -1;
    if (left !== right) {
      return left - right;
    }
  }
  return 0;
}

function normalizePageNumber(value, firstPage, lastPage, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }

  return Math.trunc(Math.min(lastPage, Math.max(firstPage, number)));
}
