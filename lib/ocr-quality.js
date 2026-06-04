const OCR_QUALITY_VERSION = 1;
const DEFAULT_OCR_LANGUAGE = "eng";
const LANGUAGE_ALIASES = new Map([
  ["english", "eng"],
  ["en", "eng"],
  ["zh", "chi_sim"],
  ["zh-cn", "chi_sim"],
  ["chinese", "chi_sim"],
  ["cn", "chi_sim"],
  ["ja", "jpn"],
  ["jp", "jpn"],
  ["japanese", "jpn"],
  ["ko", "kor"],
  ["kr", "kor"],
  ["korean", "kor"],
]);

export function normalizeOcrLanguage(value, fallback = DEFAULT_OCR_LANGUAGE) {
  const fallbackLanguage = sanitizeLanguageList(fallback) || DEFAULT_OCR_LANGUAGE;
  const raw = String(value || "").trim();
  if (!raw) {
    return fallbackLanguage;
  }

  if (raw.includes("\u0000")) {
    return fallbackLanguage;
  }

  if (/^auto$/i.test(raw)) {
    return "auto";
  }

  return sanitizeLanguageList(raw) || fallbackLanguage;
}

export function resolveOcrLanguage(value, paper = {}, fallback = DEFAULT_OCR_LANGUAGE) {
  const normalized = normalizeOcrLanguage(value, fallback);
  if (normalized !== "auto") {
    return normalized;
  }

  return normalizeOcrLanguage(
    paper?.ocr?.recommendedLanguage ||
      paper?.ocr?.detectedLanguage ||
      detectPdfLanguage(paper).language ||
      fallback,
    fallback,
  );
}

export function detectPdfLanguage(paperOrPages = {}) {
  const text = collectPaperText(paperOrPages).slice(0, 80_000);
  const compact = text.replace(/\s+/g, "");
  if (compact.length < 80) {
    return {
      language: "",
      label: "unknown",
      confidence: "low",
      counts: countScripts(text),
    };
  }

  const counts = countScripts(text);
  const cjk = counts.han + counts.kana + counts.hangul;
  const signal = counts.latin + cjk;
  if (!signal) {
    return {
      language: DEFAULT_OCR_LANGUAGE,
      label: "latin",
      confidence: "low",
      counts,
    };
  }

  const latinRatio = counts.latin / signal;
  const cjkRatio = cjk / signal;
  let language = DEFAULT_OCR_LANGUAGE;
  let label = "latin";

  if (counts.kana > Math.max(24, counts.han * 0.18)) {
    language = latinRatio > 0.18 ? "eng+jpn" : "jpn";
    label = "japanese";
  } else if (counts.hangul > 24) {
    language = latinRatio > 0.18 ? "eng+kor" : "kor";
    label = "korean";
  } else if (counts.han > 24) {
    language = latinRatio > 0.18 ? "eng+chi_sim" : "chi_sim";
    label = "chinese";
  } else if (latinRatio > 0.45) {
    language = DEFAULT_OCR_LANGUAGE;
    label = "latin";
  }

  return {
    language,
    label,
    confidence: Math.max(latinRatio, cjkRatio) > 0.7 ? "high" : "medium",
    counts,
  };
}

export function buildOcrQualityReport(paper = {}, options = {}) {
  const afterOcr = Boolean(options.afterOcr);
  const textDensity = buildTextDensityStats(paper);
  const detected = detectPdfLanguage(paper);
  const selectedLanguage = normalizeOcrLanguage(options.selectedLanguage || options.language || paper?.ocr?.language, options.defaultLanguage || DEFAULT_OCR_LANGUAGE);
  const recommendedLanguage = normalizeOcrLanguage(detected.language || selectedLanguage, options.defaultLanguage || DEFAULT_OCR_LANGUAGE);
  const pageImageQuality = buildPageImageQualityStats(paper);
  const toolSignals = parseOcrToolSignals(options.toolOutput || "");
  const warnings = [];

  if (textDensity.pageCount > 0 && textDensity.charsPerPage < 120) {
    warnings.push(buildWarning(
      "low-text-density",
      "warning",
      afterOcr
        ? "OCR 后每页可阅读字符偏少，可能是扫描质量、语言包或版面识别问题。"
        : "当前 PDF 可提取文本偏少，可能需要 OCR 后再解析。",
    ));
  }

  if (textDensity.readableParagraphCount === 0) {
    warnings.push(buildWarning(
      "no-readable-paragraphs",
      "error",
      afterOcr
        ? "OCR 后仍没有形成可阅读段落，需要更换语言包或检查 PDF 图像质量。"
        : "当前 PDF 没有形成可阅读段落，需要先进行 OCR。",
    ));
  }

  if (pageImageQuality.lowResolutionPages.length) {
    warnings.push(buildWarning(
      "low-resolution-page-image",
      "warning",
      `有 ${pageImageQuality.lowResolutionPages.length} 页页图分辨率偏低，OCR 可能漏字或错字。`,
    ));
  }

  if (toolSignals.skew) {
    warnings.push(buildWarning(
      "deskew-applied",
      "info",
      "OCRmyPDF 检测到页面倾斜并尝试校正，建议抽查校正后的页面。",
    ));
  }

  if (toolSignals.rotation) {
    warnings.push(buildWarning(
      "rotation-detected",
      "info",
      "OCRmyPDF 检测到页面方向调整，建议确认正文没有被错误旋转。",
    ));
  }

  if (toolSignals.lowQuality) {
    warnings.push(buildWarning(
      "tool-low-quality",
      "warning",
      "OCR 工具日志提示图像质量或置信度偏低。",
    ));
  }

  if (
    selectedLanguage !== "auto" &&
    recommendedLanguage &&
    selectedLanguage !== recommendedLanguage &&
    detected.confidence !== "low"
  ) {
    warnings.push(buildWarning(
      "language-mismatch",
      "warning",
      `检测文本更像 ${recommendedLanguage}，当前 OCR 语言是 ${selectedLanguage}。`,
    ));
  }

  return {
    version: OCR_QUALITY_VERSION,
    selectedLanguage,
    detectedLanguage: detected.language || "",
    detectedLanguageLabel: detected.label,
    languageConfidence: detected.confidence,
    recommendedLanguage,
    textDensity,
    pageImageQuality,
    toolSignals,
    warnings: dedupeWarnings(warnings),
    score: scoreOcrQuality(warnings, textDensity),
  };
}

