export const PARAGRAPH_LOCATION_VERSION = 1;

export function enrichPaperParagraphLocations(paper = {}) {
  if (!Array.isArray(paper?.paragraphs)) {
    return paper;
  }

  for (const paragraph of paper.paragraphs) {
    paragraph.location = buildParagraphLocation(paper, paragraph);
  }
  return paper;
}

export function buildParagraphLocation(paper = {}, paragraph = {}) {
  const startPage = normalizePositiveInteger(paragraph?.pageNumber, 0);
  const endPage = Math.max(startPage, normalizePositiveInteger(paragraph?.pageEndNumber || paragraph?.pageNumber, startPage));
  const pages = startPage ? buildPageRange(startPage, endPage) : [];
  const relatedArtifacts = getParagraphRelatedArtifacts(paper, paragraph);
  const relatedArtifactPages = uniqueNumbers(relatedArtifacts
    .map((artifact) => normalizePositiveInteger(artifact.pageNumber, 0))
    .filter(Boolean));
  const pageImageNumbers = new Set((Array.isArray(paper?.pageImages) ? paper.pageImages : [])
    .map((image) => normalizePositiveInteger(image.pageNumber, 0))
    .filter(Boolean));

  return {
    version: PARAGRAPH_LOCATION_VERSION,
    startPage: startPage || null,
    endPage: endPage || startPage || null,
    pageCount: pages.length,
    pages,
    isCrossPage: pages.length > 1,
    label: formatParagraphLocationLabel(startPage, endPage),
    pageAnchors: pages.map((pageNumber, index) => ({
      pageNumber,
      role: pages.length === 1
        ? "single"
        : index === 0
          ? "start"
          : index === pages.length - 1 ? "end" : "middle",
      label: formatParagraphPageAnchorLabel(pageNumber, index, pages.length),
      hasPageImage: pageImageNumbers.has(pageNumber),
      hasSourceBox: index === 0 && Boolean(paragraph?.sourceBox),
    })),
    relatedArtifactPages,
    relatedArtifacts: relatedArtifacts.map((artifact) => ({
      id: artifact.id || "",
      label: artifact.label || "",
      type: artifact.visualType || artifact.type || "",
      pageNumber: normalizePositiveInteger(artifact.pageNumber, 0) || null,
    })),
  };
}

function getParagraphRelatedArtifacts(paper, paragraph) {
  const artifacts = Array.isArray(paper?.pageArtifacts) ? paper.pageArtifacts : [];
  const ids = new Set(Array.isArray(paragraph?.relatedArtifactIds) ? paragraph.relatedArtifactIds : []);
  const sourceText = String(paragraph?.sourceText || "");

  for (const artifact of artifacts) {
    if (artifact?.hidden) {
      continue;
    }
    if (artifact.type === "caption" && paragraphMentionsArtifact(sourceText, artifact)) {
      ids.add(artifact.id);
    }
  }

  return artifacts
    .filter((artifact) => !artifact?.hidden && ids.has(artifact.id))
    .sort((a, b) => {
      const pageDiff = normalizePositiveInteger(a.pageNumber, 0) - normalizePositiveInteger(b.pageNumber, 0);
      if (pageDiff) {
        return pageDiff;
      }
      return String(a.label || a.id || "").localeCompare(String(b.label || b.id || ""));
    });
}

function paragraphMentionsArtifact(text, artifact) {
  const parsed = parseArtifactLabel(artifact?.label);
  if (!parsed) {
    return false;
  }

  const number = escapeRegExp(parsed.number);
  const pattern = parsed.kind === "table"
    ? `\\b(?:table|tab\\.?)\\s*${number}(?:\\s*\\([a-z]\\))?\\b`
    : `\\b(?:figure|fig\\.?)\\s*${number}(?:\\s*\\([a-z]\\))?\\b`;

  return new RegExp(pattern, "i").test(String(text || ""));
}

function parseArtifactLabel(label) {
  const match = String(label || "").match(/^(figure|table)\s+(\d+[a-z]?)/i);
  if (!match) {
    return null;
  }

  return {
    kind: match[1].toLowerCase() === "table" ? "table" : "figure",
    number: match[2],
  };
}

function formatParagraphLocationLabel(startPage, endPage) {
  if (!startPage) {
    return "未知页";
  }
  return endPage && endPage !== startPage ? `p.${startPage}-${endPage}` : `p.${startPage}`;
}

function formatParagraphPageAnchorLabel(pageNumber, index, total) {
  if (total <= 1) {
    return `p.${pageNumber}`;
  }
  if (index === 0) {
    return `起 p.${pageNumber}`;
  }
  if (index === total - 1) {
    return `止 p.${pageNumber}`;
  }
  return `续 p.${pageNumber}`;
}

function buildPageRange(startPage, endPage) {
  if (!startPage) {
    return [];
  }
  const result = [];
  const cappedEnd = Math.min(Math.max(startPage, endPage || startPage), startPage + 24);
  for (let pageNumber = startPage; pageNumber <= cappedEnd; pageNumber += 1) {
    result.push(pageNumber);
  }
  return result;
}

function uniqueNumbers(values) {
  return [...new Set(values.filter((value) => Number.isFinite(value) && value > 0))].sort((a, b) => a - b);
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : fallback;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
