export const PARAGRAPH_ARTIFACT_LINK_VERSION = 1;

export function attachParagraphArtifactLinks(paper = {}, options = {}) {
  if (!Array.isArray(paper?.paragraphs)) {
    return paper;
  }

  const artifacts = getLinkablePaperArtifacts(paper);
  const isReadingParagraph = typeof options.isReadingParagraph === "function"
    ? options.isReadingParagraph
    : defaultIsReadingParagraph;

  for (const paragraph of paper.paragraphs) {
    if (!artifacts.length || !isReadingParagraph(paragraph, paper)) {
      paragraph.relatedArtifactIds = [];
      continue;
    }

    paragraph.relatedArtifactIds = resolveParagraphRelatedArtifactMatches(paper, paragraph, {
      artifacts,
      includeExistingIds: false,
    }).map((match) => match.artifact.id);
  }

  return paper;
}

export function resolveParagraphRelatedArtifacts(paper = {}, paragraph = {}, options = {}) {
  return resolveParagraphRelatedArtifactMatches(paper, paragraph, options)
    .map((match) => match.artifact);
}

export function resolveParagraphRelatedArtifactMatches(paper = {}, paragraph = {}, options = {}) {
  const artifacts = Array.isArray(options.artifacts)
    ? options.artifacts.filter(isLinkableArtifact)
    : getLinkablePaperArtifacts(paper);
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const matches = [];
  const seenIds = new Set();

  if (options.includeExistingIds !== false) {
    for (const id of Array.isArray(paragraph?.relatedArtifactIds) ? paragraph.relatedArtifactIds : []) {
      const artifact = byId.get(id);
      if (artifact && !seenIds.has(artifact.id)) {
        seenIds.add(artifact.id);
        matches.push({ artifact, source: "stored", score: -1000 });
      }
    }
  }

  const references = extractParagraphArtifactReferences(paragraph?.sourceText || "");
  if (references.length) {
    const exact = findExactReferenceMatches(references, artifacts);
    for (const match of exact) {
      if (!seenIds.has(match.artifact.id)) {
        seenIds.add(match.artifact.id);
        matches.push(match);
      }
    }
    return sortArtifactMatches(matches);
  }

  const fallback = findFallbackArtifactMatches(paragraph, artifacts);
  for (const match of fallback) {
    if (!seenIds.has(match.artifact.id)) {
      seenIds.add(match.artifact.id);
      matches.push(match);
    }
  }

  return sortArtifactMatches(matches);
}

export function paragraphCanReferenceArtifact(paragraph = {}, artifact = {}) {
  if (!isLinkableArtifact(artifact)) {
    return false;
  }

  const artifactRef = getArtifactReference(artifact);
  if (!artifactRef) {
    return false;
  }

  return extractParagraphArtifactReferences(paragraph?.sourceText || "")
    .some((reference) => reference.key === artifactRef.key);
}

export function extractParagraphArtifactReferences(text) {
  const clean = String(text || "");
  if (!clean.trim()) {
    return [];
  }

  const references = [];
  const seen = new Set();
  const pattern = /\b(fig(?:ure)?s?\.?|figs?\.?|tables?|tabs?\.?|eq(?:uation)?s?\.?|eqs?\.?)\s*[:.]?\s*\(?\s*(\d+)\s*\)?(?:\s*\(([a-z])\)|([a-z])\b)?/gi;
  let match;
  while ((match = pattern.exec(clean))) {
    const kind = normalizeReferenceKind(match[1]);
    const baseNumber = normalizeReferenceNumber(match[2]);
    if (!kind || !baseNumber) {
      continue;
    }

    const suffix = normalizeReferenceSuffix(match[3] || match[4] || "");
    const number = `${baseNumber}${suffix}`;
    const key = createReferenceKey(kind, number);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    references.push({
      kind,
      number,
      baseNumber,
      suffix,
      key,
      baseKey: createReferenceKey(kind, baseNumber),
      index: match.index,
      raw: match[0],
    });
  }

  return references;
}

export function parseArtifactLabel(label) {
  const clean = String(label || "").replace(/\s+/g, " ").trim();
  if (!clean) {
    return null;
  }

  const match = clean.match(/^(fig(?:ure)?|fig\.?|table|tab\.?|equation|eq\.?)s?\s*[:.]?\s*\(?\s*(\d+)\s*\)?(?:\s*\(([a-z])\)|([a-z])\b)?/i);
  if (!match) {
    return null;
  }

  const kind = normalizeReferenceKind(match[1]);
  const baseNumber = normalizeReferenceNumber(match[2]);
  if (!kind || !baseNumber) {
    return null;
  }

  const suffix = normalizeReferenceSuffix(match[3] || match[4] || "");
  const number = `${baseNumber}${suffix}`;
  return {
    kind,
    number,
    baseNumber,
    suffix,
    key: createReferenceKey(kind, number),
    baseKey: createReferenceKey(kind, baseNumber),
  };
}

