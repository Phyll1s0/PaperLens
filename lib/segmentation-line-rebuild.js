import {
  stripPublicationMetadataFragments,
} from "./segmentation-repair.js";

const MIN_REBUILD_LINES = 4;

export function rebuildReadableBlocksFromLineClusters(block = {}, page = {}, options = {}) {
  const lines = normalizeClusterLines(block.lines || []);
  if (!shouldAttemptLineClusterRebuild(block, page, lines)) {
    return [];
  }

  const columns = splitLinesIntoColumns(lines, page);
  const groups = [];
  for (const column of columns) {
    groups.push(...splitColumnIntoReadingGroups(column));
  }

  const segments = groups
    .map((group, index) => buildClusterSegment(group, block, index))
    .filter(Boolean);
  if (!segments.length || !isMeaningfulLineRebuild(block, segments, options)) {
    return [];
  }

  return segments;
}

function shouldAttemptLineClusterRebuild(block, page, lines) {
  if (lines.length < MIN_REBUILD_LINES) {
    return false;
  }

  const pageWidth = Number(page?.width || 0);
  const blockWidth = Number(block?.width || 0);
  const lineSpan = getLineHorizontalSpan(lines);
  const wideBlock = pageWidth > 0 && (blockWidth / pageWidth >= 0.62 || lineSpan.width / pageWidth >= 0.62);
  const multiColumn = hasTwoColumnLinePattern(lines, page);
  const hasLargeGap = hasLargeVerticalGap(lines);
  const hasFormulaIsland = lines.some((line) => isFormulaOnlyLine(line.text));
  const longBlock = String(block?.text || "").length > 420 && lines.length >= 6;
  return wideBlock && (multiColumn || hasLargeGap || hasFormulaIsland || longBlock);
}

function splitLinesIntoColumns(lines, page) {
  const sorted = [...lines].sort(compareLinesByYThenX);
  if (!hasTwoColumnLinePattern(sorted, page)) {
    return [sorted];
  }

  const pageWidth = Number(page?.width || 0) || Math.max(...sorted.map((line) => line.x + line.width), 1);
  const midpoint = pageWidth / 2;
  const left = [];
  const right = [];
  const wide = [];
  for (const line of sorted) {
    const center = line.x + line.width / 2;
    if (line.width / pageWidth >= 0.56) {
      wide.push(line);
    } else if (center < midpoint) {
      left.push(line);
    } else {
      right.push(line);
    }
  }

  const columns = [];
  if (wide.length) {
    columns.push(wide.sort(compareLinesByYThenX));
  }
  if (left.length) {
    columns.push(left.sort(compareLinesByYThenX));
  }
  if (right.length) {
    columns.push(right.sort(compareLinesByYThenX));
  }
  return columns.length ? columns : [sorted];
}

function splitColumnIntoReadingGroups(lines) {
  const groups = [];
  let current = [];
  const lineHeight = median(lines.map((line) => line.height).filter((value) => value > 0)) || 12;
  const gapThreshold = Math.max(18, lineHeight * 1.7);

  const flush = () => {
    if (current.length) {
      groups.push(current);
      current = [];
    }
  };

  let previous = null;
  for (const line of lines) {
    if (isFormulaOnlyLine(line.text)) {
      flush();
      previous = line;
      continue;
    }

    const gap = previous ? line.y - (previous.y + previous.height) : 0;
    const paragraphBreak = previous &&
      gap > gapThreshold &&
      (endsLikeSentence(previous.text) || startsLikeParagraph(line.text) || Math.abs(line.x - previous.x) > 14);
    if (paragraphBreak) {
      flush();
    }
    current.push(line);
    previous = line;
  }
  flush();
  return groups;
}

function buildClusterSegment(lines, block, index) {
  const text = normalizeClusterText(lines.map((line) => line.text).join(" "));
  if (!isUsefulClusterText(text)) {
    return null;
  }

  const box = mergeLineBoxes(lines);
  return {
    ...block,
    ...box,
    rawText: text,
    text,
    lines,
    lineCount: lines.length,
    rebuiltFromLineCluster: true,
    lineClusterIndex: index,
    originalRawText: block.rawText || block.text || "",
  };
}

