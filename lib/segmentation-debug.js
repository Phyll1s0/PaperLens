import {
  isLikelyBibliographyEntryText,
  isLikelyFrontMatterTitleText,
  isLikelyPageNumberOrRunningHeaderText,
  isLikelyPdfExtractionGarbageText,
  isLikelyPublicationMetadataText,
  isReferencesSectionTitleText,
  stripPublicationMetadataFragments,
} from "./segmentation-repair.js";
import {
  isLikelyStructureSectionHeading,
  normalizeStructureHeadingText,
} from "./segmentation-structure.js";
import {
  rescueReadableSegmentsFromMixedBlock,
} from "./segmentation-block-rescue.js";

const MAX_DEBUG_PAGES = 80;
const MAX_BLOCKS_PER_PAGE = 80;
const MAX_PARAGRAPHS = 180;
const PREVIEW_LIMIT = 180;

export function buildPaperSegmentationDebugReport(paper, options = {}) {
  const now = options.now || (() => new Date());
  const pages = Array.isArray(paper?.extractionPages) ? paper.extractionPages : [];
  const pageImages = Array.isArray(paper?.pageImages) ? paper.pageImages : [];
  const paragraphs = Array.isArray(paper?.paragraphs) ? paper.paragraphs : [];
  const pageReports = pages
    .slice(0, MAX_DEBUG_PAGES)
    .map((page) => buildPageDebug(attachDebugPageImage(page, pageImages)));
  const flatBlocks = pageReports.flatMap((page) => page.blocks);
  const paragraphReports = paragraphs
    .slice(0, Number(options.maxParagraphs || MAX_PARAGRAPHS))
    .map((paragraph, index) => buildParagraphDebug(paper, paragraph, index, flatBlocks));
  const sections = buildSectionDebug(paper);
  const droppedBlocks = flatBlocks.filter((block) => block.decision === "drop");
  const keptBlocks = flatBlocks.filter((block) => block.decision === "keep");
  const hiddenParagraphs = paragraphReports.filter((paragraph) => paragraph.hidden || paragraph.analysisEligible === false);
  const paragraphsWithNoise = paragraphReports.filter((paragraph) => paragraph.noiseReasons.length);
  const paragraphsWithSourceBox = paragraphReports.filter((paragraph) => paragraph.sourceBox);
  const paragraphLimitReached = paragraphs.length > paragraphReports.length;
  const pageLimitReached = pages.length > pageReports.length;

  return {
    paperId: paper?.id || "",
    title: paper?.title || paper?.filename || "",
    generatedAt: now().toISOString(),
    summary: {
      pages: pages.length,
      reportedPages: pageReports.length,
      extractionBlocks: countExtractionBlocks(pages),
      reportedBlocks: flatBlocks.length,
      keptBlocks: keptBlocks.length,
      droppedBlocks: droppedBlocks.length,
      paragraphs: paragraphs.length,
      reportedParagraphs: paragraphReports.length,
      hiddenParagraphs: hiddenParagraphs.length,
      paragraphsWithSourceBox: paragraphsWithSourceBox.length,
      paragraphsWithNoise: paragraphsWithNoise.length,
      sections: Array.isArray(paper?.sections) ? paper.sections.length : 0,
      structureSections: Array.isArray(paper?.structureMap?.sections) ? paper.structureMap.sections.length : 0,
      segmentationPlanItems: Array.isArray(paper?.segmentationPlan)
        ? paper.segmentationPlan.length
        : Array.isArray(paper?.structureMap?.segmentationPlan)
          ? paper.structureMap.segmentationPlan.length
          : 0,
      pageLimitReached,
      paragraphLimitReached,
    },
    segmentation: buildSegmentationMeta(paper),
    pages: pageReports,
    sections,
    paragraphs: paragraphReports,
    reasonLegend: buildReasonLegend(),
  };
}