function findExactReferenceMatches(references, artifacts) {
  const byKey = new Map();
  for (const artifact of artifacts) {
    const reference = getArtifactReference(artifact);
    if (!reference?.key) {
      continue;
    }
    if (!byKey.has(reference.key)) {
      byKey.set(reference.key, []);
    }
    byKey.get(reference.key).push({ artifact, artifactReference: reference });
  }

  const matches = [];
  for (const [referenceIndex, reference] of references.entries()) {
    const exact = byKey.get(reference.key) || [];
    if (exact.length) {
      for (const item of exact) {
        matches.push({
          artifact: item.artifact,
          source: "label",
          reference,
          score: referenceIndex * 10 + getArtifactExactMatchPenalty(item.artifact, reference),
        });
      }
      continue;
    }

    if (reference.suffix) {
      const parentCandidates = (byKey.get(reference.baseKey) || [])
        .filter((item) => !item.artifact.splitCandidate);
      for (const item of parentCandidates) {
        matches.push({
          artifact: item.artifact,
          source: "label-parent",
          reference,
          score: referenceIndex * 10 + 5,
        });
      }
    }
  }

  return sortArtifactMatches(matches);
}

function getArtifactExactMatchPenalty(artifact, reference) {
  let penalty = 0;
  if (artifact.splitCandidate && !reference.suffix) {
    penalty += 100;
  }
  if (artifact.type === "formula" && reference.kind !== "equation") {
    penalty += 50;
  }
  return penalty;
}

function findFallbackArtifactMatches(paragraph, artifacts) {
  const cueKind = getUnnumberedReferenceCueKind(paragraph?.sourceText || "");
  if (!cueKind) {
    return [];
  }

  const pageStart = normalizePositiveInteger(paragraph?.pageNumber, 0);
  const pageEnd = Math.max(pageStart, normalizePositiveInteger(paragraph?.pageEndNumber || paragraph?.pageNumber, pageStart));
  if (!pageStart) {
    return [];
  }

  return artifacts
    .filter((artifact) => isFallbackCompatibleArtifact(artifact, cueKind))
    .map((artifact) => {
      const score = scoreFallbackArtifact(paragraph, artifact, cueKind, pageStart, pageEnd);
      return Number.isFinite(score) ? { artifact, source: "page-distance", score } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score)
    .slice(0, 1);
}

function getUnnumberedReferenceCueKind(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) {
    return "";
  }

  if (/\b(?:equation|eq\.|formula|objective|loss function)\b/i.test(clean)) {
    return "equation";
  }
  if (/\b(?:table|tabular)\b/i.test(clean)) {
    return "table";
  }
  if (/\b(?:figure|fig\.|diagram|chart|plot|visualization|illustration)\b/i.test(clean) ||
    /\b(?:shown|illustrated|depicted|visualized)\s+(?:above|below|here)\b/i.test(clean) ||
    /\b(?:above|below)\s+(?:shows|illustrates|depicts)\b/i.test(clean)) {
    return "figure";
  }

  return "";
}

function isFallbackCompatibleArtifact(artifact, cueKind) {
  if (artifact?.splitCandidate) {
    return false;
  }

  const artifactKind = getArtifactKind(artifact);
  if (!artifactKind) {
    return false;
  }

  return artifactKind === cueKind;
}

function scoreFallbackArtifact(paragraph, artifact, cueKind, pageStart, pageEnd) {
  const artifactPage = normalizePositiveInteger(artifact?.pageNumber, 0);
  if (!artifactPage) {
    return Number.POSITIVE_INFINITY;
  }

  const pageDistance = artifactPage < pageStart
    ? pageStart - artifactPage
    : artifactPage > pageEnd ? artifactPage - pageEnd : 0;
  if (pageDistance > 1) {
    return Number.POSITIVE_INFINITY;
  }

  const paragraphBox = normalizeBox(paragraph?.sourceBox);
  const artifactBox = normalizeBox(artifact?.crop) || normalizeBox(artifact);
  const verticalDistance = paragraphBox && artifactBox && artifactPage >= pageStart && artifactPage <= pageEnd
    ? getBoxVerticalDistance(paragraphBox, artifactBox)
    : 420;
  const horizontalDistance = paragraphBox && artifactBox
    ? Math.abs(getBoxCenterX(paragraphBox) - getBoxCenterX(artifactBox)) * 0.12
    : 0;
  const cuePenalty = getArtifactKind(artifact) === cueKind ? 0 : 300;
  const labelPenalty = artifact.label ? 20 : 0;

  return pageDistance * 1000 + verticalDistance + horizontalDistance + cuePenalty + labelPenalty;
}

