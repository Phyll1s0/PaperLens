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
import {
  PAPER_MEMORY_VERSION,
  normalizePaperMemory,
} from "./paper-memory.js";
import {
  isLikelyDiagramOnlyText,
} from "./segmentation-visual-noise.js";

const MAX_DEBUG_PAGES = 80;
const MAX_BLOCKS_PER_PAGE = 80;
const MAX_PARAGRAPHS = 180;
const MAX_MEMORY_ITEMS = 10;
const MAX_ISSUE_SAMPLES = 3;
const MEMORY_PREVIEW_LIMIT = 260;
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
  const paperMemory = buildPaperMemoryDebug(paper);
  const issueSummary = buildSegmentationIssueSummary(pageReports, paragraphReports);

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
      paperMemoryAvailable: paperMemory.available,
      paperMemoryKeyTerms: paperMemory.counts.keyTerms,
      paperMemoryResources: paperMemory.counts.resources,
      paperMemoryFormulas: paperMemory.counts.formulas,
      paperMemoryVisuals: paperMemory.counts.visuals,
      pageLimitReached,
      paragraphLimitReached,
    },
    issueSummary,
    segmentation: buildSegmentationMeta(paper),
    paperMemory,
    pages: pageReports,
    sections,
    paragraphs: paragraphReports,
    reasonLegend: buildReasonLegend(),
  };
}

function buildSegmentationIssueSummary(pageReports, paragraphReports) {
  const categories = createSegmentationIssueCategories();
  for (const page of pageReports || []) {
    for (const block of page.blocks || []) {
      for (const reason of block.reasons || []) {
        const categoryId = getIssueCategoryForBlockReason(reason);
        if (categoryId) {
          addSegmentationIssueSample(categories, categoryId, {
            source: "block",
            pageNumber: block.pageNumber || page.pageNumber || null,
            blockIndex: block.index,
            preview: block.preview || block.cleanText || "",
            reasons: block.reasons || [],
          });
        }
      }
    }
  }

  for (const paragraph of paragraphReports || []) {
    for (const reason of paragraph.noiseReasons || []) {
      const categoryId = getIssueCategoryForParagraphReason(reason);
      if (categoryId) {
        addSegmentationIssueSample(categories, categoryId, {
          source: "paragraph",
          paragraphId: paragraph.id || "",
          order: paragraph.order,
          pageNumber: paragraph.pageNumber || null,
          pageEndNumber: paragraph.pageEndNumber || paragraph.pageNumber || null,
          preview: paragraph.sourcePreview || "",
          reasons: paragraph.noiseReasons || [],
        });
      }
    }

    if (isCrossPageDebugParagraph(paragraph)) {
      addSegmentationIssueSample(categories, "cross-page", {
        source: "paragraph",
        paragraphId: paragraph.id || "",
        order: paragraph.order,
        pageNumber: paragraph.pageNumber || null,
        pageEndNumber: paragraph.pageEndNumber || null,
        preview: paragraph.sourcePreview || "",
        reasons: ["cross-page"],
      });
    }

    if (isShortFragmentDebugParagraph(paragraph)) {
      addSegmentationIssueSample(categories, "short-fragment", {
        source: "paragraph",
        paragraphId: paragraph.id || "",
        order: paragraph.order,
        pageNumber: paragraph.pageNumber || null,
        pageEndNumber: paragraph.pageEndNumber || paragraph.pageNumber || null,
        preview: paragraph.sourcePreview || "",
        reasons: ["short-fragment"],
      });
    }

    if (isMissingSourceBoxDebugParagraph(paragraph)) {
      addSegmentationIssueSample(categories, "missing-source-box", {
        source: "paragraph",
        paragraphId: paragraph.id || "",
        order: paragraph.order,
        pageNumber: paragraph.pageNumber || null,
        pageEndNumber: paragraph.pageEndNumber || paragraph.pageNumber || null,
        preview: paragraph.sourcePreview || "",
        reasons: ["missing-source-box"],
      });
    }
  }

  const activeCategories = Object.values(categories)
    .filter((category) => category.count > 0)
    .sort((a, b) => {
      const severityOrder = { high: 0, medium: 1, low: 2 };
      const severityDiff = (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3);
      if (severityDiff) {
        return severityDiff;
      }
      return b.count - a.count;
    });

  return {
    total: activeCategories.reduce((sum, category) => sum + category.count, 0),
    categories: activeCategories,
  };
}

