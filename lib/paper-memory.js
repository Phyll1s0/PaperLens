import {
  classifyPageArtifact,
  normalizeArtifactText,
  pickBlockBox,
} from "./visual-artifacts.js";
import {
  classifyFormulaTextRole,
} from "./artifact-classifier.js";

export const PAPER_MEMORY_VERSION = 1;

export function buildPaperMemoryScanInput(pages = [], options = {}) {
  const totalLimit = Math.max(4000, Number(options.totalLimit || 36_000));
  const perPageLimit = Math.max(700, Number(options.perPageLimit || 4200));
  const lines = [];
  let totalLength = 0;

  for (const page of pages || []) {
    const pageText = formatPaperMemoryPage(page, perPageLimit);
    if (!pageText) {
      continue;
    }

    const entry = [`--- Page ${page?.pageNumber || "?"} ---`, pageText].join("\n");
    if (totalLength + entry.length > totalLimit) {
      break;
    }
    lines.push(entry);
    totalLength += entry.length;
  }

  return lines.join("\n\n");
}

export function buildHeuristicPaperMemory(paper = {}, pages = [], structureMap = null, chunkNotes = []) {
  const merged = mergePaperMemoryChunks(chunkNotes, paper, structureMap);
  const artifacts = Array.isArray(paper.pageArtifacts) ? paper.pageArtifacts : [];
  const artifactFormulas = artifacts
    .filter((artifact) => artifact.type === "formula" && artifact.text)
    .map((artifact) => normalizeFormulaMemoryItem({
      label: artifact.label || "",
      pageNumber: artifact.pageNumber,
      text: artifact.text,
      purpose: artifact.label || "PDF 视觉层识别到的公式。",
    }));
  const artifactVisuals = artifacts
    .filter((artifact) => ["caption", "figure-text", "code"].includes(artifact.type) && artifact.text)
    .map((artifact) => normalizeVisualMemoryItem({
      label: artifact.label || "",
      pageNumber: artifact.pageNumber,
      type: artifact.visualType || artifact.type,
      description: artifact.text,
    }));
  const resources = [
    ...merged.resources,
    ...collectResourcesFromPages(pages),
  ];

  return normalizePaperMemory({
    source: merged.source === "ai" ? "ai+heuristic" : "heuristic",
    summary: merged.summary || structureMap?.summary || "",
    mainThread: merged.mainThread || "",
    contributions: merged.contributions || [],
    keyTerms: [
      ...normalizeStringList(structureMap?.keywords),
      ...merged.keyTerms,
    ],
    importantFormulas: [
      ...merged.importantFormulas,
      ...artifactFormulas,
    ],
    importantVisuals: [
      ...merged.importantVisuals,
      ...artifactVisuals,
    ],
    resources,
    nonReadingGuidance: [
      ...merged.nonReadingGuidance,
      ...formatNonBodyZones(structureMap),
    ],
    segmentationGuidance: merged.segmentationGuidance,
    chunkSummaries: merged.chunkSummaries,
  }, paper, structureMap);
}

export function mergePaperMemoryChunks(chunkNotes = [], paper = {}, structureMap = null) {
  const normalizedNotes = (chunkNotes || [])
    .map((note) => normalizePaperMemory(note, paper, structureMap))
    .filter((note) => note.summary || note.keyTerms.length || note.resources.length);
  const merged = {
    version: PAPER_MEMORY_VERSION,
    source: normalizedNotes.some((note) => note.source === "ai") ? "ai" : "heuristic",
    paperTitle: normalizeLine(paper.title || paper.filename || structureMap?.paperTitle || ""),
    summary: "",
    mainThread: "",
    contributions: [],
    keyTerms: [],
    importantFormulas: [],
    importantVisuals: [],
    resources: [],
    nonReadingGuidance: [],
    segmentationGuidance: [],
    chunkSummaries: [],
    updatedAt: new Date().toISOString(),
  };

  for (const note of normalizedNotes) {
    if (!merged.summary && note.summary) {
      merged.summary = note.summary;
    }
    if (!merged.mainThread && note.mainThread) {
      merged.mainThread = note.mainThread;
    }
    pushUniqueMany(merged.contributions, note.contributions, contributionKey);
    pushUniqueMany(merged.keyTerms, note.keyTerms, normalizeKey);
    pushUniqueMany(merged.importantFormulas, note.importantFormulas, formulaKey);
    pushUniqueMany(merged.importantVisuals, note.importantVisuals, visualKey);
    pushUniqueMany(merged.resources, note.resources, resourceKey);
    pushUniqueMany(merged.nonReadingGuidance, note.nonReadingGuidance, normalizeKey);
    pushUniqueMany(merged.segmentationGuidance, note.segmentationGuidance, normalizeKey);
    pushUniqueMany(merged.chunkSummaries, note.chunkSummaries, normalizeKey);
  }

  return normalizePaperMemory(merged, paper, structureMap);
}

