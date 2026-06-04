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
  rescueReadableSegmentsFromMixedBlock,
} from "./segmentation-block-rescue.js";
import {
  rebuildReadableBlocksFromLineClusters,
} from "./segmentation-line-rebuild.js";
import {
  classifyPageArtifact,
  isBlockCoveredByVisualStructure,
  normalizeArtifactText,
  pickBlockBox,
} from "./visual-artifacts.js";
import {
  isLikelyDiagramOnlyText,
} from "./segmentation-visual-noise.js";
import {
  classifyFormulaTextRole,
} from "./artifact-classifier.js";
import {
  detectSourceLeadIn,
} from "../public/rich-text-utils.js";

const TWO_COLUMN_MIN_BLOCKS = 2;
const SEMANTIC_LEAD_IN_PATTERN = /^(?:(?:key\s+takeaways?|takeaways?)|(?:definition|theorem|lemma|proposition|corollary|assumption|remark|observation|example|proof|claim|property|intuition|note))\b(?:\s+(?:\d+(?:\.\d+)*|[A-Z]))?(?:\s*\([^)]{1,80}\))?\s*(?:[:.;-]|\s+-\s+)?/i;

export function isProtectedSemanticLeadInText(text) {
  const clean = normalizeParagraph(text);
  if (clean.length < 28) {
    return false;
  }

  const match = clean.match(SEMANTIC_LEAD_IN_PATTERN);
  if (!match) {
    return false;
  }

  const tail = clean.slice(match[0].length).trim();
  const tailWords = tail.match(/\b[\p{L}\p{N}][\p{L}\p{N}-]*\b/gu) || [];
  return tail.length >= 18 &&
    tailWords.length >= 4 &&
    /[.!?;:)]|\b(?:is|are|denote|denotes|defined|called|given|where|let|we|the)\b/i.test(tail);
}

export function buildSegmentationPageText(page, options = {}) {
  const blocks = getReadablePageBlocks(page, options);
  if (blocks.length) {
    return blocks
      .map((block, index) => formatSegmentationPageBlock(page, block, index))
      .join("\n\n");
  }

  return String(page?.text || "");
}

export function getReadablePageBlocks(page, options = {}) {
  if (Array.isArray(page?.blocks) && page.blocks.length) {
    const blocks = [];
    for (const [rawIndex, rawBlock] of page.blocks.entries()) {
      const block = {
        ...rawBlock,
        originalIndex: Number.isFinite(Number(rawBlock?.originalIndex)) ? Number(rawBlock.originalIndex) : rawIndex,
        rawText: String(rawBlock?.text || ""),
        text: normalizeReadableBlockText(rawBlock?.text || ""),
      };
      if (!block.text) {
        continue;
      }

      const rebuiltBlocks = buildLineClusterReadableBlocks(block, page, options);
      if (rebuiltBlocks.length) {
        blocks.push(...rebuiltBlocks);
        continue;
      }

      if (!isLikelyNonReadingBlock(block, page, options)) {
        blocks.push(block);
        continue;
      }

      blocks.push(...buildRescuedReadableBlocks(block, page, options));
    }

    return blocks.length ? sortReadableBlocksForSegmentation(blocks, page) : [];
  }

  return extractTextBlocks(page?.text || "");
}

export function getRecoverableFilteredPageBlocks(page, options = {}) {
  if (!Array.isArray(page?.blocks) || !page.blocks.length) {
    return [];
  }

  const readableBlocks = getReadablePageBlocks(page, options);
  const recoverable = [];
  for (const [rawIndex, rawBlock] of page.blocks.entries()) {
    const block = {
      ...rawBlock,
      originalIndex: Number.isFinite(Number(rawBlock?.originalIndex)) ? Number(rawBlock.originalIndex) : rawIndex,
      rawText: String(rawBlock?.text || ""),
      text: normalizeReadableBlockText(rawBlock?.text || ""),
    };
    if (!block.text || isBlockRepresentedInReadableBlocks(block, readableBlocks)) {
      continue;
    }

    const reason = classifyRecoverableFilteredBlockReason(block, page, options);
    if (!isRecoverableFilteredBlock(block, reason)) {
      continue;
    }

    recoverable.push({
      ...block,
      pageNumber: page?.pageNumber || block.pageNumber || 0,
      filteredReason: reason,
      recoverableFilteredBlock: true,
    });
  }

  return sortReadableBlocksForSegmentation(recoverable, page);
}