function attachDebugPageImage(page, pageImages) {
  if (page?.imagePath) {
    return page;
  }

  const pageImage = pageImages.find((item) => Number(item?.pageNumber || 0) === Number(page?.pageNumber || 0));
  if (!pageImage?.imagePath) {
    return page;
  }

  return {
    ...page,
    imagePath: pageImage.imagePath,
    imageWidth: page.imageWidth || pageImage.imageWidth || null,
    imageHeight: page.imageHeight || pageImage.imageHeight || null,
  };
}

export function buildSegmentationBlockDebug(block, page = {}) {
  const rawText = String(block?.rawText || block?.text || "");
  const cleanText = normalizeDebugText(stripPublicationMetadataFragments(rawText));
  const context = {
    ...block,
    text: cleanText,
    pageNumber: Number(page?.pageNumber || block?.pageNumber || 0),
  };
  const reasons = getDropReasons(rawText, cleanText, context);
  const tags = getBlockTags(rawText, cleanText, context, reasons);
  const rescuedSegments = rescueReadableSegmentsFromMixedBlock({ ...block, rawText }, context)
    .map((segment) => ({
      reason: segment.reason || "mixed-block-body-tail",
      preview: truncateDebugText(segment.text || "", PREVIEW_LIMIT),
    }));
  if (rescuedSegments.length) {
    tags.push("rescued-text");
  }
  return {
    index: Number(block?.index || 0),
    pageNumber: context.pageNumber || null,
    decision: reasons.length ? "drop" : "keep",
    reasons,
    tags,
    preview: truncateDebugText(cleanText || rawText, PREVIEW_LIMIT),
    rawPreview: rawText && rawText !== cleanText ? truncateDebugText(rawText, PREVIEW_LIMIT) : "",
    cleanText,
    rescuedSegments,
    textLength: cleanText.length,
    rawLength: rawText.length,
    box: pickDebugBlockBox(block),
    lineCount: Number(block?.lineCount || 0) || null,
    column: Number.isFinite(Number(block?.column)) ? Number(block.column) : null,
  };
}

function buildPageDebug(page) {
  const rawBlocks = Array.isArray(page?.blocks) && page.blocks.length
    ? page.blocks
    : splitTextPageIntoBlocks(page?.text || "");
  const blocks = rawBlocks
    .slice(0, MAX_BLOCKS_PER_PAGE)
    .map((block, index) => buildSegmentationBlockDebug({ ...block, index }, page));
  return {
    pageNumber: Number(page?.pageNumber || 0) || null,
    blockCount: rawBlocks.length,
    reportedBlockCount: blocks.length,
    keptBlocks: blocks.filter((block) => block.decision === "keep").length,
    droppedBlocks: blocks.filter((block) => block.decision === "drop").length,
    visualRegions: Array.isArray(page?.visualRegions) ? page.visualRegions.length : 0,
    imagePath: page?.imagePath || null,
    imageWidth: page?.imageWidth || null,
    imageHeight: page?.imageHeight || null,
    width: page?.width || null,
    height: page?.height || null,
    blocks,
  };
}

function buildParagraphDebug(paper, paragraph, index, flatBlocks) {
  const sourceText = normalizeDebugText(paragraph?.sourceText || "");
  const section = findParagraphSection(paper, paragraph);
  const pageNumber = Number(paragraph?.pageNumber || 0) || null;
  const pageEndNumber = Number(paragraph?.pageEndNumber || pageNumber || 0) || null;
  const relatedBlock = findClosestDebugBlock(paragraph, flatBlocks);
  const noiseReasons = getParagraphNoiseReasons(paragraph, section);
  return {
    id: paragraph?.id || `paragraph_${index}`,
    order: Number.isFinite(Number(paragraph?.order)) ? Number(paragraph.order) : index,
    kind: paragraph?.kind || "paragraph",
    status: paragraph?.analysisStatus || "",
    pageNumber,
    pageEndNumber,
    sectionId: paragraph?.sectionId || "",
    sectionTitle: section?.title || paragraph?.sectionTitleHint || "",
    plannedSectionId: paragraph?.plannedSectionId || "",
    segmentationRole: paragraph?.segmentationRole || "",
    sourcePreview: truncateDebugText(sourceText, 260),
    textLength: sourceText.length,
    analysisEligible: paragraph?.analysisEligible !== false,
    hidden: Boolean(paragraph?.hidden),
    sourceBox: paragraph?.sourceBox || null,
    sourceBlock: relatedBlock ? {
      pageNumber: relatedBlock.pageNumber,
      index: relatedBlock.index,
      decision: relatedBlock.decision,
      reasons: relatedBlock.reasons,
      preview: relatedBlock.preview,
      matchScore: relatedBlock.matchScore,
    } : null,
    relatedArtifactIds: Array.isArray(paragraph?.relatedArtifactIds) ? paragraph.relatedArtifactIds : [],
    noiseReasons,
    segmentationNoise: paragraph?.segmentationNoise || null,
  };
}

