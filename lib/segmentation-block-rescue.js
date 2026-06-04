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

  const lineSegments = rebuildReadableSegmentsFromBlockLines(block, {
    pageNumber,
    rawText: normalizedRaw,
  });
  if (lineSegments.length) {
    return lineSegments;
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

export function rebuildReadableSegmentsFromBlockLines(block, options = {}) {
  const lines = normalizeRescueLines(block?.lines || []);
  if (lines.length < 2) {
    return [];
  }

  const rawText = normalizeMixedBlockText(options.rawText || block?.rawText || block?.text || lines.map((line) => line.text).join(" "));
  const pageNumber = Number(options.pageNumber || block?.pageNumber || 0);
  const noisy = getMixedBlockNoiseProfile(rawText, pageNumber);
  if (!noisy.shouldAttempt) {
    return [];
  }

  const groups = [];
  let current = [];
  let sawNoise = false;

  const flushCurrent = () => {
    if (!current.length) {
      return;
    }

    const segment = buildLineSegment(current, rawText);
    if (segment) {
      groups.push(segment);
    }
    current = [];
  };

  for (const line of lines) {
    const lineKind = classifyMixedBlockLine(line.text, {
      pageNumber,
      sawNoise,
      hasCurrent: current.length > 0,
    });

    if (lineKind === "noise") {
      sawNoise = true;
      flushCurrent();
      continue;
    }

    if (lineKind === "body" && (sawNoise || current.length)) {
      current.push(line);
      continue;
    }

    flushCurrent();
  }

  flushCurrent();
  return groups;
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

function buildLineSegment(lines, rawText) {
  const text = cleanupRescuedBodyText(lines.map((line) => line.text).join(" "));
  if (!isUsefulRescuedBodyText(text)) {
    return null;
  }

  const box = mergeLineBoxes(lines);
  const firstNeedle = normalizeMixedBlockText(lines[0]?.text || "").slice(0, 24);
  const rawStartOffset = firstNeedle ? rawText.indexOf(firstNeedle) : -1;
  return {
    text,
    reason: "mixed-block-line-rebuild",
    startOffset: rawStartOffset >= 0 ? rawStartOffset : 0,
    endOffset: rawStartOffset >= 0 ? rawStartOffset + text.length : text.length,
    box,
    lineCount: lines.length,
  };
}

function classifyMixedBlockLine(text, context = {}) {
  const clean = normalizeMixedBlockText(stripPublicationMetadataFragments(text));
  if (!clean) {
    return "noise";
  }

  if (isNoisyMixedBlockLine(clean, context)) {
    return "noise";
  }

  if (isLikelyBodyLine(clean, context)) {
    return "body";
  }

  return "other";
}

function isNoisyMixedBlockLine(text, context = {}) {
  const pageNumber = Number(context.pageNumber || 0);
  if (isLikelyPublicationMetadataText(text) ||
    TRAILING_METADATA_RE.test(text) ||
    looksLikeCodeAvailability(text) ||
    isStandaloneLinkLine(text)) {
    return true;
  }

  const emails = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  const groupedEmail = /\{[^}]{2,180}\}\s*@\s*[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text);
  if (emails.length || groupedEmail) {
    return true;
  }

  const institutionTokens = (text.match(/\b(?:university|institute|college|department|laboratory|labs|school|technologies|corporation|china|usa|canada|germany|france|japan|korea|berkeley|rutgers)\b/gi) || []).length;
  const hasSentence = /[.!?。！？]/.test(text);
  if (pageNumber <= 2 && institutionTokens >= 2 && !hasSentence) {
    return true;
  }

  return false;
}

function isLikelyBodyLine(text, context = {}) {
  const clean = normalizeMixedBlockText(text);
  if (looksLikeCodeAvailability(clean)) {
    return false;
  }

  if (isMetricBodyLine(clean)) {
    return clean.length >= 45;
  }

  if (matchesBodyStart(clean) && looksLikeBodySentence(clean)) {
    return true;
  }

  if (context.hasCurrent) {
    if (/^[a-z0-9,;:()[\]\-–—]/.test(clean)) {
      return clean.length >= 24;
    }
    if (/^(?:Furthermore|However|These|This|The|Our|It also|Evaluation|Experimental|Compared|Consequently)\b/i.test(clean)) {
      return clean.length >= 35;
    }
  }

  if (context.sawNoise && looksLikeBodySentence(clean) &&
    /\b(?:we|our|the|this|these|model|method|design|results?|evaluation|accuracy|performance|forecasting|quantization|training|framework)\b/i.test(clean)) {
    return true;
  }

  return false;
}

function isMetricBodyLine(text) {
  return /\b\d+(?:\.\d+)?\s*%\s+(?:reduction|improvement|accuracy|relative|speedup|energy|savings|loss|gain)\b/i.test(text);
}

function matchesBodyStart(text) {
  return BODY_START_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    const matched = pattern.test(text);
    pattern.lastIndex = 0;
    return matched;
  });
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
  const metricSentence = isMetricBodyLine(clean);
  return sentenceMarks >= 1 && letters >= (metricSentence ? 20 : 30);
}

function looksLikeCodeAvailability(text) {
  return /^(?:Our code|Code|Source code)\s+(?:is|are)\s+available\b/i.test(normalizeMixedBlockText(text));
}

function isStandaloneLinkLine(text) {
  const clean = normalizeMixedBlockText(text);
  const urls = clean.match(/(?:https?:\/\/|www\.)\S+/gi) || [];
  if (!urls.length) {
    return false;
  }

  const stripped = clean
    .replace(/(?:https?:\/\/|www\.)\S+/gi, " ")
    .replace(/[^\p{L}]+/gu, " ")
    .trim();
  const wordCount = stripped ? stripped.split(/\s+/).length : 0;
  return clean.length < 260 && (wordCount <= 12 || urls.join("").length / Math.max(1, clean.length) > 0.35);
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

function normalizeRescueLines(lines) {
  return (Array.isArray(lines) ? lines : [])
    .map((line) => {
      const text = normalizeMixedBlockText(line?.text || "");
      const x = Number(line?.x);
      const y = Number(line?.y);
      const width = Number(line?.width);
      const height = Number(line?.height);
      return {
        text,
        x,
        y,
        width,
        height,
      };
    })
    .filter((line) =>
      line.text &&
      [line.x, line.y, line.width, line.height].every(Number.isFinite) &&
      line.width > 0 &&
      line.height > 0);
}

function mergeLineBoxes(lines) {
  const xMin = Math.min(...lines.map((line) => line.x));
  const yMin = Math.min(...lines.map((line) => line.y));
  const xMax = Math.max(...lines.map((line) => line.x + line.width));
  const yMax = Math.max(...lines.map((line) => line.y + line.height));
  if (![xMin, yMin, xMax, yMax].every(Number.isFinite) || xMax <= xMin || yMax <= yMin) {
    return null;
  }

  return {
    x: xMin,
    y: yMin,
    width: xMax - xMin,
    height: yMax - yMin,
  };
}
