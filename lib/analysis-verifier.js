import {
  extractParagraphArtifactReferences,
  resolveParagraphRelatedArtifacts,
} from "./paragraph-artifact-links.js";

export const ANALYSIS_VERIFICATION_VERSION = 1;

export function verifyBatchAnalysisResults(paper = {}, paragraphs = [], results = [], options = {}) {
  const resultById = new Map((Array.isArray(results) ? results : [])
    .map((item) => [String(item?.paragraphId || item?.id || ""), item])
    .filter(([id]) => id));
  const itemVerifications = [];
  const missingParagraphIds = [];

  for (const paragraph of Array.isArray(paragraphs) ? paragraphs : []) {
    const result = resultById.get(String(paragraph?.id || ""));
    if (!result) {
      missingParagraphIds.push(String(paragraph?.id || ""));
      continue;
    }
    itemVerifications.push(verifyParagraphAnalysis(paper, paragraph, result, options));
  }

  const weakItems = itemVerifications.filter((item) => item.weak);
  return {
    version: ANALYSIS_VERIFICATION_VERSION,
    status: missingParagraphIds.length ? "error" : weakItems.length ? "weak" : "ok",
    missingParagraphIds,
    weakParagraphIds: weakItems.map((item) => item.paragraphId),
    itemVerifications,
    summary: {
      checked: itemVerifications.length,
      missing: missingParagraphIds.length,
      weak: weakItems.length,
      issues: itemVerifications.reduce((sum, item) => sum + item.issues.length, 0),
    },
  };
}

export function verifyParagraphAnalysis(paper = {}, paragraph = {}, analysis = {}, options = {}) {
  const sourceText = normalizeText(paragraph.sourceText || paragraph.text || "");
  const translation = normalizeText(analysis.translation || "");
  const explanation = normalizeText(analysis.explanation || "");
  const coverage = normalizeCoverage(analysis.coverage || analysis.analysisCoverage);
  const issues = [];

  addCoverageIssues(issues, coverage);
  addCompletenessIssues(issues, sourceText, translation, explanation, options);
  addExplanationIssues(issues, sourceText, explanation, coverage);
  addReferenceIssues(issues, paper, paragraph, `${translation}\n${explanation}`);
  addTerminologyIssues(issues, paper, sourceText, `${translation}\n${explanation}`);

  const severityRank = getWorstSeverity(issues);
  return {
    version: ANALYSIS_VERIFICATION_VERSION,
    paragraphId: String(paragraph.id || analysis.paragraphId || ""),
    status: issues.length ? severityRank : "ok",
    weak: issues.some((issue) => issue.severity === "error" || issue.severity === "warn"),
    issues,
    metrics: {
      sourceChars: countMeaningfulChars(sourceText),
      translationChars: countMeaningfulChars(translation),
      explanationChars: countMeaningfulChars(explanation),
      sourceSentences: estimateSentenceCount(sourceText),
      translationSentences: estimateSentenceCount(translation),
      explanationSentences: estimateSentenceCount(explanation),
      references: extractParagraphArtifactReferences(sourceText).length,
      terminologyHits: collectParagraphTerminology(paper, sourceText).length,
      coverageConfidence: coverage?.confidence ?? null,
    },
  };
}

function addCoverageIssues(issues, coverage) {
  if (!coverage) {
    issues.push({
      severity: "warn",
      code: "coverage-missing",
      message: "模型没有返回 coverage，无法确认逐句翻译、章节作用和图表公式覆盖。",
    });
    return;
  }
  if (coverage.translatedAllSentences === false) {
    issues.push({
      severity: "error",
      code: "coverage-translation-incomplete",
      message: "模型自报没有完整翻译所有句子。",
    });
  }
  if (coverage.mentionsSectionRole === false) {
    issues.push({
      severity: "warn",
      code: "coverage-section-role-missing",
      message: "模型自报讲解没有覆盖段落在章节/论文中的作用。",
    });
  }
  if (coverage.mentionsRelevantFormulaOrFigure === false) {
    issues.push({
      severity: "warn",
      code: "coverage-reference-missing",
      message: "模型自报没有覆盖相关公式、图表或代码引用。",
    });
  }
  if (Number.isFinite(coverage.confidence) && coverage.confidence < 0.55) {
    issues.push({
      severity: "warn",
      code: "coverage-low-confidence",
      message: `模型自报置信度偏低：${Math.round(coverage.confidence * 100)}%。`,
    });
  }
}