function buildSectionDebug(paper) {
  const sections = Array.isArray(paper?.sections) ? paper.sections : [];
  const paragraphs = Array.isArray(paper?.paragraphs) ? paper.paragraphs : [];
  return sections.map((section, index) => {
    const sectionParagraphs = paragraphs.filter((paragraph) => paragraph.sectionId === section.id);
    const pages = sectionParagraphs
      .map((paragraph) => Number(paragraph.pageNumber || 0))
      .filter(Number.isFinite)
      .filter((value) => value > 0);
    return {
      id: section.id || `section_${index}`,
      title: section.title || "未命名章节",
      order: Number.isFinite(Number(section.order)) ? Number(section.order) : index,
      paragraphCount: sectionParagraphs.length,
      firstPage: pages.length ? Math.min(...pages) : null,
      lastPage: pages.length ? Math.max(...pages) : null,
      source: section.source || "",
    };
  });
}

function buildSegmentationMeta(paper) {
  const fallback = paper?.segmentationStages?.fallback || null;
  const plan = paper?.segmentationStages?.plan || null;
  const quality = paper?.segmentationQualityAudit || null;
  const validation = paper?.segmentationValidation || null;
  return {
    mode: paper?.segmentationMode || "",
    editedAt: paper?.segmentationEditedAt || "",
    planSource: plan?.source || paper?.structureMap?.source || "",
    fallbackStrategy: fallback?.strategy || "",
    fallbackReason: fallback?.reason || "",
    fallbackChunks: Array.isArray(fallback?.chunks) ? fallback.chunks.length : 0,
    quality,
    validation,
  };
}

function getDropReasons(rawText, cleanText, context) {
  const reasons = [];
  if (!cleanText) {
    reasons.push("empty-after-clean");
    return reasons;
  }

  if (isLikelyPdfExtractionGarbageText(rawText) || isLikelyPdfExtractionGarbageText(cleanText)) {
    reasons.push("pdf-extraction-garbage");
  }

  if (isLikelyFrontMatterTitleText(cleanText, context)) {
    reasons.push("frontmatter-title");
  }

  if (isLikelyPublicationMetadataText(cleanText)) {
    reasons.push("publication-metadata");
  }

  if (isLikelyPageNumberOrRunningHeaderText(cleanText)) {
    reasons.push("running-header");
  }

  if (isLikelyCaptionText(cleanText)) {
    reasons.push("caption-text");
  }

  if (isReferencesSectionTitleText(cleanText)) {
    reasons.push("references-heading");
  } else if (isLikelyBibliographyEntryText(cleanText)) {
    reasons.push("bibliography-entry");
  }

  if (isLikelyAuthorOrAffiliationText(cleanText, context)) {
    reasons.push("author-affiliation");
  }

  if (isLikelyStandaloneLinkText(cleanText)) {
    reasons.push("standalone-link");
  }

  if (isLikelyDiagramOnlyText(cleanText, context)) {
    reasons.push("diagram-only-text");
  }

  if (isLikelyTableBodyText(cleanText, context)) {
    reasons.push("table-body-like");
  }

  return uniqueStrings(reasons);
}