export function formatSegmentationPageBlock(page, block, index) {
  const text = typeof block === "string" ? block : block.text;
  const clean = normalizeParagraph(text);
  if (typeof block === "string") {
    return `[B${index + 1}] ${clean}`;
  }

  const pageWidth = Number(page?.width || 0);
  const pageHeight = Number(page?.height || 0);
  const box = pickBlockBox(block);
  const meta = [`B${index + 1}`, `p=${page?.pageNumber || "?"}`];
  const artifactHint = classifyPageArtifact(block);
  if (artifactHint) {
    meta.push(`artifact=${artifactHint}`);
  } else {
    const formulaRole = classifyFormulaTextRole(clean, block);
    if (formulaRole.role === "inline-math" || formulaRole.role === "equation-number") {
      meta.push(`math=${formulaRole.role}`);
    }
  }
  if (box && pageWidth && pageHeight) {
    meta.push(
      `x=${formatSegmentationRatio(box.x, pageWidth)}`,
      `y=${formatSegmentationRatio(box.y, pageHeight)}`,
      `w=${formatSegmentationRatio(box.width, pageWidth)}`,
      `h=${formatSegmentationRatio(box.height, pageHeight)}`,
    );
  }
  if (Number(block.column || 0)) {
    meta.push(`col=${block.column}`);
  }
  if (Number(block.lineCount || 0)) {
    meta.push(`lines=${block.lineCount}`);
  }
  const leadIn = detectSourceLeadIn(clean, block);
  if (leadIn?.text) {
    meta.push(`lead=${formatSegmentationMetaValue(leadIn.text)}`);
  }
  if (block.rescuedFromMixedBlock) {
    meta.push(`rescued=${block.rescueReason || "mixed"}`);
  }
  if (block.rebuiltFromLineCluster) {
    meta.push(`cluster=${Number(block.lineClusterIndex || 0) + 1}`);
  }

  return `[${meta.join(" ")}] ${clean}`;
}

function formatSegmentationMetaValue(value) {
  return JSON.stringify(String(value || "").replace(/\s+/g, " ").trim());
}

export function normalizeReadableBlockText(text) {
  return normalizeParagraph(stripPublicationMetadataFragments(text));
}

export function extractTextBlocks(text) {
  const normalized = String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/-\n(?=[a-z])/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!normalized) {
    return [];
  }

  const blankSplit = normalized
    .split(/\n\s*\n/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (blankSplit.length > 1) {
    return blankSplit;
  }

  const lines = normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const blocks = [];
  let current = "";

  for (const line of lines) {
    const heading = isLikelyHeading(line);

    if (heading && current) {
      blocks.push(current);
      current = "";
    }

    if (heading) {
      blocks.push(line);
      continue;
    }

    current = current ? `${current} ${line}` : line;
    const endsSentence = /[.!?。！？][)"'\]]?$/.test(line);

    if ((endsSentence && current.length > 360) || current.length > 1300) {
      blocks.push(current);
      current = "";
    }
  }

  if (current) {
    blocks.push(current);
  }

  return blocks;
}