function createSegmentationIssueCategories() {
  return {
    author: createIssueCategory("author", "作者/首页噪声", "high", "首页作者、机构、邮箱或题名仍在干扰正文分段。"),
    caption: createIssueCategory("caption", "图表说明", "medium", "图注或表注被识别为正文候选，需要检查视觉材料关联。"),
    table: createIssueCategory("table", "表格主体", "medium", "表格数值或表头像正文一样进入了分段候选。"),
    diagram: createIssueCategory("diagram", "流程图文字", "medium", "图中短标签或流程节点可能混入正文。"),
    references: createIssueCategory("references", "References", "high", "参考文献区或参考文献条目仍在分段链路里出现。"),
    link: createIssueCategory("link", "独立链接", "low", "代码、数据或 DOI 链接应进入资源提示，而不是正文段落。"),
    metadata: createIssueCategory("metadata", "出版/页眉", "low", "会议、版权、arXiv stamp、页眉页脚等版面噪声。"),
    "cross-page": createIssueCategory("cross-page", "跨页段落", "medium", "跨页段落需要检查是否合并自然、页码和上下文是否正确。"),
    "short-fragment": createIssueCategory("short-fragment", "短碎片", "medium", "短段落可能来自误拆、公式碎片或图中文字。"),
    "missing-source-box": createIssueCategory("missing-source-box", "缺少定位", "low", "正文段落缺少 sourceBox，页图定位和 block 对比会变弱。"),
  };
}

function createIssueCategory(id, label, severity, recommendation) {
  return {
    id,
    label,
    severity,
    count: 0,
    recommendation,
    samples: [],
  };
}

function addSegmentationIssueSample(categories, categoryId, sample) {
  const category = categories[categoryId];
  if (!category) {
    return;
  }
  category.count += 1;
  if (category.samples.length >= MAX_ISSUE_SAMPLES) {
    return;
  }
  const preview = truncateDebugText(sample.preview || "", 140);
  category.samples.push({
    source: sample.source || "",
    pageNumber: sample.pageNumber || null,
    pageEndNumber: sample.pageEndNumber || null,
    blockIndex: Number.isFinite(Number(sample.blockIndex)) ? Number(sample.blockIndex) : null,
    paragraphId: sample.paragraphId || "",
    order: Number.isFinite(Number(sample.order)) ? Number(sample.order) : null,
    preview,
    reasons: uniqueStrings(sample.reasons || []).slice(0, 5),
  });
}

function getIssueCategoryForBlockReason(reason) {
  const map = {
    "frontmatter-title": "author",
    "author-affiliation": "author",
    "caption-text": "caption",
    "table-body-like": "table",
    "diagram-only-text": "diagram",
    "references-heading": "references",
    "bibliography-entry": "references",
    "standalone-link": "link",
    "publication-metadata": "metadata",
    "running-header": "metadata",
    "pdf-extraction-garbage": "metadata",
  };
  return map[reason] || "";
}

function getIssueCategoryForParagraphReason(reason) {
  const map = {
    "frontmatter-title": "author",
    "author-affiliation": "author",
    caption: "caption",
    "caption-text": "caption",
    "table-body": "table",
    "table-body-like": "table",
    "visual-text": "diagram",
    "diagram-only-text": "diagram",
    "references-section": "references",
    "references-heading": "references",
    "bibliography-entry": "references",
    "standalone-link": "link",
    "publication-metadata": "metadata",
    "running-header": "metadata",
    "header-footer": "metadata",
    "pdf-extraction-garbage": "metadata",
  };
  return map[reason] || "";
}

function isCrossPageDebugParagraph(paragraph) {
  const start = Number(paragraph?.pageNumber || 0);
  const end = Number(paragraph?.pageEndNumber || start || 0);
  return start > 0 && end > start;
}

function isShortFragmentDebugParagraph(paragraph) {
  if (!isReadingDebugParagraph(paragraph)) {
    return false;
  }
  const textLength = Number(paragraph?.textLength || 0);
  return textLength > 0 && textLength < 48;
}

function isMissingSourceBoxDebugParagraph(paragraph) {
  return isReadingDebugParagraph(paragraph) && !paragraph?.sourceBox;
}

