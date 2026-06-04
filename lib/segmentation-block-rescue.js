import {
  isLikelyPdfExtractionGarbageText,
  isLikelyPublicationMetadataText,
  stripPublicationMetadataFragments,
} from "./segmentation-repair.js";

const BODY_START_PATTERNS = [
  /\b\d+(?:\.\d+)?\s*%\s+(?:reduction|improvement|accuracy|relative|speedup|energy|savings|loss|gain)\b/gi,
  /\b(?:In this work|In this paper|This paper|We present|We propose|We introduce|We evaluate|We show|Our method|Our design|The proposed|Evaluation results|Experimental results|Furthermore|However|Compared to|To support|Existing|Recent|Large language|Quantization)\b/gi,
];

const TRAILING_METADATA_RE = /\b(?:Our code is available|Code is available|Source code is available|CCS Concepts|Keywords?|ACM Reference Format|Permission to make|This work is licensed)\b/i;

export function rescueReadableSegmentsFromMixedBlock(block, options = {}) {
  const rawText = String(block?.rawText || block?.text || "");
  const normalizedRaw = normalizeMixedBlockText(rawText);
  if (!normalizedRaw || normalizedRaw.length < 120 || isLikelyPdfExtractionGarbageText(rawText)) {
    return [];
  }

  const pageNumber = Number(options.pageNumber || block?.pageNumber || 0);
  const noisy = getMixedBlockNoiseProfile(normalizedRaw, pageNumber);
  if (!noisy.shouldAttempt) {
    return [];
  }

  const cleanText = normalizeMixedBlockText(stripPublicationMetadataFragments(normalizedRaw));
  if (!cleanText || cleanText.length < 80) {
    return [];
  }

  const searchFrom = Math.min(
    cleanText.length - 1,
    Math.max(noisy.lastEmailEnd, Math.floor(cleanText.length * 0.22)),
  );
  const starts = findBodyStartOffsets(cleanText, searchFrom);
  for (const startOffset of starts) {
    const text = cleanupRescuedBodyText(cleanText.slice(startOffset));
    if (!isUsefulRescuedBodyText(text)) {
      continue;
    }

    const rawStartOffset = Math.max(0, normalizedRaw.indexOf(cleanText.slice(startOffset, startOffset + 24)));
    return [{
      text,
      reason: "mixed-block-body-tail",
      startOffset: rawStartOffset || startOffset,
      endOffset: rawStartOffset ? rawStartOffset + text.length : startOffset + text.length,
    }];
  }

  return [];
}

export function cleanupRescuedBodyText(text) {
  let clean = normalizeMixedBlockText(text);
  const trailingMatch = clean.match(TRAILING_METADATA_RE);
  if (Number.isFinite(trailingMatch?.index) && trailingMatch.index >= 0) {
    clean = clean.slice(0, trailingMatch.index);
  }

  clean = stripPublicationMetadataFragments(clean)
    .replace(/\s+(?:https?:\/\/|www\.)\S+/gi, " ")
    .replace(/\b(?:CCS Concepts|Keywords?)\s*[:：].*$/i, " ")
    .replace(/\s+/g, " ")
    .trim();

  return clean;
}

function getMixedBlockNoiseProfile(text, pageNumber) {
  const emails = [...text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)];
  const institutionTokens = (text.match(/\b(?:university|institute|college|department|laboratory|labs|school|technologies|corporation|china|usa|canada|germany|france|japan|korea)\b/gi) || []).length;
  const hasPublicationMarker = /\b(?:ACM Reference Format|CCS Concepts|Keywords?|Permission to make|This work is licensed|Copyright|ISBN|DOI)\b/i.test(text);
  const hasNoisyPrefix = emails.length > 0 ||
    (pageNumber <= 2 && institutionTokens >= 3) ||
    hasPublicationMarker;
  const lastEmail = emails.at(-1);
  return {
    shouldAttempt: hasNoisyPrefix,
    lastEmailEnd: lastEmail ? lastEmail.index + lastEmail[0].length : 0,
  };
}

function findBodyStartOffsets(text, searchFrom) {
  const offsets = [];
  for (const pattern of BODY_START_PATTERNS) {
    pattern.lastIndex = Math.max(0, searchFrom);
    let match;
    while ((match = pattern.exec(text))) {
      const start = match.index;
      const candidate = text.slice(start, start + 260);
      if (start >= searchFrom && looksLikeBodySentence(candidate) && !looksLikeCodeAvailability(candidate)) {
        offsets.push(start);
      }
    }
    pattern.lastIndex = 0;
  }

  return [...new Set(offsets)].sort((a, b) => a - b);
}

function looksLikeBodySentence(text) {
  const clean = normalizeMixedBlockText(text);
  if (clean.length < 70) {
    return false;
  }

  const sentenceMarks = (clean.match(/[.!?。！？]/g) || []).length;
  const letters = (clean.match(/\p{L}/gu) || []).length;
  return sentenceMarks >= 1 && letters >= 30;
}

function looksLikeCodeAvailability(text) {
  return /^(?:Our code|Code|Source code)\s+(?:is|are)\s+available\b/i.test(normalizeMixedBlockText(text));
}

function isUsefulRescuedBodyText(text) {
  const clean = normalizeMixedBlockText(text);
  if (clean.length < 70 || isLikelyPdfExtractionGarbageText(clean) || isLikelyPublicationMetadataText(clean)) {
    return false;
  }

  const words = clean.split(/\s+/).filter(Boolean);
  const emails = clean.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  const urls = clean.match(/(?:https?:\/\/|www\.)\S+/gi) || [];
  const letters = (clean.match(/\p{L}/gu) || []).length;
  return words.length >= 10 &&
    letters >= 30 &&
    emails.length === 0 &&
    urls.join("").length / Math.max(1, clean.length) < 0.16 &&
    /[.!?。！？]/.test(clean);
}

function normalizeMixedBlockText(text) {
  return String(text || "")
    .replace(/[ \t]*\n[ \t]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