export function sortReadableBlocksForSegmentation(blocks = [], page = {}) {
  const decorated = blocks
    .map((block, index) => decorateReadableBlock(block, index, page))
    .filter((item) => item.block);
  if (!decorated.length || !decorated.some((item) => item.hasBox)) {
    return blocks;
  }

  const leftCount = decorated.filter((item) => item.readingColumn === 1).length;
  const rightCount = decorated.filter((item) => item.readingColumn === 2).length;
  const twoColumn = leftCount >= TWO_COLUMN_MIN_BLOCKS && rightCount >= TWO_COLUMN_MIN_BLOCKS;
  const anchors = twoColumn
    ? decorated
      .filter((item) => item.readingColumn === 0 && item.hasBox)
      .sort(compareByPosition)
    : [];

  for (const item of decorated) {
    item.readingBand = twoColumn ? getReadingBand(item, anchors) : 0;
  }

  return decorated
    .sort((a, b) => compareReadableBlocks(a, b, { twoColumn }))
    .map((item) => item.block);
}

function buildRescuedReadableBlocks(block, page, options = {}) {
  const segments = rescueReadableSegmentsFromMixedBlock(block, {
    pageNumber: page?.pageNumber || block.pageNumber || 0,
  });
  if (!segments.length) {
    return [];
  }

  return segments
    .map((segment, index) => {
      const text = normalizeReadableBlockText(segment.text || "");
      const rescuedBlock = {
        ...block,
        ...estimateRescuedBlockGeometry(block, segment),
        rawText: segment.text || "",
        text,
        rescuedFromMixedBlock: true,
        rescueReason: segment.reason || "mixed-block-body-tail",
        rescueIndex: index,
        originalRawText: block.rawText || block.text || "",
      };
      const context = {
        ...rescuedBlock,
        pageNumber: page?.pageNumber || block.pageNumber || 0,
      };
      const protectedLeadIn = isProtectedSemanticLeadInText(text);
      if (!text ||
        isLikelyPdfExtractionGarbageText(text) ||
        !protectedLeadIn && (
          isLikelyNonReadingParagraphText(text, context) ||
          isLikelyFrontMatterTitleText(text, context) ||
          classifyPageArtifact(rescuedBlock) ||
          isBlockCoveredByVisualStructure(rescuedBlock, page) ||
          isSuppressedByMemoryGuidance(rescuedBlock, page, options.paperMemory)
        )) {
        return null;
      }
      return rescuedBlock;
    })
    .filter(Boolean);
}

function buildLineClusterReadableBlocks(block, page, options = {}) {
  const rebuilt = rebuildReadableBlocksFromLineClusters(block, page, options);
  if (!rebuilt.length) {
    return [];
  }

  return rebuilt
    .map((candidate) => {
      const text = normalizeReadableBlockText(candidate.text || "");
      const rebuiltBlock = {
        ...candidate,
        rawText: candidate.rawText || candidate.text || "",
        text,
        pageNumber: page?.pageNumber || candidate.pageNumber || block.pageNumber || 0,
      };
      const context = {
        ...rebuiltBlock,
        pageNumber: page?.pageNumber || rebuiltBlock.pageNumber || 0,
      };
      const protectedLeadIn = isProtectedSemanticLeadInText(text);
      if (!text ||
        isLikelyPdfExtractionGarbageText(text) ||
        !protectedLeadIn && (
          isLikelyNonReadingParagraphText(text, context) ||
          isLikelyFrontMatterTitleText(text, context) ||
          classifyPageArtifact(rebuiltBlock) ||
          isBlockCoveredByVisualStructure(rebuiltBlock, page) ||
          isSuppressedByMemoryGuidance(rebuiltBlock, page, options.paperMemory)
        )) {
        return null;
      }
      return rebuiltBlock;
    })
    .filter(Boolean);
}