export function normalizePaperMemory(value = {}, paper = {}, structureMap = null) {
  const data = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const source = normalizeLine(data.source || "ai");
  const memory = {
    version: PAPER_MEMORY_VERSION,
    source,
    paperTitle: truncateText(normalizeLine(data.paperTitle || data.title || structureMap?.paperTitle || paper.title || paper.filename || ""), 180),
    summary: truncateText(normalizeLine(data.summary || data.paperSummary || ""), 520),
    mainThread: truncateText(normalizeLine(data.mainThread || data.methodStory || data.coreIdea || ""), 520),
    contributions: normalizeStringList(data.contributions || data.keyContributions).slice(0, 10),
    keyTerms: normalizeStringList(data.keyTerms || data.keywords || data.terms).slice(0, 32),
    importantFormulas: normalizeFormulaItems(data.importantFormulas || data.formulas || data.equations).slice(0, 24),
    importantVisuals: normalizeVisualItems(data.importantVisuals || data.figures || data.visuals || data.tables).slice(0, 24),
    resources: normalizeResourceItems(data.resources || data.links || data.urls).slice(0, 24),
    nonReadingGuidance: normalizeStringList(data.nonReadingGuidance || data.nonBodyNotes || data.nonBodyZones).slice(0, 18),
    segmentationGuidance: normalizeStringList(data.segmentationGuidance || data.segmentationAdvice || data.readingPlan).slice(0, 18),
    chunkSummaries: normalizeStringList(data.chunkSummaries || data.pageSummaries || data.windowSummaries).slice(0, 32),
    updatedAt: data.updatedAt || new Date().toISOString(),
  };

  return memory;
}

export function formatPaperMemoryForPrompt(memory = null, pages = [], options = {}) {
  if (!memory || memory.version !== PAPER_MEMORY_VERSION) {
    return "无。";
  }

  const scopedFormulas = filterMemoryItemsByPages(memory.importantFormulas, pages).slice(0, 8);
  const scopedVisuals = filterMemoryItemsByPages(memory.importantVisuals, pages).slice(0, 8);
  const scopedResources = filterMemoryItemsByPages(memory.resources, pages).slice(0, 8);
  const lines = [
    memory.summary ? `论文摘要: ${memory.summary}` : "",
    memory.mainThread ? `主线判断: ${memory.mainThread}` : "",
    memory.contributions.length ? `关键贡献: ${memory.contributions.slice(0, 6).join("；")}` : "",
    memory.keyTerms.length ? `关键术语: ${memory.keyTerms.slice(0, 18).join("、")}` : "",
    scopedFormulas.length ? `重要公式: ${scopedFormulas.map(formatFormulaForPrompt).join("；")}` : "",
    scopedVisuals.length ? `重要图表/代码: ${scopedVisuals.map(formatVisualForPrompt).join("；")}` : "",
    scopedResources.length ? `重要资源链接: ${scopedResources.map(formatResourceForPrompt).join("；")}` : "",
    memory.nonReadingGuidance.length ? `非正文提示: ${memory.nonReadingGuidance.slice(0, 8).join("；")}` : "",
    memory.segmentationGuidance.length ? `分段提示: ${memory.segmentationGuidance.slice(0, 8).join("；")}` : "",
  ].filter(Boolean);

  return truncateText(lines.join("\n"), Number(options.limit || 2200)) || "无。";
}

function formatPaperMemoryPage(page, limit) {
  const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
  if (blocks.length) {
    const lines = blocks
      .map((block, index) => formatPaperMemoryBlock(page, block, index))
      .filter(Boolean);
    return truncateText(lines.join("\n"), limit);
  }

  return truncateText(normalizeArtifactText(page?.text || ""), limit);
}

