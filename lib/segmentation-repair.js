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