function getBlockTags(rawText, cleanText, context, reasons) {
  const tags = [];
  if (rawText && normalizeDebugText(rawText) !== cleanText) {
    tags.push("metadata-stripped");
  }
  if (!reasons.length && isLikelyStructureSectionHeading(cleanText, context)) {
    tags.push("heading-candidate");
    tags.push(normalizeStructureHeadingText(cleanText));
  }
  if (cleanText.length < 40) {
    tags.push("short-block");
  }
  if (Number(context.lineCount || 0) >= 6) {
    tags.push("multi-line-block");
  }
  return uniqueStrings(tags).filter(Boolean).slice(0, 5);
}

function getParagraphNoiseReasons(paragraph, section) {
  const text = normalizeDebugText(paragraph?.sourceText || "");
  const context = {
    ...paragraph,
    sectionTitle: section?.title || paragraph?.sectionTitleHint || "",
  };
  const reasons = getDropReasons(text, text, context);
  if (paragraph?.analysisEligible === false) {
    reasons.push("analysis-ineligible");
  }
  if (paragraph?.hidden) {
    reasons.push("hidden");
  }
  if (paragraph?.segmentationNoise?.reason) {
    reasons.push(paragraph.segmentationNoise.reason);
  }
  return uniqueStrings(reasons);
}

function findParagraphSection(paper, paragraph) {
  const sections = Array.isArray(paper?.sections) ? paper.sections : [];
  return sections.find((section) => section.id === paragraph?.sectionId) || null;
}

function findClosestDebugBlock(paragraph, flatBlocks) {
  const pageNumber = Number(paragraph?.pageNumber || 0);
  if (!pageNumber || !paragraph?.sourceBox || !flatBlocks.length) {
    return null;
  }

  const candidates = flatBlocks.filter((block) =>
    block.pageNumber === pageNumber &&
    block.box &&
    block.decision !== "drop");
  if (!candidates.length) {
    return null;
  }

  const sourceBox = paragraph.sourceBox;
  let best = null;
  for (const block of candidates) {
    const overlap = boxOverlapRatio(sourceBox, block.box);
    const yDistance = Math.abs(Number(sourceBox.y || 0) - Number(block.box.y || 0));
    const score = overlap * 1000 - yDistance;
    if (!best || score > best.matchScore) {
      best = { ...block, matchScore: Number(score.toFixed(2)) };
    }
  }
  return best && best.matchScore > -160 ? best : null;
}

function countExtractionBlocks(pages) {
  return (pages || []).reduce((sum, page) => {
    if (Array.isArray(page?.blocks) && page.blocks.length) {
      return sum + page.blocks.length;
    }
    return sum + splitTextPageIntoBlocks(page?.text || "").length;
  }, 0);
}

function splitTextPageIntoBlocks(text) {
  return String(text || "")
    .split(/\n{2,}|\r?\n/)
    .map((line) => normalizeDebugText(line))
    .filter(Boolean)
    .map((line, index) => ({
      text: line,
      index,
      y: index * 18,
      lineCount: 1,
    }));
}

function normalizeDebugText(text) {
  return String(text || "")
    .replace(/[ \t]*\n[ \t]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateDebugText(text, limit) {
  const clean = normalizeDebugText(text);
  if (clean.length <= limit) {
    return clean;
  }
  return `${clean.slice(0, Math.max(0, limit - 1)).trim()}…`;
}

function pickDebugBlockBox(block) {
  const x = Number(block?.x);
  const y = Number(block?.y);
  const width = Number(block?.width);
  const height = Number(block?.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return null;
  }
  return { x, y, width, height };
}

function boxOverlapRatio(a, b) {
  const ax = Number(a?.x || 0);
  const ay = Number(a?.y || 0);
  const aw = Number(a?.width || 0);
  const ah = Number(a?.height || 0);
  const bx = Number(b?.x || 0);
  const by = Number(b?.y || 0);
  const bw = Number(b?.width || 0);
  const bh = Number(b?.height || 0);
  if (aw <= 0 || ah <= 0 || bw <= 0 || bh <= 0) {
    return 0;
  }
  const xOverlap = Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx));
  const yOverlap = Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));
  const overlapArea = xOverlap * yOverlap;
  const smallerArea = Math.min(aw * ah, bw * bh);
  return smallerArea ? overlapArea / smallerArea : 0;
}