function formatPaperMemoryBlock(page, block, index) {
  const text = normalizeArtifactText(block?.text || "");
  if (!text) {
    return "";
  }

  const meta = [`B${index + 1}`, `p=${page?.pageNumber || "?"}`];
  const type = classifyPageArtifact(block);
  if (type) {
    meta.push(`type=${type}`);
  }
  const formulaRole = classifyFormulaTextRole(text, block);
  if (formulaRole.role === "inline-math" || formulaRole.role === "equation-number") {
    meta.push(`math=${formulaRole.role}`);
  } else if (type === "formula" && formulaRole.role) {
    meta.push(`math=${formulaRole.role}`);
  }
  if (hasUrl(text)) {
    meta.push("hasUrl=1");
  }
  const box = pickBlockBox(block);
  const pageWidth = Number(page?.width || 0);
  const pageHeight = Number(page?.height || 0);
  if (box && pageWidth && pageHeight) {
    meta.push(
      `x=${formatRatio(box.x, pageWidth)}`,
      `y=${formatRatio(box.y, pageHeight)}`,
      `w=${formatRatio(box.width, pageWidth)}`,
      `h=${formatRatio(box.height, pageHeight)}`,
    );
  }
  if (Number(block?.column || 0)) {
    meta.push(`col=${block.column}`);
  }
  if (Number(block?.lineCount || 0)) {
    meta.push(`lines=${block.lineCount}`);
  }

  return `[${meta.join(" ")}] ${truncateText(text, 900)}`;
}

function collectResourcesFromPages(pages = []) {
  const resources = [];
  for (const page of pages || []) {
    const texts = Array.isArray(page?.blocks) && page.blocks.length
      ? page.blocks.map((block) => block.text)
      : [page?.text || ""];
    for (const text of texts) {
      for (const url of extractUrls(text)) {
        resources.push(normalizeResourceItem({
          type: inferResourceType(url),
          url,
          pageNumber: page?.pageNumber,
          label: "",
          whyImportant: "PDF 中出现的链接，可能是代码、数据、项目或论文资源。",
        }));
      }
    }
  }
  return resources.filter(Boolean);
}

function normalizeFormulaItems(items) {
  return normalizeArray(items).map(normalizeFormulaMemoryItem).filter(Boolean);
}

function normalizeFormulaMemoryItem(item) {
  if (typeof item === "string") {
    const text = normalizeLine(item);
    return text ? { label: "", pageNumber: null, text: truncateText(text, 280), purpose: "" } : null;
  }
  if (!item || typeof item !== "object") {
    return null;
  }
  const text = normalizeLine(item.text || item.formula || item.equation || item.sourceText || "");
  const label = normalizeLine(item.label || item.name || "");
  const purpose = normalizeLine(item.purpose || item.role || item.description || "");
  if (!text && !label && !purpose) {
    return null;
  }
  return {
    label: truncateText(label, 80),
    pageNumber: normalizePageNumber(item.pageNumber || item.page),
    text: truncateText(text, 320),
    purpose: truncateText(purpose, 180),
  };
}

function normalizeVisualItems(items) {
  return normalizeArray(items).map(normalizeVisualMemoryItem).filter(Boolean);
}

function normalizeVisualMemoryItem(item) {
  if (typeof item === "string") {
    const description = normalizeLine(item);
    return description ? { label: "", pageNumber: null, type: "", description: truncateText(description, 260) } : null;
  }
  if (!item || typeof item !== "object") {
    return null;
  }
  const description = normalizeLine(item.description || item.text || item.caption || item.summary || "");
  const label = normalizeLine(item.label || item.name || item.figure || item.table || "");
  if (!description && !label) {
    return null;
  }
  return {
    label: truncateText(label, 80),
    pageNumber: normalizePageNumber(item.pageNumber || item.page),
    type: truncateText(normalizeLine(item.type || item.kind || ""), 32),
    description: truncateText(description, 260),
  };
}

function normalizeResourceItems(items) {
  return normalizeArray(items).map(normalizeResourceItem).filter(Boolean);
}

function normalizeResourceItem(item) {
  if (typeof item === "string") {
    const url = normalizeUrl(item);
    return url ? { type: inferResourceType(url), url, pageNumber: null, label: "", whyImportant: "" } : null;
  }
  if (!item || typeof item !== "object") {
    return null;
  }
  const url = normalizeUrl(item.url || item.href || item.link || "");
  const label = normalizeLine(item.label || item.name || item.title || "");
  const whyImportant = normalizeLine(item.whyImportant || item.description || item.note || "");
  if (!url && !label && !whyImportant) {
    return null;
  }
  return {
    type: truncateText(normalizeLine(item.type || item.kind || inferResourceType(url)), 32),
    url,
    pageNumber: normalizePageNumber(item.pageNumber || item.page),
    label: truncateText(label, 100),
    whyImportant: truncateText(whyImportant, 180),
  };
}