function sanitizeLanguageList(value) {
  const parts = String(value || "")
    .split("+")
    .map((part) => normalizeLanguagePart(part))
    .filter(Boolean);

  if (!parts.length) {
    return "";
  }

  return [...new Set(parts)].slice(0, 5).join("+");
}

function normalizeLanguagePart(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || raw.includes("\u0000")) {
    return "";
  }

  const alias = LANGUAGE_ALIASES.get(raw);
  const normalized = alias || raw;
  if (!/^[a-z0-9_]{2,24}$/.test(normalized)) {
    return "";
  }

  return normalized;
}

function collectPaperText(paperOrPages) {
  const pages = Array.isArray(paperOrPages)
    ? paperOrPages
    : Array.isArray(paperOrPages?.extractionPages)
      ? paperOrPages.extractionPages
      : [];
  const pageText = pages.map((page) => String(page.text || "")).join("\n");
  const paragraphText = Array.isArray(paperOrPages?.paragraphs)
    ? paperOrPages.paragraphs.map((paragraph) => String(paragraph.sourceText || paragraph.text || "")).join("\n")
    : "";
  return `${pageText}\n${paragraphText}`.trim();
}

function countScripts(text) {
  return {
    latin: countMatches(text, /[A-Za-z]/g),
    han: countMatches(text, /[\u3400-\u4dbf\u4e00-\u9fff]/g),
    kana: countMatches(text, /[\u3040-\u30ff]/g),
    hangul: countMatches(text, /[\uac00-\ud7af]/g),
    digits: countMatches(text, /[0-9]/g),
  };
}

function countMatches(text, pattern) {
  return (String(text || "").match(pattern) || []).length;
}

function buildTextDensityStats(paper) {
  const pages = Array.isArray(paper?.extractionPages) ? paper.extractionPages : [];
  const pageCount = Number(paper?.pageCount || pages.length || 0);
  const textCharacters = pages.reduce((total, page) =>
    total + String(page.text || "").replace(/\s+/g, "").length, 0);
  const readableParagraphCount = Array.isArray(paper?.paragraphs)
    ? paper.paragraphs.filter((paragraph) => !paragraph.hidden && String(paragraph.sourceText || paragraph.text || "").trim().length >= 20).length
    : 0;

  return {
    pageCount,
    textCharacters,
    charsPerPage: pageCount ? Math.round(textCharacters / pageCount) : 0,
    readableParagraphCount,
    charsPerParagraph: readableParagraphCount ? Math.round(textCharacters / readableParagraphCount) : 0,
  };
}

function buildPageImageQualityStats(paper) {
  const pageImages = Array.isArray(paper?.pageImages) ? paper.pageImages : [];
  const lowResolutionPages = pageImages
    .filter((page) => {
      const width = Number(page.imageWidth || page.width || 0);
      const height = Number(page.imageHeight || page.height || 0);
      return width > 0 && height > 0 && (width < 900 || height < 1100);
    })
    .map((page) => Number(page.pageNumber || 0))
    .filter(Boolean);

  return {
    pageImageCount: pageImages.filter((page) => page.imagePath).length,
    lowResolutionPages,
  };
}

function parseOcrToolSignals(output) {
  const text = String(output || "");
  const lower = text.toLowerCase();
  return {
    skew: /\b(de[-\s]?skew|deskew|skew)\b/.test(lower),
    rotation: /\b(rotate|rotation|orientation)\b/.test(lower),
    lowQuality: /\b(low confidence|low resolution|too few pixels|image too small|poor quality|dpi)\b/.test(lower),
  };
}

function buildWarning(code, severity, message) {
  return { code, severity, message };
}

function dedupeWarnings(warnings) {
  const seen = new Set();
  return warnings.filter((warning) => {
    if (seen.has(warning.code)) {
      return false;
    }
    seen.add(warning.code);
    return true;
  });
}

function scoreOcrQuality(warnings, textDensity) {
  let score = 100;
  for (const warning of warnings) {
    score -= warning.severity === "error" ? 40 : warning.severity === "warning" ? 18 : 6;
  }
  if (textDensity.charsPerPage > 600) {
    score += 6;
  }
  return Math.max(0, Math.min(100, score));
}