function estimateRescuedBlockGeometry(block, segment) {
  if (segment?.box &&
    [segment.box.x, segment.box.y, segment.box.width, segment.box.height].every((value) => Number.isFinite(Number(value))) &&
    Number(segment.box.width) > 0 &&
    Number(segment.box.height) > 0) {
    return {
      x: Number(segment.box.x),
      y: Number(segment.box.y),
      width: Number(segment.box.width),
      height: Number(segment.box.height),
      lineCount: Math.max(1, Number(segment.lineCount || 1)),
    };
  }

  const box = pickBlockBox(block);
  const rawLength = Math.max(1, String(block.rawText || block.text || "").length);
  if (!box) {
    return {};
  }

  const startRatio = clampNumber(Number(segment.startOffset || 0) / rawLength, 0, 0.96);
  const endRatio = clampNumber(Number(segment.endOffset || rawLength) / rawLength, startRatio + 0.04, 1);
  const ratio = Math.max(0.04, endRatio - startRatio);
  return {
    x: box.x,
    y: box.y + box.height * startRatio,
    width: box.width,
    height: Math.max(12, box.height * ratio),
    lineCount: Math.max(1, Math.round(Number(block.lineCount || 1) * ratio)),
  };
}

function isLikelyNonReadingBlock(block, page = null, options = {}) {
  const rawText = String(block.rawText || block.text || "").replace(/\s+/g, " ").trim();
  if (isLikelyPdfExtractionGarbageText(block.text || rawText)) {
    return true;
  }

  const text = normalizeReadableBlockText(rawText);
  if (!text) {
    return true;
  }

  const context = {
    ...block,
    pageNumber: page?.pageNumber || block.pageNumber || 0,
  };
  if (isProtectedSemanticLeadInText(text)) {
    return false;
  }

  if (classifyPageArtifact(block)) {
    return true;
  }

  if (isBlockCoveredByVisualStructure(block, page)) {
    return true;
  }

  if (isLikelyFrontMatterTitleText(text, context)) {
    return true;
  }

  if (isLikelyNonReadingParagraphText(text, context) || isLikelyNonReadingParagraphText(rawText, context)) {
    return true;
  }

  if (isSuppressedByMemoryGuidance(block, page, options.paperMemory)) {
    return true;
  }

  if (/^[*†‡]/.test(text)) {
    return true;
  }

  if (/^\([a-z]\)/i.test(text) && /\([b-z]\)/i.test(text) && !/[.!?。！？]/.test(text)) {
    return true;
  }

  const lineCount = Number(block.lineCount || 1);
  const averageLineLength = text.length / Math.max(1, lineCount);
  const sentenceLike = /[.!?。！？][)"'\]]?(\s|$)/.test(text);
  const manyDiagramTokens = /\b(LLM|Query|Chunk|Task|Final|Summary|Checker|Architect|Engineer|Code)\b/i.test(text);
  return lineCount >= 6 && averageLineLength < 34 && (!sentenceLike || manyDiagramTokens);
}

function isSuppressedByMemoryGuidance(block, page, paperMemory) {
  const pageNumber = Number(page?.pageNumber || block?.pageNumber || 0);
  if (!pageNumber || !Array.isArray(paperMemory?.nonReadingGuidance)) {
    return false;
  }

  const text = normalizeArtifactText(block?.text || block?.rawText || "");
  if (!text) {
    return false;
  }

  return paperMemory.nonReadingGuidance.some((note) => {
    const clean = String(note || "").toLowerCase();
    if (!clean || !clean.includes(`p.${pageNumber}`) && !clean.includes(`page ${pageNumber}`) && !clean.includes(`第 ${pageNumber}`)) {
      return false;
    }
    if (/author|affiliation|email|作者|单位|邮箱/.test(clean)) {
      return isLikelyAuthorOrAffiliationText(text, { pageNumber });
    }
    if (/reference|bibliography|参考/.test(clean)) {
      return isReferencesSectionTitleText(text) || isLikelyBibliographyEntryText(text);
    }
    if (/header|footer|页眉|页脚/.test(clean)) {
      return isLikelyPageNumberOrRunningHeaderText(text);
    }
    if (/caption|figure|table|图注|表注/.test(clean)) {
      return isLikelyCaptionText(text);
    }
    return false;
  });
}