function isReadingDebugParagraph(paragraph) {
  return paragraph &&
    paragraph.kind !== "heading" &&
    paragraph.analysisEligible !== false &&
    !paragraph.hidden;
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
  const memoryStage = paper?.segmentationStages?.paperMemory || null;
  const quality = paper?.segmentationQualityAudit || null;
  const validation = paper?.segmentationValidation || null;
  return {
    mode: paper?.segmentationMode || "",
    editedAt: paper?.segmentationEditedAt || "",
    planSource: plan?.source || paper?.structureMap?.source || "",
    fallbackStrategy: fallback?.strategy || "",
    fallbackReason: fallback?.reason || "",
    fallbackChunks: Array.isArray(fallback?.chunks) ? fallback.chunks.length : 0,
    paperMemorySource: memoryStage?.source || paper?.paperMemory?.source || "",
    paperMemoryResources: Number(memoryStage?.resources || 0) || 0,
    paperMemoryFormulas: Number(memoryStage?.formulas || 0) || 0,
    paperMemoryVisuals: Number(memoryStage?.visuals || 0) || 0,
    quality,
    validation,
  };
}

function buildPaperMemoryDebug(paper) {
  const rawMemory = paper?.paperMemory || null;
  if (!rawMemory || rawMemory.version !== PAPER_MEMORY_VERSION) {
    return {
      available: false,
      source: "",
      updatedAt: "",
      paperTitle: "",
      summary: "",
      mainThread: "",
      counts: {
        contributions: 0,
        keyTerms: 0,
        formulas: 0,
        visuals: 0,
        resources: 0,
        nonReadingGuidance: 0,
        segmentationGuidance: 0,
        chunkSummaries: 0,
      },
      contributions: [],
      keyTerms: [],
      formulas: [],
      visuals: [],
      resources: [],
      nonReadingGuidance: [],
      segmentationGuidance: [],
      chunkSummaries: [],
    };
  }

  const memory = normalizePaperMemory(rawMemory, paper, paper?.structureMap || null);
  return {
    available: true,
    source: memory.source || "",
    updatedAt: memory.updatedAt || "",
    paperTitle: memory.paperTitle || "",
    summary: truncateDebugText(memory.summary || "", MEMORY_PREVIEW_LIMIT),
    mainThread: truncateDebugText(memory.mainThread || "", MEMORY_PREVIEW_LIMIT),
    counts: {
      contributions: memory.contributions.length,
      keyTerms: memory.keyTerms.length,
      formulas: memory.importantFormulas.length,
      visuals: memory.importantVisuals.length,
      resources: memory.resources.length,
      nonReadingGuidance: memory.nonReadingGuidance.length,
      segmentationGuidance: memory.segmentationGuidance.length,
      chunkSummaries: memory.chunkSummaries.length,
    },
    contributions: memory.contributions.slice(0, MAX_MEMORY_ITEMS),
    keyTerms: memory.keyTerms.slice(0, 18),
    formulas: memory.importantFormulas.slice(0, MAX_MEMORY_ITEMS).map(formatMemoryFormulaDebug),
    visuals: memory.importantVisuals.slice(0, MAX_MEMORY_ITEMS).map(formatMemoryVisualDebug),
    resources: memory.resources.slice(0, MAX_MEMORY_ITEMS).map(formatMemoryResourceDebug),
    nonReadingGuidance: memory.nonReadingGuidance.slice(0, MAX_MEMORY_ITEMS),
    segmentationGuidance: memory.segmentationGuidance.slice(0, MAX_MEMORY_ITEMS),
    chunkSummaries: memory.chunkSummaries.slice(0, MAX_MEMORY_ITEMS),
  };
}

function formatMemoryFormulaDebug(item) {
  return {
    label: item?.label || "",
    pageNumber: item?.pageNumber || null,
    text: truncateDebugText(item?.text || "", MEMORY_PREVIEW_LIMIT),
    purpose: truncateDebugText(item?.purpose || "", 180),
  };
}

function formatMemoryVisualDebug(item) {
  return {
    label: item?.label || "",
    pageNumber: item?.pageNumber || null,
    type: item?.type || "",
    description: truncateDebugText(item?.description || "", MEMORY_PREVIEW_LIMIT),
  };
}

function formatMemoryResourceDebug(item) {
  return {
    type: item?.type || "",
    url: item?.url || "",
    pageNumber: item?.pageNumber || null,
    label: truncateDebugText(item?.label || "", 120),
    whyImportant: truncateDebugText(item?.whyImportant || "", 180),
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