function addCompletenessIssues(issues, sourceText, translation, explanation, options) {
  const sourceChars = countMeaningfulChars(sourceText);
  const translationChars = countMeaningfulChars(translation);
  const explanationChars = countMeaningfulChars(explanation);

  if (!translationChars) {
    issues.push({
      severity: "error",
      code: "translation-missing",
      message: "缺少 translation。",
    });
  } else if (sourceChars >= 120) {
    const minimum = Math.max(36, Math.floor(sourceChars * Number(options.minimumTranslationRatio || 0.2)));
    if (translationChars < minimum) {
      issues.push({
        severity: "warn",
        code: "translation-too-short",
        message: `翻译明显偏短：原文约 ${sourceChars} 字符，翻译约 ${translationChars} 字符。`,
      });
    }
  }

  if (!explanationChars) {
    issues.push({
      severity: "error",
      code: "explanation-missing",
      message: "缺少 explanation。",
    });
  } else if (sourceChars >= 90 && explanationChars < 42) {
    issues.push({
      severity: "warn",
      code: "explanation-too-short",
      message: `讲解偏短：原文约 ${sourceChars} 字符，讲解约 ${explanationChars} 字符。`,
    });
  }

  if (sourceChars >= 180 &&
    estimateSentenceCount(sourceText) >= 3 &&
    estimateSentenceCount(translation) <= 1 &&
    translationChars < sourceChars * 0.34) {
    issues.push({
      severity: "warn",
      code: "translation-likely-summary",
      message: "原文有多句内容，但翻译像摘要而不是逐句翻译。",
    });
  }
}

function addExplanationIssues(issues, sourceText, explanation, coverage) {
  const sourceChars = countMeaningfulChars(sourceText);
  const explanationChars = countMeaningfulChars(explanation);
  if (sourceChars < 120 || explanationChars < 1) {
    return;
  }

  if (estimateSentenceCount(explanation) <= 1 && explanationChars < 90) {
    issues.push({
      severity: "warn",
      code: "explanation-one-generic-sentence",
      message: "讲解只有一句或近似一句，容易变成泛泛总结。",
    });
  }

  if (coverage?.mentionsSectionRole !== false && !hasSectionRoleCue(explanation) && sourceChars >= 160) {
    issues.push({
      severity: "warn",
      code: "section-role-not-evident",
      message: "讲解中没有明显说明这段在章节或论文论证中的作用。",
    });
  }
}

function addReferenceIssues(issues, paper, paragraph, outputText) {
  const references = extractParagraphArtifactReferences(paragraph?.sourceText || "");
  if (!references.length) {
    return;
  }
  const outputComparable = normalizeComparable(outputText);
  const relatedArtifacts = resolveParagraphRelatedArtifacts(paper, paragraph).slice(0, 8);

  for (const reference of references.slice(0, 8)) {
    const matchedArtifact = relatedArtifacts.find((artifact) => {
      const label = normalizeText(artifact.label || artifact.text || "");
      return label && referenceAppearsInText(reference, label);
    });
    if (referenceAppearsInComparable(reference, outputComparable)) {
      continue;
    }
    const artifactLabel = matchedArtifact?.label ? `（${matchedArtifact.label}）` : "";
    issues.push({
      severity: "warn",
      code: `missing-${reference.kind}-reference`,
      message: `原文引用了 ${reference.raw}${artifactLabel}，但翻译/讲解里没有保留或解释这个引用。`,
      reference: {
        kind: reference.kind,
        number: reference.number,
        raw: reference.raw,
        artifactId: matchedArtifact?.id || "",
      },
    });
  }
}

function addTerminologyIssues(issues, paper, sourceText, outputText) {
  const terms = collectParagraphTerminology(paper, sourceText).slice(0, 10);
  if (!terms.length) {
    return;
  }

  const outputComparable = normalizeComparable(outputText);
  for (const term of terms) {
    const candidates = [term.source, term.zh, ...(term.aliases || [])]
      .map(normalizeComparable)
      .filter((value) => value.length >= 2);
    if (!candidates.length) {
      continue;
    }
    if (candidates.some((candidate) => outputComparable.includes(candidate))) {
      continue;
    }
    issues.push({
      severity: "warn",
      code: "terminology-drift",
      message: `关键术语 "${term.source}" 没有按术语表保留或翻译。`,
      term: term.source,
      expected: term.zh || term.source,
    });
  }
}

function collectParagraphTerminology(paper, sourceText) {
  const sourceComparable = normalizeComparable(sourceText);
  const terms = [];
  for (const term of collectPaperTerminology(paper)) {
    const needles = [term.source, ...(term.aliases || [])]
      .map(normalizeComparable)
      .filter((value) => value.length >= 2);
    if (needles.some((needle) => sourceComparable.includes(needle))) {
      terms.push(term);
    }
  }
  return dedupeTerms(terms);
}