function isMeaningfulLineRebuild(block, segments, options = {}) {
  if (segments.length >= 2) {
    return true;
  }
  if (options.allowSingleLineClusterRebuild) {
    return true;
  }
  const original = normalizeClusterText(block?.text || block?.rawText || "");
  const rebuilt = normalizeClusterText(segments.map((segment) => segment.text).join(" "));
  return rebuilt.length >= 80 && original.length - rebuilt.length >= 40;
}

function hasTwoColumnLinePattern(lines, page) {
  if (lines.length < 4) {
    return false;
  }
  const pageWidth = Number(page?.width || 0) || Math.max(...lines.map((line) => line.x + line.width), 1);
  const content = getLineHorizontalSpan(lines);
  const left = lines.filter((line) => line.x + line.width / 2 < pageWidth / 2 && line.width / pageWidth < 0.56);
  const right = lines.filter((line) => line.x + line.width / 2 >= pageWidth / 2 && line.width / pageWidth < 0.56);
  return content.width / pageWidth >= 0.62 && left.length >= 2 && right.length >= 2;
}

function hasLargeVerticalGap(lines) {
  if (lines.length < 4) {
    return false;
  }
  const sorted = [...lines].sort(compareLinesByYThenX);
  const heights = sorted.map((line) => line.height).filter((value) => value > 0);
  const lineHeight = median(heights) || 12;
  return sorted.some((line, index) => {
    if (!index) {
      return false;
    }
    const previous = sorted[index - 1];
    return line.y - (previous.y + previous.height) > Math.max(22, lineHeight * 2.2);
  });
}

function isUsefulClusterText(text) {
  const clean = normalizeClusterText(text);
  if (!clean || clean.length < 32) {
    return false;
  }
  const wordCount = clean.split(/\s+/).filter(Boolean).length;
  return wordCount >= 5 || clean.length >= 56;
}

function isFormulaOnlyLine(text) {
  const clean = normalizeClusterText(text);
  if (!clean || clean.length > 180) {
    return false;
  }
  const mathTokens = (clean.match(/[=<>+\-*/^_{}[\]()]|\\[a-zA-Z]+|\b(?:sum|prod|log|exp|min|max|argmin|argmax)\b/g) || []).length;
  const letters = (clean.match(/[A-Za-z]/g) || []).length;
  const sentenceWords = (clean.match(/\b(?:the|this|that|where|which|model|method|result|we|our)\b/gi) || []).length;
  return mathTokens >= 3 && sentenceWords === 0 && (letters <= 18 || mathTokens >= 5);
}

function startsLikeParagraph(text) {
  return /^(?:[A-Z][a-z]+|We|Our|The|This|These|However|Furthermore|In\s+this|To\s+)/.test(normalizeClusterText(text));
}

function endsLikeSentence(text) {
  return /[.!?][)"'\]]?$/.test(normalizeClusterText(text));
}

function normalizeClusterLines(lines) {
  return (Array.isArray(lines) ? lines : [])
    .map((line, index) => {
      const text = normalizeClusterText(stripPublicationMetadataFragments(line?.text || ""));
      const x = Number(line?.x);
      const y = Number(line?.y);
      const width = Number(line?.width);
      const height = Number(line?.height);
      if (!text || ![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
        return null;
      }
      return { ...line, text, x, y, width, height, index };
    })
    .filter(Boolean)
    .sort(compareLinesByYThenX);
}

function mergeLineBoxes(lines) {
  const left = Math.min(...lines.map((line) => line.x));
  const top = Math.min(...lines.map((line) => line.y));
  const right = Math.max(...lines.map((line) => line.x + line.width));
  const bottom = Math.max(...lines.map((line) => line.y + line.height));
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function getLineHorizontalSpan(lines) {
  const box = mergeLineBoxes(lines);
  return { x: box.x, width: box.width };
}

function compareLinesByYThenX(a, b) {
  if (Math.abs(a.y - b.y) > 2) {
    return a.y - b.y;
  }
  if (Math.abs(a.x - b.x) > 2) {
    return a.x - b.x;
  }
  return Number(a.index || 0) - Number(b.index || 0);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) {
    return 0;
  }
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function normalizeClusterText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}