function isBlockRepresentedInReadableBlocks(block, readableBlocks) {
  const text = normalizeCoverageText(block?.text || "");
  if (!text) {
    return true;
  }

  return readableBlocks.some((readable) => {
    const readableText = normalizeCoverageText(readable?.text || readable || "");
    return textMatchesCoverage(readableText, text);
  });
}

function classifyRecoverableFilteredBlockReason(block, page = null, options = {}) {
  const rawText = String(block?.rawText || block?.text || "");
  const text = normalizeReadableBlockText(rawText);
  const context = {
    ...block,
    pageNumber: page?.pageNumber || block?.pageNumber || 0,
  };

  if (!text) {
    return "empty";
  }
  if (isLikelyPdfExtractionGarbageText(text)) {
    return "pdf-garbage";
  }
  if (isProtectedSemanticLeadInText(text)) {
    return "semantic-lead-in";
  }
  if (isLikelyPageNumberOrRunningHeaderText(text) || isLikelyFrontMatterTitleText(text, context)) {
    return "running-header";
  }
  if (isLikelyBibliographyEntryText(text) || isReferencesSectionTitleText(context.sectionTitle || context.sectionTitleHint)) {
    return "bibliography";
  }
  if (isLikelyAuthorOrAffiliationText(text, context) || isLikelyPublicationMetadataText(text)) {
    return "publication-metadata";
  }
  if (isLikelyResourceLinkText(text)) {
    return "resource-link";
  }
  if (isLikelyStandaloneLinkText(text)) {
    return "standalone-link";
  }
  if (isLikelyCaptionText(text)) {
    return "caption";
  }
  const artifact = classifyPageArtifact(block);
  if (artifact) {
    return artifact;
  }
  if (isBlockCoveredByVisualStructure(block, page)) {
    return "visual-region";
  }
  if (isSuppressedByMemoryGuidance(block, page, options.paperMemory)) {
    return "memory-guidance";
  }
  if (isLikelyTableBodyText(text, context)) {
    return "table-body";
  }
  if (isLikelyDiagramOnlyText(text, context)) {
    return "visual-text";
  }

  return "filtered";
}

function isRecoverableFilteredBlock(block, reason) {
  const text = normalizeParagraph(block?.text || "");
  if (!text || ["empty", "pdf-garbage", "running-header", "publication-metadata"].includes(reason)) {
    return false;
  }

  const hasUrl = /(?:https?:\/\/|www\.)\S+/i.test(text);
  const enoughText = text.length >= 70;
  const bibliography = reason === "bibliography" && text.length >= 35;
  const semanticLeadIn = reason === "semantic-lead-in" && text.length >= 28;
  const usefulShort = hasUrl || isLikelyCaptionText(text);
  return enoughText || bibliography || semanticLeadIn || usefulShort;
}

function isLikelyResourceLinkText(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!/(?:https?:\/\/|www\.)\S+/i.test(clean)) {
    return false;
  }

  return /\b(?:github|gitlab|huggingface|kaggle|zenodo|osf\.io|openreview|paperswithcode|dataset|datasets|code|repository|repo|artifact|checkpoint|model|models|benchmark)\b/i
    .test(clean);
}

