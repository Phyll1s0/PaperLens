export function isLikelyPdfExtractionGarbageText(text) {
  const source = String(text || "");
  const clean = source.replace(/\s+/g, " ").trim();
  if (!clean) {
    return false;
  }

  const controlCount = (source.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g) || []).length;
  if (controlCount >= 1 && clean.length > 20) {
    return true;
  }

  if (controlCount >= 3 && controlCount / Math.max(1, clean.length) > 0.015) {
    return true;
  }

  if (/<latexit\b|sha1_base64=|AAAy[A-Za-z0-9+/=]{80,}/i.test(clean) && clean.length > 160) {
    return true;
  }

  const denseEncodedRuns = clean.match(/[A-Za-z0-9+/=]{180,}/g) || [];
  if (denseEncodedRuns.length && /[=<>]/.test(clean) && clean.length > 260) {
    return true;
  }

  return false;
}

const CONFERENCE_ACRONYM_PATTERN = [
  "AAAI",
  "ACL",
  "ASPLOS",
  "ATC",
  "CHI",
  "COLING",
  "CVPR",
  "DAC",
  "DATE",
  "ECCV",
  "EMNLP",
  "EuroSys",
  "FAST",
  "HPCA",
  "ICCV",
  "ICDE",
  "ICLR",
  "ICML",
  "IJCAI",
  "ISCA",
  "KDD",
  "MICRO",
  "MLSys",
  "NAACL",
  "NeurIPS",
  "NIPS",
  "NSDI",
  "OSDI",
  "PLDI",
  "POPL",
  "SIGCOMM",
  "SIGGRAPH",
  "SIGIR",
  "SIGMOD",
  "SOSP",
  "UIST",
  "USENIX",
  "VLDB",
  "WSDM",
  "WWW",
].join("|");
const MONTH_PATTERN = "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";
const CONFERENCE_DATE_LOCATION_RE = new RegExp(
  `\\b(?:${CONFERENCE_ACRONYM_PATTERN})\\s*[’'‘]?\\d{2,4}\\b\\s*,\\s*(?:${MONTH_PATTERN})\\b[^.!?。！？\\n]{0,42}\\b\\d{4}\\b\\s*,\\s*[^.!?。！？\\n]{2,90}\\b(?:USA|U\\.S\\.A\\.|US|United States|Canada|UK|China|Japan|Korea|Germany|France|Italy|Spain|Austria|Australia|Virtual|Online)\\b`,
  "gi",
);
const SHORT_CONFERENCE_HEADER_RE = new RegExp(
  `^(?:\\d{1,2}(?:st|nd|rd|th)\\s+)?(?:(?:ACM|IEEE|USENIX|AAAI|SIAM)\\s+)?(?:International\\s+)?(?:Conference|Symposium|Workshop)\\b|^(?:${CONFERENCE_ACRONYM_PATTERN})\\s*[’'‘]?\\d{2,4}\\b`,
  "i",
);

function normalizeSegmentationText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function normalizeSegmentationHeadingText(text) {
  return normalizeSegmentationText(text)
    .replace(/^\d+(?:\.\d+)*\.?\s+/, "")
    .replace(/[:：.]+$/g, "")
    .trim();
}