function collectPaperTerminology(paper) {
  const terms = [];
  for (const term of Array.isArray(paper?.deepPaperPlan?.terminology) ? paper.deepPaperPlan.terminology : []) {
    const normalized = normalizeTerm(term);
    if (normalized) {
      terms.push(normalized);
    }
  }
  for (const term of Array.isArray(paper?.paperMemory?.keyTerms) ? paper.paperMemory.keyTerms : []) {
    const normalized = normalizeTerm(term);
    if (normalized) {
      terms.push(normalized);
    }
  }
  for (const sectionDigest of Array.isArray(paper?.sectionDigests) ? paper.sectionDigests : []) {
    for (const term of Array.isArray(sectionDigest.keyTerms) ? sectionDigest.keyTerms : []) {
      const normalized = normalizeTerm(term);
      if (normalized) {
        terms.push(normalized);
      }
    }
  }
  return dedupeTerms(terms)
    .filter((term) => term.zh || looksLikeAcronym(term.source));
}

function normalizeTerm(value) {
  if (typeof value === "string") {
    const source = normalizeText(value);
    return source ? { source, zh: "", aliases: [] } : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const source = normalizeText(value.source || value.term || value.name || value.text || "");
  if (!source) {
    return null;
  }
  return {
    source,
    zh: normalizeText(value.zh || value.translation || value.chinese || ""),
    aliases: normalizeStringList(value.aliases || value.synonyms).slice(0, 8),
  };
}

function normalizeCoverage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const confidence = Number(value.confidence);
  return {
    translatedAllSentences: value.translatedAllSentences !== false,
    mentionsSectionRole: value.mentionsSectionRole !== false,
    mentionsRelevantFormulaOrFigure: value.mentionsRelevantFormulaOrFigure !== false,
    confidence: Number.isFinite(confidence)
      ? confidence > 1 && confidence <= 100 ? confidence / 100 : Math.max(0, Math.min(1, confidence))
      : null,
  };
}

function referenceAppearsInText(reference, text) {
  return referenceAppearsInComparable(reference, normalizeComparable(text));
}

function referenceAppearsInComparable(reference, comparableText) {
  const number = normalizeComparable(reference.number || "");
  const baseNumber = normalizeComparable(reference.baseNumber || reference.number || "");
  if (!number || !comparableText) {
    return false;
  }
  const variants = [number, baseNumber].filter(Boolean);
  if (reference.kind === "figure") {
    variants.push(`figure${number}`, `fig${number}`, `图${number}`, `图${baseNumber}`);
  } else if (reference.kind === "table") {
    variants.push(`table${number}`, `tab${number}`, `表${number}`, `表${baseNumber}`);
  } else if (reference.kind === "equation") {
    variants.push(`equation${number}`, `eq${number}`, `公式${number}`, `方程${number}`, `式${number}`);
  }
  return variants.some((variant) => variant && comparableText.includes(variant));
}

function hasSectionRoleCue(text) {
  return /作用|承接|铺垫|引出|支持|证明|对应|说明|解释|用于|为.+提供|本节|这一节|该节|论文|方法|实验|结论|贡献|论证/.test(text);
}

function getWorstSeverity(issues) {
  if (issues.some((issue) => issue.severity === "error")) {
    return "error";
  }
  if (issues.some((issue) => issue.severity === "warn")) {
    return "warn";
  }
  if (issues.some((issue) => issue.severity === "info")) {
    return "info";
  }
  return "ok";
}

function countMeaningfulChars(text) {
  return String(text || "").replace(/[^\p{L}\p{N}\u4e00-\u9fff]/gu, "").length;
}

function estimateSentenceCount(text) {
  const clean = normalizeText(text);
  if (!clean) {
    return 0;
  }
  const separators = clean.match(/[.!?。！？；;]\s+/g) || clean.match(/[.!?。！？；;]/g) || [];
  return Math.max(1, separators.length + 1);
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeComparable(value) {
  return normalizeText(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\-_:：.,，。()[\]{}（）【】"'“”‘’]/g, "");
}

function normalizeStringList(value) {
  return (Array.isArray(value) ? value : value ? [value] : [])
    .flatMap((item) => typeof item === "string"
      ? item.split(/[;；\n]/)
      : item && typeof item === "object"
        ? [item.source || item.term || item.text || item.label || item.name || ""]
        : [])
    .map(normalizeText)
    .filter(Boolean)
    .filter((item, index, list) => list.findIndex((candidate) =>
      normalizeComparable(candidate) === normalizeComparable(item)) === index);
}

function dedupeTerms(terms) {
  const seen = new Set();
  const result = [];
  for (const term of terms) {
    const key = normalizeComparable(term.source);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(term);
  }
  return result;
}

function looksLikeAcronym(value) {
  const clean = normalizeText(value);
  return /^[A-Z][A-Z0-9-]{1,18}$/.test(clean);
}