function isLikelyCaptionText(text) {
  return /^(?:figure|fig\.|table|tbl\.)\s+\d+[a-z]?\s*[:.]/i.test(text);
}

function isLikelyAuthorOrAffiliationText(text, context = {}) {
  const pageNumber = Number(context.pageNumber || 0);
  const emails = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  const groupedEmail = /\{[^}]{2,180}\}\s*@\s*[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text);
  if (groupedEmail && pageNumber <= 2 && text.length < 1400) {
    return true;
  }

  if (emails.length >= 2 && (text.length < 520 || pageNumber <= 2 && text.length < 1400)) {
    return true;
  }
  if (emails.length && pageNumber <= 2 && text.length < 280 && !/[.!?。！？]/.test(text)) {
    return true;
  }
  return /\b(?:university|institute|college|department|laboratory|labs|school of|author names are listed|equal contribution|corresponding author)\b/i.test(text) &&
    pageNumber <= 2 &&
    text.length < 520 &&
    !hasMultipleSentences(text);
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

function isLikelyDiagramOnlyText(text, context = {}) {
  const lineCount = Number(context.lineCount || 1);
  const averageLineLength = text.length / Math.max(1, lineCount);
  const diagramTokens = (text.match(/\b(?:LLM|Query|Chunk|Task|Final|Summary|Checker|Workflow|GPU|Node|Layer|Input|Output|Encoder|Decoder|Figure|Token)\b/gi) || []).length;
  const sentenceLike = /[.!?。！？][)"'\]]?(\s|$)/.test(text);
  return lineCount >= 4 && averageLineLength < 42 && diagramTokens >= 4 && !sentenceLike;
}

function isLikelyTableBodyText(text, context = {}) {
  const lineCount = Number(context.lineCount || 1);
  const numberTokens = (text.match(/\b\d+(?:[.,]\d+)*%?\b/g) || []).length;
  const tableTokens = /\b(dataset|granularity|method|model|metric|mae|mse|rmse|accuracy|precision|recall|baseline|ours|avg|mean|layers?|heads?|vocab|params?|dmodel|dff)\b/i.test(text);
  const densePipes = (text.match(/\|/g) || []).length >= 3;
  return lineCount <= 8 && text.length < 420 && (densePipes || (numberTokens >= 5 && tableTokens));
}

function hasMultipleSentences(text) {
  return (text.match(/[.!?。！？][)"'\]]?(\s|$)/g) || []).length >= 2;
}

function uniqueStrings(items) {
  return [...new Set(items.filter(Boolean))];
}

function buildReasonLegend() {
  return {
    "empty-after-clean": "清洗后为空。",
    "pdf-extraction-garbage": "PDF 提取出了编码/控制字符垃圾。",
    "frontmatter-title": "首页题名，不应重复进入正文段落。",
    "publication-metadata": "会议、版权、DOI、arXiv 等出版元数据。",
    "running-header": "页眉、页脚或页码。",
    "caption-text": "图注或表注文本。",
    "references-heading": "References 标题。",
    "bibliography-entry": "参考文献条目。",
    "author-affiliation": "作者、邮箱或机构信息。",
    "standalone-link": "独立链接或 DOI。",
    "diagram-only-text": "更像图中文字而非正文自然段。",
    "table-body-like": "更像表格主体。",
    "analysis-ineligible": "当前段落已被标记为不参与讲解。",
    hidden: "当前段落被用户或系统隐藏。",
  };
}