function normalizeStringList(value) {
  return normalizeArray(value)
    .flatMap((item) => typeof item === "string" ? item.split(/[;\n]/) : [item])
    .map((item) => normalizeLine(typeof item === "object" ? item?.label || item?.title || item?.description || item?.text : item))
    .filter(Boolean)
    .filter((item, index, all) => all.findIndex((candidate) => normalizeKey(candidate) === normalizeKey(item)) === index)
    .map((item) => truncateText(item, 180));
}

function formatNonBodyZones(structureMap) {
  return normalizeArray(structureMap?.nonBodyZones).map((zone) => {
    const label = normalizeLine(zone.label || zone.type || "非正文区域");
    const page = zone.startPage
      ? zone.endPage && zone.endPage !== zone.startPage
        ? `p.${zone.startPage}-${zone.endPage}`
        : `p.${zone.startPage}`
      : "";
    const description = normalizeLine(zone.description || "");
    return [label, page, description].filter(Boolean).join(" ");
  }).filter(Boolean);
}

function filterMemoryItemsByPages(items = [], pages = []) {
  const pageNumbers = (pages || []).map((page) => Number(page?.pageNumber)).filter(Number.isFinite);
  if (!pageNumbers.length) {
    return items || [];
  }
  const first = Math.min(...pageNumbers);
  const last = Math.max(...pageNumbers);
  const scoped = (items || []).filter((item) => {
    const pageNumber = Number(item?.pageNumber || 0);
    return !pageNumber || pageNumber >= first && pageNumber <= last;
  });
  return scoped.length ? scoped : (items || []);
}

function formatFormulaForPrompt(item) {
  return [
    item.label || "公式",
    item.pageNumber ? `p.${item.pageNumber}` : "",
    item.text ? truncateText(item.text, 120) : "",
    item.purpose ? truncateText(item.purpose, 120) : "",
  ].filter(Boolean).join(" ");
}

function formatVisualForPrompt(item) {
  return [
    item.label || item.type || "视觉材料",
    item.pageNumber ? `p.${item.pageNumber}` : "",
    item.description ? truncateText(item.description, 140) : "",
  ].filter(Boolean).join(" ");
}

function formatResourceForPrompt(item) {
  return [
    item.type || "url",
    item.pageNumber ? `p.${item.pageNumber}` : "",
    item.label || item.url || "",
    item.whyImportant ? truncateText(item.whyImportant, 100) : "",
  ].filter(Boolean).join(" ");
}

function extractUrls(text) {
  return [...String(text || "").matchAll(/https?:\/\/[^\s)\]}>,;]+|www\.[^\s)\]}>,;]+/gi)]
    .map((match) => normalizeUrl(match[0]))
    .filter(Boolean);
}

function normalizeUrl(value) {
  const clean = String(value || "").trim().replace(/[.,;:)\]}]+$/g, "");
  if (!clean) {
    return "";
  }
  return clean.startsWith("www.") ? `https://${clean}` : clean;
}

function inferResourceType(url) {
  const clean = String(url || "").toLowerCase();
  if (/github\.com|gitlab\.com|bitbucket\.org/.test(clean)) {
    return "code";
  }
  if (/huggingface\.co|kaggle\.com|zenodo\.org|figshare\.com|dataset|data/.test(clean)) {
    return "dataset";
  }
  if (/arxiv\.org|doi\.org|openreview\.net/.test(clean)) {
    return "paper";
  }
  return clean ? "url" : "";
}

function pushUniqueMany(target, values, keyFn) {
  for (const value of values || []) {
    const key = keyFn(value);
    if (!key || target.some((item) => keyFn(item) === key)) {
      continue;
    }
    target.push(value);
  }
}

function normalizeArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null || value === "") {
    return [];
  }
  return [value];
}

function contributionKey(value) {
  return normalizeKey(value);
}

function formulaKey(value) {
  return normalizeKey(`${value?.label || ""} ${value?.text || ""} ${value?.pageNumber || ""}`);
}

function visualKey(value) {
  return normalizeKey(`${value?.label || ""} ${value?.description || ""} ${value?.pageNumber || ""}`);
}

function resourceKey(value) {
  return normalizeKey(value?.url || `${value?.label || ""} ${value?.pageNumber || ""}`);
}

function normalizeKey(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function hasUrl(text) {
  return /https?:\/\/|www\./i.test(String(text || ""));
}

function normalizePageNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : null;
}

function normalizeLine(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function formatRatio(value, total) {
  return (Number(value || 0) / Math.max(1, Number(total || 1))).toFixed(2);
}

function truncateText(text, limit = 200) {
  const clean = normalizeLine(text);
  if (clean.length <= limit) {
    return clean;
  }
  return `${clean.slice(0, Math.max(0, limit - 1)).trim()}…`;
}