export function isLikelyPublicationMetadataText(text) {
  const clean = normalizeSegmentationText(text);
  if (!clean) {
    return false;
  }

  if (/\b(?:ACM Reference Format|Permission to make digital|Copyright held by|Proceedings of|ISBN|ISSN|DOI:|https:\/\/doi\.org|arXiv:\d|Creative Commons|©)\b/i.test(clean)) {
    return true;
  }

  CONFERENCE_DATE_LOCATION_RE.lastIndex = 0;
  const hasConferenceDateLocation = CONFERENCE_DATE_LOCATION_RE.test(clean);
  CONFERENCE_DATE_LOCATION_RE.lastIndex = 0;
  if (/^EUROSYS\s+[’'\d]/i.test(clean) || hasConferenceDateLocation) {
    return true;
  }

  if (clean.length <= 180 && SHORT_CONFERENCE_HEADER_RE.test(clean) && !/[.!?。！？]/.test(clean)) {
    return true;
  }

  if (clean.length <= 220 && /^(?:the\s+)?(?:\d{1,2}(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth)\s+international\s+conference\s+on\b/i.test(clean)) {
    return true;
  }

  return false;
}

export function isLikelyBibliographyEntryText(text) {
  const clean = normalizeSegmentationText(text);
  if (!clean) {
    return false;
  }

  return /^\[\d+\]\s+/.test(clean) ||
    /(?:^|https?:\/\/\S+\s+)\[\d+\]\s+[A-Z]/.test(clean) ||
    (/^\d{4}\.\s+[A-Z]/.test(clean) && /\b(?:arXiv|Proceedings|Conference|Journal|Transactions|doi:|https?:\/\/)/i.test(clean)) ||
    (/\barXiv:\d{4}\.\d{4,5}\b/i.test(clean) && /(?:\[\d+\]|\b(?:Proceedings|Conference|Journal|Transactions|preprint)\b)/i.test(clean)) ||
    /^\d+\.\s+[A-Z][A-Za-z-]+,\s+[A-Z]/.test(clean) ||
    (/\b(?:In Proceedings of|Journal of|Conference on|Transactions on|arXiv preprint)\b/i.test(clean) && clean.length < 420);
}

export function isReferencesSectionTitleText(text) {
  const clean = normalizeSegmentationHeadingText(text);
  return Boolean(clean) && clean.length <= 90 && /^(references|bibliography|参考文献)$/i.test(clean);
}

export function isLikelyReferencesHeadingBlock(block) {
  const clean = normalizeSegmentationHeadingText(block?.text || "");
  if (!isReferencesSectionTitleText(clean)) {
    return false;
  }

  const lineCount = Number(block?.lineCount || 1);
  const width = Number(block?.width || 0);
  return lineCount <= 2 && (!width || width < 180);
}

export function isLikelyPageNumberOrRunningHeaderText(text) {
  const clean = normalizeSegmentationText(text);
  if (!clean || clean.length > 120) {
    return false;
  }

  return /^(?:\d+\s*\/\s*)?\d+$/.test(clean) ||
    /^page\s+\d+(?:\s+of\s+\d+)?$/i.test(clean) ||
    (/^(?:preprint|draft|submitted|accepted|published|proceedings|conference|workshop)\b/i.test(clean) && !/[.!?。！？]/.test(clean));
}

export function stripPublicationMetadataFragments(text) {
  const source = String(text || "");
  if (!source.trim()) {
    return "";
  }

  let next = source.replace(CONFERENCE_DATE_LOCATION_RE, " ");
  CONFERENCE_DATE_LOCATION_RE.lastIndex = 0;

  const clean = next.replace(/\s+/g, " ").trim();
  if (isLikelyPublicationMetadataText(clean) && clean.length <= 260) {
    return "";
  }

  next = clean
    .replace(/\b(?:such as|including|e\.g\.,?|for example)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  return next;
}

export function startsLikeTextContinuation(text) {
  const clean = String(text || "").trim();
  return /^[a-z0-9,;:()[\]\-–—]/.test(clean) ||
    /^(?:et\s+al\.|i\.e\.|e\.g\.)/i.test(clean);
}

export function endsWithSentence(text) {
  return /[.!?。！？]["')\]]*$/.test(String(text || "").trim());
}

export function shouldMergeSegmentedText(previousText, nextText, options = {}) {
  const previous = String(previousText || "").trim();
  const next = String(nextText || "").trim();
  if (!previous || !next || options.sameSection === false || options.nextIsHeading) {
    return false;
  }

  if (isLikelyPdfExtractionGarbageText(previous) || isLikelyPdfExtractionGarbageText(next)) {
    return false;
  }

  if (previous.endsWith("-") && startsLikeTextContinuation(next)) {
    return true;
  }

  if (options.previousContinuesToNext || options.nextContinuesFromPrevious) {
    return true;
  }

  const previousClosed = endsWithSentence(previous);
  const nextContinuation = startsLikeTextContinuation(next);
  const previousLength = previous.length;
  const nextLength = next.length;
  const maxOpenChars = Number(options.maxOpenChars || 2200);

  if (!previousClosed && nextContinuation && previousLength <= maxOpenChars) {
    return true;
  }

  if (nextContinuation && nextLength <= 260 && previousLength <= maxOpenChars) {
    return true;
  }

  if (!previousClosed && nextLength <= 420 && previousLength <= maxOpenChars && !/^[A-Z][A-Z\s]{2,}$/.test(next)) {
    return true;
  }

  return false;
}