function getArtifactReference(artifact = {}) {
  const labelReference = parseArtifactLabel(artifact.label || "");
  if (labelReference) {
    return labelReference;
  }

  if (artifact.type === "formula") {
    const textReference = parseFormulaTextReference(artifact.text || "");
    if (textReference) {
      return textReference;
    }
  }

  return null;
}

function parseFormulaTextReference(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  const match = clean.match(/(?:^|\s)\((\d+[a-z]?)\)\s*$/i);
  if (!match) {
    return null;
  }

  const number = normalizeReferenceNumber(match[1]);
  if (!number) {
    return null;
  }

  return {
    kind: "equation",
    number,
    baseNumber: number.replace(/[a-z]$/i, ""),
    suffix: (number.match(/[a-z]$/i) || [""])[0].toLowerCase(),
    key: createReferenceKey("equation", number),
    baseKey: createReferenceKey("equation", number.replace(/[a-z]$/i, "")),
  };
}

function getLinkablePaperArtifacts(paper = {}) {
  return (Array.isArray(paper?.pageArtifacts) ? paper.pageArtifacts : [])
    .filter(isLinkableArtifact);
}

function isLinkableArtifact(artifact = {}) {
  if (!artifact?.id || artifact.hidden) {
    return false;
  }

  return Boolean(getArtifactKind(artifact));
}

function getArtifactKind(artifact = {}) {
  const parsed = parseArtifactLabel(artifact.label || "");
  if (parsed?.kind) {
    return parsed.kind;
  }

  if (artifact.type === "formula") {
    return "equation";
  }
  if (artifact.type === "caption") {
    return artifact.visualType === "table" ? "table" : "figure";
  }

  return "";
}

function sortArtifactMatches(matches) {
  return matches
    .filter((match) => match?.artifact?.id)
    .sort((a, b) => {
      if (a.score !== b.score) {
        return a.score - b.score;
      }
      const pageDiff = normalizePositiveInteger(a.artifact.pageNumber, 0) -
        normalizePositiveInteger(b.artifact.pageNumber, 0);
      if (pageDiff) {
        return pageDiff;
      }
      return String(a.artifact.label || a.artifact.id || "")
        .localeCompare(String(b.artifact.label || b.artifact.id || ""));
    });
}

function normalizeReferenceKind(prefix) {
  const clean = String(prefix || "").toLowerCase().replace(/\./g, "");
  if (clean.startsWith("tab")) {
    return "table";
  }
  if (clean.startsWith("eq")) {
    return "equation";
  }
  if (clean.startsWith("fig")) {
    return "figure";
  }
  return "";
}

function normalizeReferenceNumber(value) {
  return String(value || "").trim().toLowerCase().replace(/[^0-9a-z]/g, "");
}

function normalizeReferenceSuffix(value) {
  const clean = String(value || "").trim().toLowerCase();
  return /^[a-z]$/.test(clean) ? clean : "";
}

function createReferenceKey(kind, number) {
  return `${kind}:${String(number || "").toLowerCase()}`;
}

function normalizeBox(box = {}) {
  const x = Number(box.x);
  const y = Number(box.y);
  const width = Number(box.width);
  const height = Number(box.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return null;
  }
  return { x, y, width, height };
}

function getBoxVerticalDistance(a, b) {
  const aBottom = a.y + a.height;
  const bBottom = b.y + b.height;
  if (aBottom < b.y) {
    return b.y - aBottom;
  }
  if (bBottom < a.y) {
    return a.y - bBottom;
  }
  return Math.abs(getBoxCenterY(a) - getBoxCenterY(b)) * 0.2;
}

function getBoxCenterX(box) {
  return box.x + box.width / 2;
}

function getBoxCenterY(box) {
  return box.y + box.height / 2;
}

function normalizePositiveInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : fallback;
}

function defaultIsReadingParagraph(paragraph = {}) {
  return paragraph.kind === "paragraph" && paragraph.analysisEligible !== false;
}