function normalizeCoverageText(text) {
  return normalizeParagraph(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textMatchesCoverage(existing, candidate) {
  if (!existing || !candidate) {
    return false;
  }
  if (existing === candidate) {
    return true;
  }
  const minLength = Math.min(existing.length, candidate.length);
  if (minLength < 36) {
    return false;
  }
  const candidateProbe = candidate.slice(0, Math.min(140, Math.max(36, Math.floor(candidate.length * 0.7))));
  const existingProbe = existing.slice(0, Math.min(140, Math.max(36, Math.floor(existing.length * 0.7))));
  return existing.includes(candidateProbe) || candidate.includes(existingProbe);
}

function decorateReadableBlock(block, index, page) {
  const box = pickBlockBox(block);
  const pageWidth = Number(page?.width || 0) || inferPageWidthFromBlocks([block]) || 1;
  const x = box ? Number(box.x) : 0;
  const y = box ? Number(box.y) : index * 20;
  const width = box ? Number(box.width) : 0;
  const height = box ? Number(box.height) : 0;
  const explicitColumn = Number(block?.column || 0);
  const wide = box && pageWidth && width / pageWidth >= 0.58;
  const readingColumn = explicitColumn || inferReadingColumnFromBox(box, pageWidth, wide);
  return {
    block,
    index,
    originalIndex: Number.isFinite(Number(block?.originalIndex)) ? Number(block.originalIndex) : index,
    hasBox: Boolean(box),
    x,
    y,
    width,
    height,
    readingColumn,
    wide,
    readingBand: 0,
  };
}

function inferReadingColumnFromBox(box, pageWidth, wide = false) {
  if (!box || !pageWidth || wide) {
    return 0;
  }
  const center = Number(box.x || 0) + Number(box.width || 0) / 2;
  return center < pageWidth / 2 ? 1 : 2;
}

function inferPageWidthFromBlocks(blocks) {
  const rights = (blocks || [])
    .map((block) => {
      const box = pickBlockBox(block);
      return box ? box.x + box.width : 0;
    })
    .filter((value) => value > 0);
  return rights.length ? Math.max(...rights) : 0;
}

function getReadingBand(item, anchors) {
  if (!anchors.length || !item.hasBox) {
    return 0;
  }
  let band = 0;
  for (const anchor of anchors) {
    if (anchor.index === item.index) {
      break;
    }
    if (anchor.y + Math.max(1, anchor.height) <= item.y + 6) {
      band += 1;
    }
  }
  return band;
}

function compareReadableBlocks(a, b, options = {}) {
  if (options.twoColumn && a.readingBand !== b.readingBand) {
    return a.readingBand - b.readingBand;
  }

  if (options.twoColumn && a.readingColumn !== b.readingColumn) {
    if (!a.readingColumn || !b.readingColumn) {
      if (Math.abs(a.y - b.y) > 18) {
        return a.y - b.y;
      }
      return a.readingColumn - b.readingColumn;
    }
    return a.readingColumn - b.readingColumn;
  }

  const headingCorrection = compareOverlappingHeadingOrder(a, b);
  if (headingCorrection) {
    return headingCorrection;
  }

  return compareByPosition(a, b);
}

function compareByPosition(a, b) {
  if (Math.abs(a.y - b.y) > 2) {
    return a.y - b.y;
  }
  if (Math.abs(a.x - b.x) > 2) {
    return a.x - b.x;
  }
  return a.originalIndex - b.originalIndex || a.index - b.index;
}

function compareOverlappingHeadingOrder(a, b) {
  if (!a?.hasBox || !b?.hasBox || a.readingColumn !== b.readingColumn) {
    return 0;
  }

  const aHeading = isLikelyHeading(a.block?.text || "");
  const bHeading = isLikelyHeading(b.block?.text || "");
  if (aHeading === bHeading) {
    return 0;
  }

  const heading = aHeading ? a : b;
  const body = aHeading ? b : a;
  if (heading.originalIndex >= body.originalIndex) {
    return 0;
  }

  const headingInsideBodyBox = heading.y >= body.y - 4 &&
    heading.y <= body.y + Math.max(1, body.height) + 6;
  const sameColumn = Math.abs((heading.x + heading.width / 2) - (body.x + body.width / 2)) <
    Math.max(80, Math.min(heading.width || 0, body.width || 0) * 0.75);
  if (!headingInsideBodyBox || !sameColumn) {
    return 0;
  }

  return aHeading ? -1 : 1;
}

function isLikelyNonReadingParagraphText(text, context = {}) {
  const raw = normalizeArtifactText(text);
  if (isLikelyPdfExtractionGarbageText(text)) {
    return true;
  }

  if (isLikelyCaptionText(raw)) {
    return true;
  }

  const clean = normalizeParagraph(text);
  if (!clean) {
    return true;
  }

  if (isProtectedSemanticLeadInText(clean)) {
    return false;
  }

  if (isLikelyPublicationMetadataText(clean)) {
    return true;
  }

  if (isLikelyPageNumberOrRunningHeaderText(clean)) {
    return true;
  }

  if (isLikelyHeading(clean)) {
    return false;
  }

  if (isReferencesSectionTitleText(context.sectionTitle || context.sectionTitleHint)) {
    return true;
  }

  return isLikelyAuthorOrAffiliationText(clean, context) ||
    isLikelyStandaloneLinkText(clean) ||
    isLikelyBibliographyEntryText(clean) ||
    isLikelyDiagramOnlyText(clean, context) ||
    isLikelyTableBodyText(clean, context);
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

  if (emails.length && pageNumber <= 2 && text.length < 260 && !/[.!?。！？]/.test(text)) {
    return true;
  }

  if (groupedEmail || /\b(?:university|institute|college|department|laboratory|labs|technologies)\b/i.test(text) &&
    emails.length && text.length < 420) {
    return true;
  }

  return /\b(?:author names are listed|equal contribution|corresponding author|correspondence to|authors contributed equally)\b/i.test(text);
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
  const clean = normalizeArtifactText(text);
  if (!clean || clean.length > 360 || /[.!?。！？][)"'\]]?(\s|$)/.test(clean)) {
    return false;
  }

  const lineCount = Number(context?.lineCount || 1);
  const averageLineLength = clean.length / Math.max(1, lineCount);
  const numberTokens = (clean.match(/\b\d+(?:[.,]\d+)*%?\b/g) || []).length;
  const metricTokens = (clean.match(/\b(?:dataset|granularity|horizon|method|model|metric|mae|mse|rmse|mape|wql|smape|accuracy|precision|recall|f1|perplexity|baseline|ours|chronos|kronos|m2xfp|total|average|avg|cost|latency|throughput)\b/gi) || []).length;
  const separatorTokens = (clean.match(/\||\s{2,}|(?:^|\s)[|:](?:\s|$)/g) || []).length;
  const compactRows = lineCount >= 2 && averageLineLength <= 80;

  if (/^\|?.+\|.+\|/.test(clean) && metricTokens >= 2) {
    return true;
  }
  if (metricTokens >= 3 && numberTokens >= 2 && (compactRows || separatorTokens >= 1)) {
    return true;
  }
  if (metricTokens >= 4 && numberTokens >= 3 && averageLineLength <= 96) {
    return true;
  }

  return false;
}

function isLikelyHeading(text) {
  const clean = normalizeParagraph(text);
  if (!clean || clean.length > 120) {
    return false;
  }
  return /^(?:abstract|introduction|related work|background|method|methods|methodology|approach|design|architecture|implementation|experiments?|evaluation|results?|discussion|limitations?|conclusion|references|appendix)\b/i.test(clean) ||
    /^\d+(?:\.\d+)*\.?\s+[A-Z][\p{L}\p{N}\s,;:()&+\-/]{2,}$/u.test(clean);
}

function normalizeParagraph(text) {
  return String(text || "")
    .replace(/^(?:Figure|Fig\.|Table)\s+\d+[a-z]?\s*:[^.!?。！？]*(?:[.!?。！？]|$)/i, " ")
    .replace(/\s+(?:Figure|Fig\.|Table)\s+\d+[a-z]?\s*:[^.!?。！？]*(?:[.!?。！？]|$)/gi, " ")
    .replace(/[ \t]*\n[ \t]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatSegmentationRatio(value, total) {
  return (Number(value || 0) / Math.max(1, Number(total || 1))).toFixed(2);
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}
