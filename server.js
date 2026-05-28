import http from "node:http";
import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, rename, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

loadDotEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const PDF_ENGINE = process.env.PAPERLENS_PDF_ENGINE || "auto";
const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const DATA_DIR = path.join(__dirname, "data");
const ASSET_DIR = path.join(__dirname, "paper-assets");
const CACHE_DIR = path.join(__dirname, ".cache");
const WORKSPACE_CACHE_KEY = createHash("sha1").update(__dirname).digest("hex").slice(0, 12);
const SWIFT_MODULE_CACHE_DIR = path.join(CACHE_DIR, `swift-module-cache-${WORKSPACE_CACHE_KEY}`);
const TMP_DIR = path.join(CACHE_DIR, "tmp");
const MAX_UPLOAD_BYTES = 120 * 1024 * 1024;
const ARTIFACT_CROP_VERSION = 5;
const EXTRA_BIN_DIRS = [
  path.dirname(process.execPath),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
  process.env.HOME ? path.join(process.env.HOME, ".local", "bin") : "",
  process.env.HOME ? path.join(process.env.HOME, ".npm-global", "bin") : "",
].filter(Boolean);

await mkdir(UPLOAD_DIR, { recursive: true });
await mkdir(DATA_DIR, { recursive: true });
await mkdir(ASSET_DIR, { recursive: true });
await mkdir(SWIFT_MODULE_CACHE_DIR, { recursive: true });
await mkdir(TMP_DIR, { recursive: true });

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/") {
      return serveStatic(res, path.join(PUBLIC_DIR, "index.html"));
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      return json(res, {
        ok: true,
        name: "PaperLens",
        pdfEngine: PDF_ENGINE,
        uptimeSeconds: Math.round(process.uptime()),
      });
    }

    if (req.method === "GET" && url.pathname.startsWith("/public/")) {
      return serveStatic(res, path.join(__dirname, url.pathname));
    }

    if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
      return serveAsset(res, url.pathname);
    }

    if (req.method === "POST" && url.pathname === "/api/papers/upload") {
      return await handleUpload(req, res);
    }

    if (req.method === "GET" && url.pathname === "/api/papers") {
      return json(res, await listPapers());
    }

    const segmentMatch = url.pathname.match(/^\/api\/papers\/([^/]+)\/segment$/);
    if (req.method === "POST" && segmentMatch) {
      return await handleSegmentPaper(req, res, segmentMatch[1]);
    }

    const paperMatch = url.pathname.match(/^\/api\/papers\/([^/]+)$/);
    if (req.method === "GET" && paperMatch) {
      return json(res, await loadPaper(paperMatch[1]));
    }

    if (req.method === "POST" && url.pathname === "/api/analyze") {
      return await handleAnalyze(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/model/ping") {
      return await handleModelPing(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      return await handleChat(req, res);
    }

    return json(res, { error: "Not found" }, 404);
  } catch (error) {
    if (res.destroyed || res.writableEnded) {
      return;
    }
    console.error(error);
    return json(res, { error: error.message || "Internal server error" }, error.statusCode || 500);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Paper reading assistant running at http://${HOST}:${PORT}`);
});

async function handleUpload(req, res) {
  const contentType = req.headers["content-type"] || "";
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1] ||
    contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];

  if (!boundary) {
    return json(res, { error: "Missing multipart boundary." }, 400);
  }

  const body = await readRequestBuffer(req, MAX_UPLOAD_BYTES);
  const parts = parseMultipart(body, boundary);
  const filePart = parts.find((part) => part.filename && part.name === "pdf");

  if (!filePart) {
    return json(res, { error: "Missing PDF file." }, 400);
  }

  if (!filePart.filename.toLowerCase().endsWith(".pdf")) {
    return json(res, { error: "Only PDF files are supported." }, 400);
  }

  const paperId = `paper_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const safeFilename = filePart.filename.replace(/[^\w.-]+/g, "_").slice(0, 120);
  const pdfPath = path.join(UPLOAD_DIR, `${paperId}_${safeFilename}`);
  const assetDir = path.join(ASSET_DIR, paperId);
  await mkdir(assetDir, { recursive: true });
  await writeFile(pdfPath, filePart.content);

  const extraction = await extractPdfText(pdfPath, assetDir, `/assets/${paperId}`);
  const paper = buildPaperRecord({
    id: paperId,
    filename: filePart.filename,
    pdfPath,
    extraction,
  });

  if (!paper.paragraphs.some((paragraph) => paragraph.kind !== "heading")) {
    return json(res, {
      error: "没有从 PDF 中提取到可阅读文本。这个 PDF 可能是扫描版，暂时需要先 OCR 后再上传。",
    }, 422);
  }

  await savePaper(paper);
  return json(res, paper);
}

async function handleSegmentPaper(req, res, paperId) {
  const payload = await readJson(req);
  const paper = await loadPaper(paperId);
  const pages = Array.isArray(paper.extractionPages) ? paper.extractionPages : [];
  const signal = getResponseAbortSignal(res);

  if (!pages.length) {
    return json(res, { error: "这篇论文缺少原始页面文本，无法重新 AI 分段。请重新上传 PDF。" }, 400);
  }

  const segmented = await segmentPaperWithAi(paper, payload.settings, { signal });
  await savePaper(segmented);
  return json(res, { paper: segmented });
}

async function listPapers() {
  const files = await readdir(DATA_DIR).catch(() => []);
  const papers = [];

  for (const file of files) {
    if (!file.endsWith(".json")) {
      continue;
    }

    try {
      const paper = JSON.parse(await readFile(path.join(DATA_DIR, file), "utf8"));
      papers.push({
        id: paper.id,
        title: paper.title,
        filename: paper.filename,
        pageCount: paper.pageCount,
        paragraphCount: paper.paragraphs?.filter((item) => item.kind !== "heading").length || 0,
        updatedAt: paper.updatedAt,
      });
    } catch {
      continue;
    }
  }

  papers.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return { papers };
}

function getResponseAbortSignal(res) {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) {
      controller.abort();
    }
  });
  return controller.signal;
}

async function handleAnalyze(req, res) {
  const payload = await readJson(req);
  const { paperId, paragraphId, settings } = payload;
  const signal = getResponseAbortSignal(res);

  if (!paperId || !paragraphId) {
    return json(res, { error: "paperId and paragraphId are required." }, 400);
  }

  const paper = await loadPaper(paperId);
  const paragraph = paper.paragraphs.find((item) => item.id === paragraphId);

  if (!paragraph) {
    return json(res, { error: "Paragraph not found." }, 404);
  }

  if (paragraph.kind === "heading") {
    return json(res, { error: "Section headings do not need paragraph analysis." }, 400);
  }

  const section = paper.sections.find((item) => item.id === paragraph.sectionId);
  const messages = [
    {
      role: "system",
      content:
        "你是一个严谨的论文精读助手。必须忠于论文原文，不编造。请只输出合法 JSON，不要使用 Markdown 代码块。涉及公式时请保留 LaTeX，并用 $...$ 或 $$...$$ 包裹。",
    },
    {
      role: "user",
      content: [
        "请分析下面这段论文内容。",
        "",
        `章节: ${section?.title || "未知章节"}`,
        `页码: ${paragraph.pageNumber}`,
        "",
        "原文:",
        paragraph.sourceText,
        "",
        "输出 JSON 格式:",
        "{",
        '  "translation": "忠实中文翻译，保留必要英文术语",',
        '  "explanation": "面向读者的中文讲解，说明这段在论文中的作用、关键概念和阅读难点",',
        '  "keyTerms": ["术语1", "术语2"]',
        "}",
      ].join("\n"),
    },
  ];

  const content = await callModel(settings, messages, { signal });
  const parsed = parseModelJson(content);

  paragraph.translation = parsed.translation || "";
  paragraph.explanation = parsed.explanation || content;
  paragraph.keyTerms = Array.isArray(parsed.keyTerms) ? parsed.keyTerms : [];
  paragraph.analysisStatus = "done";
  paragraph.analysisError = "";
  paragraph.updatedAt = new Date().toISOString();

  await savePaper(paper);
  return json(res, { paragraph });
}

async function handleModelPing(req, res) {
  const payload = await readJson(req);
  const diagnostics = getSettingsDiagnostics(payload.settings);
  const signal = getResponseAbortSignal(res);

  try {
    const answer = await callModel(payload.settings, [
      {
        role: "system",
        content: "你是 API 连通性测试助手。只用中文简短回答。",
      },
      {
        role: "user",
        content: "请回复：连接成功。",
      },
    ], { maxTokens: 64, signal });

    return json(res, { ok: true, answer, diagnostics });
  } catch (error) {
    return json(res, {
      error: error.message || "模型连接测试失败。",
      diagnostics,
    }, error.statusCode || 500);
  }
}

async function handleChat(req, res) {
  const payload = await readJson(req);
  const { paperId, paragraphId, message, settings } = payload;
  const signal = getResponseAbortSignal(res);

  if (!paperId || !paragraphId || !message) {
    return json(res, { error: "paperId, paragraphId and message are required." }, 400);
  }

  const paper = await loadPaper(paperId);
  const index = paper.paragraphs.findIndex((item) => item.id === paragraphId);

  if (index === -1) {
    return json(res, { error: "Paragraph not found." }, 404);
  }

  const paragraph = paper.paragraphs[index];
  if (paragraph.kind === "heading") {
    return json(res, { error: "Section headings do not support paragraph chat." }, 400);
  }

  const section = paper.sections.find((item) => item.id === paragraph.sectionId);
  const nearbyParagraphs = paper.paragraphs
    .slice(Math.max(0, index - 2), Math.min(paper.paragraphs.length, index + 3))
    .filter((item) => item.kind !== "heading")
    .map((item) => `P${item.order + 1}: ${item.sourceText}`)
    .join("\n\n");

  const messages = [
    {
      role: "system",
      content:
        "你是论文阅读问答助手。回答要基于给定论文上下文；如果上下文没有答案，要明确说论文中没有直接说明。使用中文回答。涉及公式时请保留 LaTeX，并用 $...$ 或 $$...$$ 包裹。",
    },
    {
      role: "user",
      content: [
        `论文: ${paper.title || paper.filename}`,
        `当前章节: ${section?.title || "未知章节"}`,
        "",
        "当前段落原文:",
        paragraph.sourceText,
        "",
        "当前段落翻译:",
        paragraph.translation || "尚未生成",
        "",
        "当前段落讲解:",
        paragraph.explanation || "尚未生成",
        "",
        "附近相关段落:",
        nearbyParagraphs,
        "",
        "用户问题:",
        message,
      ].join("\n"),
    },
  ];

  const answer = await callModel(settings, messages, { signal });
  paragraph.chatMessages = paragraph.chatMessages || [];
  paragraph.chatMessages.push({
    id: `msg_${randomUUID().slice(0, 12)}`,
    question: message,
    answer,
    createdAt: new Date().toISOString(),
  });

  await savePaper(paper);
  return json(res, { answer, paragraph });
}

function buildPaperRecord({ id, filename, pdfPath, extraction }) {
  const paragraphs = splitIntoParagraphs(extraction.pages);
  const sections = inferSections(paragraphs);
  const title = inferTitle(paragraphs, filename);
  const pageImages = extraction.pages
    .filter((page) => page.imagePath)
    .map((page) => ({
      pageNumber: page.pageNumber,
      imagePath: page.imagePath,
      imageWidth: page.imageWidth || null,
      imageHeight: page.imageHeight || null,
    }));
  const extractionPages = extraction.pages.map((page) => ({
    pageNumber: page.pageNumber,
    text: page.text || "",
    blocks: Array.isArray(page.blocks) ? page.blocks : [],
    width: page.width || null,
    height: page.height || null,
  }));
  const pageArtifacts = extractPageArtifacts(extraction.pages);

  const paper = {
    id,
    filename,
    title,
    pdfPath,
    pageCount: extraction.pageCount,
    status: "ready",
    segmentationMode: extraction.pages.some((page) => Array.isArray(page.blocks) && page.blocks.length) ? "layout" : "heuristic",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pageImages,
    pageArtifacts,
    extractionPages,
    sections,
    paragraphs,
  };

  attachParagraphArtifactLinks(paper);
  return paper;
}

function splitIntoParagraphs(pages) {
  const paragraphs = [];

  for (const page of pages) {
    const blocks = getReadablePageBlocks(page);

    for (const block of blocks) {
      const clean = normalizeParagraph(typeof block === "string" ? block : block.text);
      if (!clean || (clean.length < 20 && !isLikelyHeading(clean))) {
        continue;
      }

      const sourceBox = typeof block === "string" ? null : pickBlockBox(block);
      appendParagraph(paragraphs, {
        id: `para_${paragraphs.length}_${randomUUID().slice(0, 8)}`,
        kind: isLikelyHeading(clean) ? "heading" : "paragraph",
        order: paragraphs.length,
        pageNumber: page.pageNumber,
        pageEndNumber: page.pageNumber,
        sourceBox,
        sectionId: "section_0",
        sourceText: clean,
        translation: "",
        explanation: "",
        keyTerms: [],
        relatedArtifactIds: [],
        chatMessages: [],
        analysisStatus: "pending",
        analysisError: "",
      });
    }
  }

  paragraphs.forEach((paragraph, index) => {
    paragraph.order = index;
  });

  return paragraphs;
}

function appendParagraph(paragraphs, paragraph) {
  const previous = paragraphs.at(-1);
  if (shouldMergeAcrossPage(previous, paragraph)) {
    previous.sourceText = mergeParagraphText(previous.sourceText, paragraph.sourceText);
    previous.pageEndNumber = paragraph.pageEndNumber;
    return;
  }

  paragraphs.push(paragraph);
}

function shouldMergeAcrossPage(previous, paragraph) {
  if (!previous || previous.kind !== "paragraph" || paragraph.kind !== "paragraph") {
    return false;
  }

  const previousEndPage = previous.pageEndNumber || previous.pageNumber;
  if (paragraph.pageNumber === previousEndPage) {
    return previous.sourceText.endsWith("-") && startsLikeContinuation(paragraph.sourceText);
  }

  if (paragraph.pageNumber !== previousEndPage + 1) {
    return false;
  }

  if (isLikelyHeading(paragraph.sourceText) || isLikelySectionOpening(paragraph.sourceText)) {
    return false;
  }

  return previous.sourceText.endsWith("-") ||
    !endsWithSentence(previous.sourceText) ||
    startsLikeContinuation(paragraph.sourceText);
}

function mergeParagraphText(previous, next) {
  if (previous.endsWith("-") && /^[a-z]/.test(next)) {
    return `${previous.slice(0, -1)}${next}`;
  }

  return `${previous} ${next}`.replace(/\s+/g, " ").trim();
}

function endsWithSentence(text) {
  return /[.!?。！？]["')\]]*$/.test(String(text || "").trim());
}

function startsLikeContinuation(text) {
  return /^[a-z,;:)\]]/.test(String(text || "").trim());
}

function isLikelySectionOpening(text) {
  return /^(abstract|introduction|related work|background|method|methods|methodology|experiments|results|discussion|conclusion|references|appendix)\b/i
    .test(String(text || "").trim());
}

function getReadablePageBlocks(page) {
  if (Array.isArray(page.blocks) && page.blocks.length) {
    const blocks = page.blocks
      .filter((block) => block?.text && !isLikelyNonReadingBlock(block))
      .map((block) => ({
        ...block,
        text: normalizeParagraph(block.text),
      }))
      .filter((block) => block.text);

    if (blocks.length) {
      return blocks;
    }
  }

  return extractTextBlocks(page.text);
}

function isLikelyNonReadingBlock(block) {
  const rawText = String(block.text || "").replace(/\s+/g, " ").trim();
  if (classifyPageArtifact(block)) {
    return true;
  }

  const text = normalizeParagraph(rawText);
  if (!text) {
    return true;
  }

  if (/^[∗*†‡]/.test(text)) {
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

function extractPageArtifacts(pages) {
  const artifacts = [];

  for (const page of pages) {
    const blocks = Array.isArray(page.blocks) ? page.blocks : [];
    blocks.forEach((block, index) => {
      const type = classifyPageArtifact(block);
      if (!type) {
        return;
      }

      const text = normalizeArtifactText(block.text);
      if (!text) {
        return;
      }

      const captionFields = type === "caption"
        ? buildCaptionArtifactFields(page, block)
        : {};

      artifacts.push({
        id: `artifact_${page.pageNumber}_${index}`,
        type,
        pageNumber: page.pageNumber,
        text,
        x: block.x ?? null,
        y: block.y ?? null,
        width: block.width ?? null,
        height: block.height ?? null,
        lineCount: block.lineCount || 1,
        ...captionFields,
      });
    });
  }

  return artifacts;
}

function buildCaptionArtifactFields(page, captionBlock) {
  const text = normalizeArtifactText(captionBlock?.text || "");
  const label = extractArtifactLabel(text);
  const crop = inferCaptionCrop(page, captionBlock, label);

  return {
    label,
    visualType: /^table\b/i.test(text) ? "table" : "figure",
    cropVersion: ARTIFACT_CROP_VERSION,
    imagePath: page.imagePath || null,
    imageWidth: page.imageWidth || null,
    imageHeight: page.imageHeight || null,
    pageWidth: page.width || null,
    pageHeight: page.height || null,
    crop,
  };
}

function extractArtifactLabel(text) {
  const match = String(text || "").match(/^(figure|fig\.|table)\s+(\d+[a-z]?)/i);
  if (!match) {
    return "";
  }

  const kind = /^table$/i.test(match[1]) ? "Table" : "Figure";
  return `${kind} ${match[2]}`;
}

function inferCaptionCrop(page, captionBlock, label) {
  const pageWidth = Number(page.width || 0);
  const pageHeight = Number(page.height || 0);
  if (!pageWidth || !pageHeight || !captionBlock) {
    return null;
  }

  const horizontal = inferVisualHorizontalBounds(page, captionBlock, pageWidth);
  const captionY = clampNumber(Number(captionBlock.y || 0), 0, pageHeight);
  const captionHeight = Math.max(1, Number(captionBlock.height || 0));
  const captionBottom = clampNumber(captionY + captionHeight, 0, pageHeight);
  const minHeight = Math.max(56, pageHeight * 0.08);
  const isTable = /^table\b/i.test(label) || /^table\b/i.test(captionBlock.text || "");
  if (isTable && captionBlock.lineCount >= 3 && Number(captionBlock.height || 0) > pageHeight * 0.06) {
    const tableBox = pickBlockBox(captionBlock);
    if (tableBox) {
      const paddingX = pageWidth * 0.014;
      const paddingY = pageHeight * 0.012;
      return normalizeCrop({
        x: tableBox.x - paddingX,
        y: tableBox.y - paddingY,
        width: tableBox.width + paddingX * 2,
        height: tableBox.height + paddingY * 2,
        pageWidth,
        pageHeight,
      });
    }
  }

  const candidateCrop = inferCandidateVisualCrop(page, captionBlock, horizontal, pageWidth, pageHeight, isTable);
  if (candidateCrop) {
    return candidateCrop;
  }

  let y;
  let bottom;

  if (isTable) {
    y = captionBlock.lineCount >= 3
      ? Math.max(0, captionY - pageHeight * 0.012)
      : Math.min(pageHeight, captionBottom + pageHeight * 0.006);
    bottom = findNextTextBoundary(page, captionBlock, horizontal, pageHeight) ||
      Math.min(pageHeight, captionBottom + pageHeight * 0.24);
    if (bottom - y < minHeight) {
      bottom = Math.min(pageHeight, captionBottom + pageHeight * 0.2);
    }
  } else {
    bottom = Math.max(0, captionY - pageHeight * 0.006);
    y = findPreviousTextBoundary(page, captionBlock, horizontal) ||
      Math.max(0, captionY - pageHeight * 0.26);
    if (captionY - y < minHeight) {
      y = Math.max(0, captionY - pageHeight * 0.22);
    }
  }

  return normalizeCrop({
    x: horizontal.x,
    y,
    width: horizontal.width,
    height: bottom - y,
    pageWidth,
    pageHeight,
  });
}

function inferCandidateVisualCrop(page, captionBlock, horizontal, pageWidth, pageHeight, isTable) {
  const candidates = getVisualCandidateBlocks(page, captionBlock, horizontal, pageHeight, isTable);
  if (!candidates.length) {
    return null;
  }

  const captionY = clampNumber(Number(captionBlock.y || 0), 0, pageHeight);
  const captionBottom = clampNumber(Number(captionBlock.y || 0) + Number(captionBlock.height || 0), 0, pageHeight);
  const bounds = getBlockBounds(candidates);
  if (!bounds) {
    return null;
  }

  const paddingX = pageWidth * 0.018;
  const paddingY = pageHeight * 0.014;
  const subfigureLabels = candidates.filter((block) => /^\([a-z]\)/i.test(normalizeArtifactText(block.text))).length;
  const yExpansion = !isTable && subfigureLabels >= 1
    ? Math.min(pageHeight * 0.22, Math.max(pageHeight * 0.14, bounds.height * 0.9))
    : 0;

  let x = bounds.x - paddingX;
  let y = bounds.y - paddingY - yExpansion;
  let right = bounds.x + bounds.width + paddingX;
  let bottom = bounds.y + bounds.height + paddingY;

  if (isTable) {
    if (captionBlock.lineCount >= 3 && Number(captionBlock.height || 0) > pageHeight * 0.06) {
      const captionBounds = pickBlockBox(captionBlock);
      if (captionBounds) {
        x = Math.min(x, captionBounds.x - paddingX);
        y = Math.min(y, captionBounds.y - paddingY);
        right = Math.max(right, captionBounds.x + captionBounds.width + paddingX);
        bottom = Math.max(bottom, captionBounds.y + captionBounds.height + paddingY);
      }
    } else {
      y = Math.min(pageHeight, captionBottom + pageHeight * 0.006);
    }

    const nextCaptionBoundary = findNextCaptionBoundary(page, captionBlock, horizontal, pageHeight);
    if (nextCaptionBoundary !== null) {
      bottom = Math.min(bottom, nextCaptionBoundary);
    }
  } else {
    bottom = Math.min(bottom, captionY - pageHeight * 0.006);
    const previousCaptionBoundary = findPreviousCaptionBoundary(page, captionBlock, horizontal);
    if (previousCaptionBoundary !== null) {
      y = Math.max(y, previousCaptionBoundary);
    }
  }

  return normalizeCrop({
    x,
    y,
    width: right - x,
    height: bottom - y,
    pageWidth,
    pageHeight,
  });
}

function getVisualCandidateBlocks(page, captionBlock, horizontal, pageHeight, isTable) {
  const blocks = Array.isArray(page.blocks) ? page.blocks : [];
  const captionY = Number(captionBlock.y || 0);
  const captionBottom = Number(captionBlock.y || 0) + Number(captionBlock.height || 0);
  const captionColumn = Number(captionBlock.column || 0);
  const nextCaptionBoundary = isTable
    ? findNextCaptionBoundary(page, captionBlock, horizontal, pageHeight)
    : null;

  return blocks.filter((block) => {
    if (block === captionBlock || !pickBlockBox(block)) {
      return false;
    }

    if (!overlapsHorizontal(block, horizontal, 0.06)) {
      return false;
    }

    if (classifyPageArtifact(block) === "caption") {
      return false;
    }

    if (captionColumn && Number(block.column || 0) && Number(block.column || 0) !== captionColumn) {
      const blockWidth = Number(block.width || 0);
      if (blockWidth < horizontal.width * 0.45) {
        return false;
      }
    }

    const y = Number(block.y || 0);
    const bottom = y + Number(block.height || 0);
    if (isTable) {
      if (nextCaptionBoundary !== null && y >= nextCaptionBoundary) {
        return false;
      }

      if (y < captionY - pageHeight * 0.06 || y > captionBottom + pageHeight * 0.42) {
        return false;
      }
      return isLikelyVisualCandidateBlock(block, true);
    }

    if (bottom > captionY + 2 || bottom < captionY - pageHeight * 0.52) {
      return false;
    }

    return isLikelyVisualCandidateBlock(block, false);
  });
}

function isLikelyVisualCandidateBlock(block, isTable) {
  const text = normalizeArtifactText(block?.text || "");
  if (!text) {
    return false;
  }

  const type = classifyPageArtifact(block);
  if (type && type !== "caption") {
    return true;
  }

  if (/^\([a-z]\)/i.test(text)) {
    return true;
  }

  const lineCount = Number(block.lineCount || 1);
  const averageLineLength = text.length / Math.max(1, lineCount);

  if (isTable) {
    const numberTokens = (text.match(/\b\d+(?:[.,]\d+)*\b/g) || []).length;
    const tableHeader = /\b(dataset|granularity|mae|rmse|accuracy|method|model|total|average|avg|horizon|time series|time points)\b|#/i.test(text);
    const longSentence = /[A-Za-z][^.!?。！？]{45,}[.!?。！？]\s+[A-Z]/.test(text);
    if (longSentence) {
      return false;
    }

    if (numberTokens >= 2) {
      return true;
    }

    if (tableHeader && text.length <= 220 && averageLineLength <= 70) {
      return true;
    }
  }

  const sentenceLike = /[.!?。！？][)"'\]]?(\s|$)/.test(text);
  const visualTokens = /\b(input|output|query|token|patch|layer|request|engine|latency|throughput|summary|manager|task|code|model|dataset|mae|ett|flops)\b/i.test(text);

  return lineCount >= 2 && averageLineLength <= 48 && (visualTokens || !sentenceLike);
}

function getBlockBounds(blocks) {
  const boxes = blocks.map(pickBlockBox).filter(Boolean);
  if (!boxes.length) {
    return null;
  }

  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

function inferVisualHorizontalBounds(page, captionBlock, pageWidth) {
  const blocks = Array.isArray(page.blocks) ? page.blocks : [];
  const content = getContentBounds(blocks, pageWidth);
  const captionColumn = Number(captionBlock.column || 0);

  if (captionColumn === 1 || captionColumn === 2) {
    const columnBlocks = blocks.filter((block) => Number(block.column || 0) === captionColumn);
    const columnBounds = getContentBounds(columnBlocks, pageWidth);
    return expandHorizontalBounds(columnBounds, pageWidth, pageWidth * 0.015);
  }

  return expandHorizontalBounds(content, pageWidth, pageWidth * 0.02);
}

function getContentBounds(blocks, pageWidth) {
  const valid = blocks
    .map(pickBlockBox)
    .filter((box) => box && box.width > 0);

  if (!valid.length) {
    return {
      x: pageWidth * 0.06,
      width: pageWidth * 0.88,
    };
  }

  const minX = Math.min(...valid.map((box) => box.x));
  const maxX = Math.max(...valid.map((box) => box.x + box.width));
  return {
    x: clampNumber(minX, 0, pageWidth),
    width: clampNumber(maxX - minX, pageWidth * 0.18, pageWidth),
  };
}

function expandHorizontalBounds(bounds, pageWidth, padding) {
  const x = clampNumber(bounds.x - padding, 0, pageWidth);
  const right = clampNumber(bounds.x + bounds.width + padding, 0, pageWidth);
  return {
    x,
    width: Math.max(1, right - x),
  };
}

function findPreviousTextBoundary(page, captionBlock, horizontal) {
  const captionY = Number(captionBlock.y || 0);
  const regularAbove = getRegularBoundaryBlocks(page, captionBlock, horizontal)
    .filter((block) => Number(block.y || 0) + Number(block.height || 0) <= captionY)
    .sort((a, b) => (Number(b.y || 0) + Number(b.height || 0)) - (Number(a.y || 0) + Number(a.height || 0)));

  const boundary = regularAbove[0];
  if (!boundary) {
    return null;
  }

  return Number(boundary.y || 0) + Number(boundary.height || 0) + 4;
}

function findNextTextBoundary(page, captionBlock, horizontal, pageHeight) {
  const captionBottom = Number(captionBlock.y || 0) + Number(captionBlock.height || 0);
  const regularBelow = getRegularBoundaryBlocks(page, captionBlock, horizontal)
    .filter((block) => Number(block.y || 0) >= captionBottom)
    .sort((a, b) => Number(a.y || 0) - Number(b.y || 0));

  const boundary = regularBelow[0];
  if (!boundary) {
    return null;
  }

  return clampNumber(Number(boundary.y || 0) - 4, captionBottom, pageHeight);
}

function findPreviousCaptionBoundary(page, captionBlock, horizontal) {
  const captionY = Number(captionBlock.y || 0);
  const captionsAbove = getNeighborCaptionBlocks(page, captionBlock, horizontal)
    .filter((block) => Number(block.y || 0) + Number(block.height || 0) <= captionY)
    .sort((a, b) => (Number(b.y || 0) + Number(b.height || 0)) - (Number(a.y || 0) + Number(a.height || 0)));

  const boundary = captionsAbove[0];
  if (!boundary) {
    return null;
  }

  return Number(boundary.y || 0) + Number(boundary.height || 0) + 4;
}

function findNextCaptionBoundary(page, captionBlock, horizontal, pageHeight) {
  const captionBottom = Number(captionBlock.y || 0) + Number(captionBlock.height || 0);
  const captionsBelow = getNeighborCaptionBlocks(page, captionBlock, horizontal)
    .filter((block) => Number(block.y || 0) >= captionBottom)
    .sort((a, b) => Number(a.y || 0) - Number(b.y || 0));

  const boundary = captionsBelow[0];
  if (!boundary) {
    return null;
  }

  return clampNumber(Number(boundary.y || 0) - 4, captionBottom, pageHeight);
}

function getNeighborCaptionBlocks(page, captionBlock, horizontal) {
  const blocks = Array.isArray(page.blocks) ? page.blocks : [];
  return blocks.filter((block) => {
    if (block === captionBlock) {
      return false;
    }

    return classifyPageArtifact(block) === "caption" && overlapsHorizontal(block, horizontal, 0.04);
  });
}

function getRegularBoundaryBlocks(page, captionBlock, horizontal) {
  const blocks = Array.isArray(page.blocks) ? page.blocks : [];
  return blocks.filter((block) => {
    if (block === captionBlock) {
      return false;
    }

    if (!overlapsHorizontal(block, horizontal)) {
      return false;
    }

    if (classifyPageArtifact(block)) {
      return false;
    }

    const text = normalizeParagraph(block.text || "");
    return text.length >= 45 && /[.!?。！？]/.test(text);
  });
}

function overlapsHorizontal(block, horizontal, ratio = 0.18) {
  const box = pickBlockBox(block);
  if (!box) {
    return false;
  }

  const left = Math.max(box.x, horizontal.x);
  const right = Math.min(box.x + box.width, horizontal.x + horizontal.width);
  return right - left > Math.min(box.width, horizontal.width) * ratio;
}

function normalizeCrop(crop) {
  const x = clampNumber(crop.x, 0, crop.pageWidth);
  const y = clampNumber(crop.y, 0, crop.pageHeight);
  const right = clampNumber(crop.x + crop.width, x + 1, crop.pageWidth);
  const bottom = clampNumber(crop.y + crop.height, y + 1, crop.pageHeight);

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
    pageWidth: crop.pageWidth,
    pageHeight: crop.pageHeight,
  };
}

function pickBlockBox(block) {
  if (!block) {
    return null;
  }

  const x = Number(block.x);
  const y = Number(block.y);
  const width = Number(block.width);
  const height = Number(block.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return null;
  }

  return { x, y, width, height };
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

function classifyPageArtifact(block) {
  const text = normalizeArtifactText(block?.text || "");
  if (!text) {
    return "";
  }

  if (/^(figure|fig\.|table)\s+\d+[a-z]?\s*:/i.test(text)) {
    return "caption";
  }

  if (isLikelyFormulaBlock(text, block)) {
    return "formula";
  }

  if (isLikelyCodeBlock(text, block)) {
    return "code";
  }

  if (isLikelyFigureTextBlock(text, block)) {
    return "figure-text";
  }

  return "";
}

function isLikelyFormulaBlock(text, block = {}) {
  const lineCount = Number(block.lineCount || 1);
  const mathTokens = (text.match(/[=≤≥≠≈∑∏∫√∞→←↔±×÷∂λμσγαβθΩΔ]|\b(argmin|argmax|softmax|log|exp|min|max)\b/gi) || []).length;
  const sentenceCount = (text.match(/[.!?。！？]/g) || []).length;

  return text.length <= 260 && lineCount <= 5 && mathTokens >= 2 && sentenceCount <= 1;
}

function isLikelyCodeBlock(text, block = {}) {
  const lineCount = Number(block.lineCount || 1);
  if (/^(import|from|def|class|function|const|let|var)\b/i.test(text)) {
    return true;
  }

  const codeKeywords = (text.match(/\b(function|class|def|return|import|from|const|let|var|public|private|void|int|float|string|for|while|if|else)\b/gi) || []).length;
  const codeSymbols = (text.match(/[{};=<>]/g) || []).length;

  return lineCount >= 3 && codeKeywords >= 2 && codeSymbols >= 4 && text.length <= 1800;
}

function isLikelyFigureTextBlock(text, block = {}) {
  const lineCount = Number(block.lineCount || 1);
  const averageLineLength = text.length / Math.max(1, lineCount);
  const diagramTokens = /\b(LLM|Query|Chunk|Task|Final|Summary|Checker|Architect|Engineer|Code|Message Passing)\b/i.test(text);

  return lineCount >= 6 && averageLineLength < 34 && diagramTokens;
}

function normalizeArtifactText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTextBlocks(text) {
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

function normalizeParagraph(text) {
  return String(text || "")
    .replace(/^(?:Figure|Fig\.|Table)\s+\d+[a-z]?\s*:[^.!?。！？]*(?:[.!?。！？]|$)/i, " ")
    .replace(/\s+(?:Figure|Fig\.|Table)\s+\d+[a-z]?\s*:[^.!?。！？]*(?:[.!?。！？]|$)/gi, " ")
    .replace(/[ \t]*\n[ \t]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferSections(paragraphs) {
  const sections = [{
    id: "section_0",
    title: "正文",
    level: 1,
    order: 0,
    summary: "",
  }];

  let currentSectionId = "section_0";

  for (const paragraph of paragraphs) {
    if (paragraph.kind === "heading" || isLikelyHeading(paragraph.sourceText)) {
      currentSectionId = `section_${sections.length}`;
      sections.push({
        id: currentSectionId,
        title: paragraph.sourceText,
        level: 1,
        order: sections.length,
        summary: "",
      });
    }

    paragraph.sectionId = currentSectionId;
  }

  return sections;
}

function inferTitle(paragraphs, filename) {
  const firstLongText = paragraphs
    .slice(0, 5)
    .map((item) => item.sourceText)
    .find((text) => text.length >= 20 && text.length <= 180);

  return firstLongText || filename.replace(/\.pdf$/i, "");
}

async function segmentPaperWithAi(paper, settings, options = {}) {
  const chunks = chunkPagesForSegmentation(paper.extractionPages || []);
  const items = [];

  for (const chunk of chunks) {
    const chunkItems = await segmentPageChunkWithAi(paper, chunk, settings, { signal: options.signal });
    items.push(...chunkItems);
  }

  const paragraphs = buildParagraphsFromSegmentItems(items);
  const readingCount = paragraphs.filter((paragraph) => paragraph.kind !== "heading").length;

  if (readingCount < 3) {
    throw new Error("AI 分段结果太少，已保留基础分段。");
  }

  const sections = inferSections(paragraphs);
  const segmented = {
    ...paper,
    title: inferTitle(paragraphs, paper.filename),
    status: "ready",
    segmentationMode: "ai",
    sections,
    paragraphs,
    updatedAt: new Date().toISOString(),
  };

  attachParagraphArtifactLinks(segmented);
  return segmented;
}

function chunkPagesForSegmentation(pages) {
  const chunks = [];
  let current = [];
  let currentChars = 0;
  const maxChars = 8500;
  const maxPages = 3;

  for (const page of pages) {
    const textLength = getSegmentationPageText(page).length;
    if (current.length && (current.length >= maxPages || currentChars + textLength > maxChars)) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }

    current.push(page);
    currentChars += textLength;
  }

  if (current.length) {
    chunks.push(current);
  }

  return chunks;
}

async function segmentPageChunkWithAi(paper, pages, settings, options = {}) {
  const pageText = pages
    .map((page) => [
      `--- Page ${page.pageNumber} ---`,
      getSegmentationPageText(page).slice(0, 12_000),
    ].join("\n"))
    .join("\n\n");

  const messages = [
    {
      role: "system",
      content: [
        "你是论文 PDF 分段助手。你的任务是把 PDF 抽取出来的页面文本切成适合精读的语义段落。",
        "必须忠于原文，不翻译，不总结，不新增内容。",
        "合并同一自然段内的换行和断词，保留标题、编号、公式引用和术语。",
        "只输出合法 JSON，不要使用 Markdown 代码块。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `论文: ${paper.title || paper.filename}`,
        "",
        "请把下面页面文本切分为语义段落。",
        "输出格式必须是：",
        "{",
        '  "items": [',
        '    { "kind": "heading", "pageNumber": 1, "sourceText": "章节标题" },',
        '    { "kind": "paragraph", "pageNumber": 1, "sourceText": "自然段原文" }',
        "  ]",
        "}",
        "",
        "页面文本:",
        pageText,
      ].join("\n"),
    },
  ];

  const content = await callModel(settings, messages, { maxTokens: 6000, signal: options.signal });
  const parsed = parseModelJson(content);
  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];

  return rawItems
    .map((item) => ({
      kind: String(item.kind || "").toLowerCase() === "heading" ? "heading" : "paragraph",
      pageNumber: Number(item.pageNumber || pages[0]?.pageNumber || 1),
      sourceText: normalizeParagraph(item.sourceText || item.text || ""),
    }))
    .filter((item) => item.sourceText);
}

function getSegmentationPageText(page) {
  const blocks = getReadablePageBlocks(page);
  if (blocks.length) {
    return blocks
      .map((block, index) => {
        const text = typeof block === "string" ? block : block.text;
        return `[B${index + 1}] ${normalizeParagraph(text)}`;
      })
      .join("\n\n");
  }

  return String(page.text || "");
}

function buildParagraphsFromSegmentItems(items) {
  const paragraphs = [];
  const seen = new Set();

  for (const item of items) {
    const clean = normalizeParagraph(item.sourceText);
    if (!clean || (clean.length < 20 && item.kind !== "heading" && !isLikelyHeading(clean))) {
      continue;
    }

    const dedupeKey = `${item.pageNumber}:${clean.slice(0, 160)}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    const order = paragraphs.length;
    const kind = item.kind === "heading" || isLikelyHeading(clean) ? "heading" : "paragraph";
    paragraphs.push({
      id: `para_${order}_${randomUUID().slice(0, 8)}`,
      kind,
      order,
      pageNumber: Number.isFinite(item.pageNumber) && item.pageNumber > 0 ? item.pageNumber : 1,
      pageEndNumber: Number.isFinite(item.pageNumber) && item.pageNumber > 0 ? item.pageNumber : 1,
      sectionId: "section_0",
      sourceText: clean,
      translation: "",
      explanation: "",
      keyTerms: [],
      relatedArtifactIds: [],
      chatMessages: [],
      analysisStatus: "pending",
      analysisError: "",
    });
  }

  return paragraphs;
}

function attachParagraphArtifactLinks(paper) {
  const artifacts = Array.isArray(paper.pageArtifacts)
    ? paper.pageArtifacts.filter((artifact) => artifact.type === "caption" && artifact.label)
    : [];

  if (!artifacts.length || !Array.isArray(paper.paragraphs)) {
    return paper;
  }

  for (const paragraph of paper.paragraphs) {
    if (paragraph.kind === "heading") {
      paragraph.relatedArtifactIds = [];
      continue;
    }

    const matched = artifacts
      .filter((artifact) => paragraphCanReferenceArtifact(paragraph, artifact))
      .map((artifact) => artifact.id);

    paragraph.relatedArtifactIds = [...new Set(matched)];
  }

  return paper;
}

function paragraphCanReferenceArtifact(paragraph, artifact) {
  const text = String(paragraph.sourceText || "");
  if (!text) {
    return false;
  }

  const pageStart = Number(paragraph.pageNumber || 0);
  const pageEnd = Number(paragraph.pageEndNumber || pageStart);
  const artifactPage = Number(artifact.pageNumber || 0);
  if (artifactPage && (artifactPage < pageStart - 1 || artifactPage > pageEnd + 1)) {
    return false;
  }

  const label = parseArtifactLabel(artifact.label);
  if (!label) {
    return false;
  }

  const number = escapeRegExp(label.number);
  const pattern = label.kind === "table"
    ? `\\b(?:table|tab\\.?)\\s*${number}(?:\\s*\\([a-z]\\))?\\b`
    : `\\b(?:figure|fig\\.?)\\s*${number}(?:\\s*\\([a-z]\\))?\\b`;

  return new RegExp(pattern, "i").test(text);
}

function parseArtifactLabel(label) {
  const match = String(label || "").match(/^(figure|table)\s+(\d+[a-z]?)/i);
  if (!match) {
    return null;
  }

  return {
    kind: match[1].toLowerCase() === "table" ? "table" : "figure",
    number: match[2],
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isLikelyHeading(line) {
  const text = String(line || "").trim();
  if (text.length < 3 || text.length > 90) {
    return false;
  }

  if (/^\d+(\.\d+)*\.?\s+[A-Z][\w\s:-]+$/.test(text)) {
    return true;
  }

  const known = [
    "abstract",
    "introduction",
    "related work",
    "background",
    "method",
    "methods",
    "methodology",
    "experiments",
    "experiment",
    "results",
    "discussion",
    "conclusion",
    "references",
    "appendix",
  ];

  return known.includes(text.toLowerCase());
}

async function extractPdfText(pdfPath, assetDir, assetPublicBase) {
  const errors = [];
  const requestedEngine = PDF_ENGINE.toLowerCase();

  if (requestedEngine !== "swift") {
    try {
      return await extractPdfWithPoppler(pdfPath, assetDir, assetPublicBase);
    } catch (error) {
      if (requestedEngine === "poppler") {
        throw error;
      }
      errors.push(`Poppler: ${error.message}`);
    }
  }

  if (requestedEngine !== "poppler") {
    try {
      return await extractPdfWithSwift(pdfPath, assetDir, assetPublicBase);
    } catch (error) {
      errors.push(`Swift/PDFKit: ${error.message}`);
    }
  }

  throw new Error(`PDF 提取失败。${errors.join(" ")}`);
}

async function extractPdfWithPoppler(pdfPath, assetDir, assetPublicBase) {
  const xml = await execFileText("pdftotext", [
    "-bbox-layout",
    "-enc",
    "UTF-8",
    pdfPath,
    "-",
  ], {
    cwd: __dirname,
    timeout: 90_000,
    maxBuffer: 80 * 1024 * 1024,
  });

  const pages = parsePopplerBboxLayout(xml);
  if (!pages.length) {
    throw new Error("pdftotext 没有返回可解析页面。");
  }

  if (assetDir && assetPublicBase) {
    await renderPdfPagesWithPoppler(pdfPath, assetDir, assetPublicBase, pages);
  }

  return {
    pageCount: pages.length,
    pages,
  };
}

async function extractPdfWithSwift(pdfPath, assetDir, assetPublicBase) {
  const scriptPath = path.join(__dirname, "scripts", "extract_pdf_text.swift");
  const args = [scriptPath, pdfPath];
  if (assetDir && assetPublicBase) {
    args.push(assetDir, assetPublicBase);
  }

  return new Promise((resolve, reject) => {
    execFile("/usr/bin/swift", args, {
      cwd: __dirname,
      env: {
        ...process.env,
        CLANG_MODULE_CACHE_PATH: SWIFT_MODULE_CACHE_DIR,
        TMPDIR: TMP_DIR,
      },
      timeout: 60_000,
      maxBuffer: 40 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (parseError) {
        reject(new Error(`Could not parse PDF extraction output: ${parseError.message}`));
      }
    });
  });
}

function execFileText(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        const message = error.code === "ENOENT"
          ? `${command} 未安装或不在 PATH 中。`
          : stderr || error.message;
        reject(new Error(message));
        return;
      }

      resolve(stdout);
    });
  });
}

async function renderPdfPagesWithPoppler(pdfPath, assetDir, assetPublicBase, pages) {
  await mkdir(assetDir, { recursive: true });
  const outputPrefix = path.join(assetDir, "page");
  await execFileText("pdftoppm", [
    "-png",
    "-r",
    "144",
    "-scale-to-x",
    "1100",
    "-scale-to-y",
    "-1",
    pdfPath,
    outputPrefix,
  ], {
    cwd: __dirname,
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  const files = await readdir(assetDir);
  const pageFiles = files
    .map((file) => ({ file, match: file.match(/^page-(\d+)\.png$/i) }))
    .filter((item) => item.match)
    .map((item) => ({
      file: item.file,
      pageNumber: Number(item.match[1]),
    }))
    .filter((item) => Number.isFinite(item.pageNumber))
    .sort((a, b) => a.pageNumber - b.pageNumber);

  for (const item of pageFiles) {
    const filename = `page-${String(item.pageNumber).padStart(3, "0")}.png`;
    const sourcePath = path.join(assetDir, item.file);
    const targetPath = path.join(assetDir, filename);
    if (sourcePath !== targetPath) {
      await rename(sourcePath, targetPath).catch(() => {});
    }

    const page = pages[item.pageNumber - 1];
    if (!page) {
      continue;
    }

    const image = await readFile(targetPath).catch(() => null);
    const size = image ? readPngSize(image) : null;
    page.imagePath = `${assetPublicBase}/${filename}`;
    page.imageWidth = size?.width || null;
    page.imageHeight = size?.height || null;
  }
}

function readPngSize(buffer) {
  if (!buffer || buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") {
    return null;
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function parsePopplerBboxLayout(xml) {
  const pages = [];
  const pageRegex = /<page\b([^>]*)>([\s\S]*?)<\/page>/gi;
  let pageMatch;

  while ((pageMatch = pageRegex.exec(xml))) {
    const pageAttrs = parseXmlAttributes(pageMatch[1]);
    const rawBlocks = parsePopplerBlocks(pageMatch[2]);
    const blocks = orderPopplerBlocks(rawBlocks);
    pages.push({
      pageNumber: pages.length + 1,
      text: blocks.map((block) => block.text).join("\n\n"),
      blocks,
      width: Number(pageAttrs.width || 0) || null,
      height: Number(pageAttrs.height || 0) || null,
      imagePath: null,
      imageWidth: null,
      imageHeight: null,
    });
  }

  return pages;
}

function parsePopplerBlocks(pageXml) {
  const blocks = [];
  const blockRegex = /<block\b([^>]*)>([\s\S]*?)<\/block>/gi;
  let blockMatch;

  while ((blockMatch = blockRegex.exec(pageXml))) {
    const blockAttrs = parseXmlAttributes(blockMatch[1]);
    const lines = parsePopplerLines(blockMatch[2]);
    const text = normalizePopplerText(lines.map((line) => line.text).join(" "));
    if (!text) {
      continue;
    }

    const xMin = Number(blockAttrs.xMin ?? blockAttrs.xmin ?? 0);
    const yMin = Number(blockAttrs.yMin ?? blockAttrs.ymin ?? 0);
    const xMax = Number(blockAttrs.xMax ?? blockAttrs.xmax ?? xMin);
    const yMax = Number(blockAttrs.yMax ?? blockAttrs.ymax ?? yMin);

    blocks.push({
      text,
      x: xMin,
      y: yMin,
      width: Math.max(0, xMax - xMin),
      height: Math.max(0, yMax - yMin),
      column: 0,
      lineCount: Math.max(1, lines.length),
    });
  }

  return blocks;
}

function parsePopplerLines(blockXml) {
  const lines = [];
  const lineRegex = /<line\b([^>]*)>([\s\S]*?)<\/line>/gi;
  let lineMatch;

  while ((lineMatch = lineRegex.exec(blockXml))) {
    const words = [];
    const wordRegex = /<word\b[^>]*>([\s\S]*?)<\/word>/gi;
    let wordMatch;

    while ((wordMatch = wordRegex.exec(lineMatch[2]))) {
      const word = decodeXmlEntities(wordMatch[1].replace(/<[^>]+>/g, ""));
      if (word.trim()) {
        words.push(word.trim());
      }
    }

    const text = normalizePopplerText(words.join(" "));
    if (text) {
      lines.push({ text });
    }
  }

  return lines;
}

function orderPopplerBlocks(blocks) {
  if (blocks.length <= 4) {
    return blocks.sort(comparePopplerTopToBottom);
  }

  const minX = Math.min(...blocks.map((block) => block.x));
  const maxX = Math.max(...blocks.map((block) => block.x + block.width));
  const contentWidth = Math.max(1, maxX - minX);
  const midpoint = minX + contentWidth / 2;
  const withColumns = blocks.map((block) => {
    const center = block.x + block.width / 2;
    const spansBothColumns = block.width > contentWidth * 0.62 && block.x < midpoint && block.x + block.width > midpoint;
    const centeredWideBlock = block.width > contentWidth * 0.32 && Math.abs(center - midpoint) < contentWidth * 0.18;
    return {
      ...block,
      column: (spansBothColumns || centeredWideBlock) ? 0 : (center < midpoint ? 1 : 2),
    };
  });

  const leftCount = withColumns.filter((block) => block.column === 1 && block.text.length > 8).length;
  const rightCount = withColumns.filter((block) => block.column === 2 && block.text.length > 8).length;
  if (leftCount < 4 || rightCount < 4) {
    return withColumns.sort(comparePopplerTopToBottom);
  }

  const columnTop = Math.min(...withColumns.filter((block) => block.column !== 0).map((block) => block.y));
  const topFullWidth = withColumns
    .filter((block) => block.column === 0 && block.y <= columnTop + 6)
    .sort(comparePopplerTopToBottom);
  const leftColumn = withColumns
    .filter((block) => block.column === 1)
    .sort(comparePopplerTopToBottom);
  const rightColumn = withColumns
    .filter((block) => block.column === 2)
    .sort(comparePopplerTopToBottom);
  const remainingFullWidth = withColumns
    .filter((block) => block.column === 0 && block.y > columnTop + 6)
    .sort(comparePopplerTopToBottom);

  return [...topFullWidth, ...leftColumn, ...rightColumn, ...remainingFullWidth];
}

function comparePopplerTopToBottom(a, b) {
  if (Math.abs(a.y - b.y) > 2) {
    return a.y - b.y;
  }

  return a.x - b.x;
}

function parseXmlAttributes(source) {
  const attrs = {};
  const attrRegex = /([:\w-]+)="([^"]*)"/g;
  let match;

  while ((match = attrRegex.exec(source))) {
    attrs[match[1]] = decodeXmlEntities(match[2]);
  }

  return attrs;
}

function decodeXmlEntities(text) {
  return String(text || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, value) => String.fromCodePoint(Number.parseInt(value, 16)))
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number.parseInt(value, 10)))
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function normalizePopplerText(text) {
  return String(text || "")
    .replace(/\u00ad/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function callModel(settings, messages, options = {}) {
  const cleanSettings = normalizeSettings(settings);
  if (cleanSettings.baseUrl === "local:claude-kimi") {
    return callClaudeAgent(cleanSettings, messages, { usePageKimiKey: true, signal: options.signal });
  }

  if (cleanSettings.baseUrl === "local:claude-config") {
    return callClaudeAgent(cleanSettings, messages, { usePageKimiKey: false, signal: options.signal });
  }

  const endpoint = getChatCompletionsEndpoint(cleanSettings.baseUrl);
  const controller = new AbortController();
  const abortFromExternalSignal = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener("abort", abortFromExternalSignal, { once: true });
    }
  }
  const timeout = setTimeout(() => controller.abort(), 90_000);

  try {
    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${cleanSettings.apiKey}`,
        },
        body: JSON.stringify({
          model: cleanSettings.model,
          messages,
          temperature: 0.2,
          ...getProviderPayloadOptions(cleanSettings),
          ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
        }),
      });
    } catch (error) {
      if (error.name === "AbortError") {
        throw options.signal?.aborted
          ? requestCanceledError()
          : new Error("模型请求超时，请稍后重试。");
      }

      throw new Error(formatModelNetworkError(error, cleanSettings));
    }

    const text = await response.text();
    if (!response.ok) {
      throw new Error(formatModelError(response.status, text));
    }

    const data = JSON.parse(text);
    const message = data.choices?.[0]?.message;
    const content = message?.content || message?.reasoning_content;
    if (!content) {
      throw new Error("Model response did not include message content.");
    }

    return content.trim();
  } finally {
    options.signal?.removeEventListener("abort", abortFromExternalSignal);
    clearTimeout(timeout);
  }
}

function formatModelNetworkError(error, settings) {
  const proxyHint = settings.proxyUrl || process.env.PAPERLENS_PROXY_URL
    ? "已检测到代理配置，但当前普通 OpenAI-compatible 请求可能仍受 Node.js fetch 代理支持限制影响；Claude Code Provider 会优先使用代理环境。"
    : "如果你的网络需要代理，请在网页 Proxy URL 或 .env 的 PAPERLENS_PROXY_URL 中填写代理地址。";

  return `模型网络请求失败：${error.message || "fetch failed"}。${proxyHint}`;
}

function requestCanceledError() {
  const error = new Error("请求已取消。");
  error.statusCode = 499;
  return error;
}

function callClaudeAgent(settings, messages, options = {}) {
  const systemPrompt = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n") || "你是一个严谨的论文阅读助手。";
  const prompt = messages
    .filter((message) => message.role !== "system")
    .map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
    .join("\n\n");

  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      prompt,
      "--bare",
      "--no-session-persistence",
      "--tools",
      "",
      "--model",
      settings.model || "kimi-for-coding",
      "--output-format",
      "json",
      "--system-prompt",
      systemPrompt,
      "--max-budget-usd",
      String(settings.agentBudgetUsd || 500),
    ];

    if (!options.usePageKimiKey) {
      const bareIndex = args.indexOf("--bare");
      if (bareIndex !== -1) {
        args.splice(bareIndex, 1);
      }
    } else {
      args.push("--setting-sources", "project");
    }

    const commandPath = buildCommandPath();
    const claudeCommand = resolveClaudeCommand(commandPath);
    const child = spawn(claudeCommand, args, {
      cwd: __dirname,
      env: buildClaudeEnv(settings, options, commandPath),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      settled = true;
      options.signal?.removeEventListener("abort", abortHandler);
      reject(new Error("Claude Code 本地 Agent 调用超时。"));
    }, 180_000);
    const abortHandler = () => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      child.kill("SIGTERM");
      reject(requestCanceledError());
    };

    if (options.signal) {
      if (options.signal.aborted) {
        abortHandler();
      } else {
        options.signal.addEventListener("abort", abortHandler, { once: true });
      }
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortHandler);
      if (error.code === "ENOENT") {
        reject(new Error("未找到 claude CLI。请先安装 Claude Code，或设置 PAPERLENS_CLAUDE_CLI 指向 claude 可执行文件。"));
        return;
      }

      reject(error);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortHandler);
      const result = parseClaudeJsonResult(stdout);

      if (code !== 0) {
        reject(new Error(formatClaudeAgentError(result, stderr, code)));
        return;
      }

      if (!result) {
        reject(new Error(`Claude Code 没有返回可解析结果。${stderr ? `stderr: ${stderr.slice(0, 500)}` : ""}`));
        return;
      }

      if (typeof result.result === "string" && result.result.startsWith("API Error:")) {
        reject(new Error(formatClaudeAgentError(result, stderr, code)));
        return;
      }

      resolve(String(result.result || result.content || stdout).trim());
    });

    child.stdin.end();
  });
}

function buildCommandPath() {
  const parts = [
    ...(process.env.PATH || "").split(path.delimiter),
    ...EXTRA_BIN_DIRS,
  ].filter(Boolean);

  return [...new Set(parts)].join(path.delimiter);
}

function resolveClaudeCommand(commandPath) {
  if (process.env.PAPERLENS_CLAUDE_CLI) {
    return process.env.PAPERLENS_CLAUDE_CLI;
  }

  for (const directory of commandPath.split(path.delimiter)) {
    const candidate = path.join(directory, "claude");
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return "claude";
}

function buildClaudeEnv(settings, options, commandPath) {
  return {
    ...process.env,
    ...getProxyEnv(settings.proxyUrl),
    PATH: commandPath,
    ...(options.usePageKimiKey ? {
      ANTHROPIC_BASE_URL: "https://api.kimi.com/coding/",
      ANTHROPIC_API_KEY: settings.apiKey,
    } : {}),
    ENABLE_TOOL_SEARCH: "false",
  };
}

function getProxyEnv(proxyUrl = "") {
  const configuredProxyUrl = proxyUrl || process.env.PAPERLENS_PROXY_URL || "";
  const httpProxy = proxyUrl || process.env.HTTP_PROXY || process.env.http_proxy || configuredProxyUrl;
  const httpsProxy = proxyUrl || process.env.HTTPS_PROXY || process.env.https_proxy || configuredProxyUrl;
  const allProxy = proxyUrl || process.env.ALL_PROXY || process.env.all_proxy || configuredProxyUrl;
  const noProxy = process.env.NO_PROXY || process.env.no_proxy || "";
  const env = {};

  for (const [key, value] of [
    ["HTTP_PROXY", httpProxy],
    ["HTTPS_PROXY", httpsProxy],
    ["ALL_PROXY", allProxy],
    ["NO_PROXY", noProxy],
    ["http_proxy", httpProxy],
    ["https_proxy", httpsProxy],
    ["all_proxy", allProxy],
    ["no_proxy", noProxy],
  ]) {
    if (value) {
      env[key] = value;
    }
  }

  return env;
}

function hasProxyEnv(proxyUrl = "") {
  return Object.keys(getProxyEnv(proxyUrl)).length > 0;
}

function getProxySource(proxyUrl = "") {
  if (proxyUrl) {
    return "page";
  }

  if (process.env.PAPERLENS_PROXY_URL) {
    return "env";
  }

  if (process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.ALL_PROXY ||
      process.env.http_proxy || process.env.https_proxy || process.env.all_proxy) {
    return "environment";
  }

  return "none";
}

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const rawValue = trimmed.slice(equalsIndex + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

function parseClaudeJsonResult(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    const match = stdout.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }

    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function formatClaudeAgentError(result, stderr, code) {
  const output = typeof result?.result === "string" ? result.result : "";

  if (output.includes("budget_exceeded") || output.includes("Budget has been exceeded")) {
    return "Kimi Code / Claude Code 预算已超限：Key 已经通过本地 Claude Code 路径认证，但当前账户预算或额度已用尽。";
  }

  if (output.includes("access_terminated_error")) {
    return "Kimi Code 拒绝访问：请确认当前调用确实通过受支持的 Coding Agent。";
  }

  return [
    `Claude Code 本地 Agent 调用失败，退出码 ${code}。`,
    output ? `输出：${output.slice(0, 800)}` : "",
    stderr ? `stderr：${stderr.slice(0, 800)}` : "",
  ].filter(Boolean).join(" ");
}

function getProviderPayloadOptions(settings) {
  if (settings.baseUrl.includes("api.deepseek.com")) {
    return {
      thinking: {
        type: "disabled",
      },
    };
  }

  return {};
}

function formatModelError(status, body) {
  const providerError = parseProviderError(body);
  const providerMessage = providerError.message;
  const providerType = providerError.type ? `，类型：${providerError.type}` : "";

  if (providerError.type === "access_terminated_error") {
    return `访问受限，HTTP ${status}：${providerMessage || "当前 Key 或模型不允许在这个调用场景使用。"} 这通常表示 Kimi Code Key 已认证成功，但官方只允许 Coding Agent 使用。`;
  }

  if (status === 402) {
    return `会员权益或额度不可用，HTTP ${status}：请检查 Kimi Code 会员状态、周用量和频限。${providerMessage ? `供应商信息：${providerMessage}${providerType}` : ""}`;
  }

  if (status === 401 || status === 403) {
    return `认证失败，HTTP ${status}：请检查 API Key 是否正确，且是否属于当前 Base URL。${providerMessage ? `供应商信息：${providerMessage}${providerType}` : ""}`;
  }

  if (status === 404) {
    return `接口或模型不存在，HTTP ${status}：请检查 Base URL 和模型名。${providerMessage ? `供应商信息：${providerMessage}${providerType}` : ""}`;
  }

  if (status === 429) {
    return `请求被限流或额度不足，HTTP ${status}：请稍后重试，或检查账户余额和限额。${providerMessage ? `供应商信息：${providerMessage}${providerType}` : ""}`;
  }

  if (status >= 500) {
    return `模型服务暂时不可用，HTTP ${status}。${providerMessage ? `供应商信息：${providerMessage}${providerType}` : ""}`;
  }

  return `模型请求失败，HTTP ${status}。${providerMessage ? `供应商信息：${providerMessage}${providerType}` : body.slice(0, 400)}`;
}

function parseProviderError(body) {
  try {
    const parsed = JSON.parse(body);
    return {
      message: parsed.error?.message || parsed.message || "",
      type: parsed.error?.type || parsed.type || "",
      code: parsed.error?.code || parsed.code || "",
    };
  } catch {
    return { message: "", type: "", code: "" };
  }
}

function normalizeSettings(settings = {}) {
  const provider = String(settings.provider || "").trim();
  const apiKey = String(settings.apiKey || "").trim();
  const model = normalizeModelName(String(settings.model || "").trim());
  const baseUrl = resolveBaseUrlForProvider(provider, String(settings.baseUrl || "https://api.openai.com/v1").trim());
  const agentBudgetUsd = Number(settings.agentBudgetUsd || 500);
  const normalizedApiKey = normalizeApiKey(apiKey);
  const proxyUrl = normalizeProxyUrl(String(settings.proxyUrl || ""));

  if (!apiKey && baseUrl !== "local:claude-config") {
    throw badRequest("API Key is required.");
  }

  if (baseUrl === "local:claude-kimi" && !normalizedApiKey.startsWith("sk-kimi-")) {
    throw badRequest("Kimi Code Key 格式不对：Claude Code + Kimi Code Key 需要输入以 sk-kimi- 开头的完整 Key。请不要复制控制台列表里的脱敏显示值。");
  }

  if (!model) {
    throw badRequest("Model name is required.");
  }

  return { provider, apiKey: normalizedApiKey, model, baseUrl, agentBudgetUsd, proxyUrl };
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function normalizeModelName(model) {
  const compact = model.toLowerCase().replace(/[\s_.-]+/g, "");
  const aliases = new Map([
    ["kimi26", "kimi-k2.6"],
    ["kimik26", "kimi-k2.6"],
    ["k26", "kimi-k2.6"],
  ]);

  return aliases.get(compact) || model;
}

function normalizeApiKey(apiKey) {
  const withoutBearer = apiKey
    .replace(/^bearer\s+/i, "")
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, "")
    .replace(/[，,。.;；\s]+$/g, "")
    .trim();
  const match = withoutBearer.match(/(sk-[A-Za-z0-9._-]+)/);

  return match?.[1] || withoutBearer;
}

function normalizeProxyUrl(proxyUrl) {
  const clean = String(proxyUrl || "").trim();
  if (!clean) {
    return "";
  }

  if (!/^(https?|socks5h?|socks):\/\//i.test(clean)) {
    throw badRequest("Proxy URL 格式不对：请填写 http://、https:// 或 socks5:// 开头的代理地址。");
  }

  return clean;
}

function getSettingsDiagnostics(settings = {}) {
  const provider = String(settings.provider || "").trim();
  const baseUrl = resolveBaseUrlForProvider(provider, String(settings.baseUrl || "https://api.openai.com/v1").trim());
  const model = normalizeModelName(String(settings.model || "").trim());
  const apiKey = normalizeApiKey(String(settings.apiKey || ""));
  let proxyUrl = "";
  try {
    proxyUrl = normalizeProxyUrl(String(settings.proxyUrl || ""));
  } catch {
    proxyUrl = String(settings.proxyUrl || "").trim();
  }
  const keyPrefix = apiKey.startsWith("sk-kimi-")
    ? "sk-kimi"
    : apiKey.startsWith("sk-")
      ? "sk"
      : apiKey ? "unknown" : "missing";
  const isClaudeProvider = baseUrl === "local:claude-kimi" || baseUrl === "local:claude-config";
  const commandPath = isClaudeProvider ? buildCommandPath() : "";

  return {
    provider,
    endpoint: baseUrl === "local:claude-kimi"
      ? "local claude CLI + page Kimi key -> https://api.kimi.com/coding/"
      : baseUrl === "local:claude-config"
        ? "local claude CLI configured auth"
      : getChatCompletionsEndpoint(baseUrl),
    model,
    keyPresent: Boolean(apiKey),
    keyPrefix,
    keyLength: apiKey.length,
    keyFormatOk: baseUrl !== "local:claude-kimi" || apiKey.startsWith("sk-kimi-"),
    claudeCommand: isClaudeProvider ? resolveClaudeCommand(commandPath) : "",
    proxyPresent: isClaudeProvider ? hasProxyEnv(proxyUrl) : false,
    proxySource: isClaudeProvider ? getProxySource(proxyUrl) : "none",
  };
}

function resolveBaseUrlForProvider(provider, baseUrl) {
  if (provider === "claude-kimi-agent") {
    return "local:claude-kimi";
  }

  if (provider === "claude-local") {
    return "local:claude-config";
  }

  return baseUrl;
}

function getChatCompletionsEndpoint(baseUrl) {
  const clean = baseUrl.replace(/\/+$/, "");
  if (clean.endsWith("/chat/completions")) {
    return clean;
  }

  return `${clean}/chat/completions`;
}

function parseModelJson(content) {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) {
      return {};
    }

    try {
      return JSON.parse(match[0]);
    } catch {
      return {};
    }
  }
}

async function readRequestBuffer(req, maxBytes = 10 * 1024 * 1024) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error("Request body is too large.");
    }

    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

async function readJson(req) {
  const body = await readRequestBuffer(req);
  if (!body.length) {
    return {};
  }

  return JSON.parse(body.toString("utf8"));
}

function parseMultipart(body, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const headerBreak = Buffer.from("\r\n\r\n");
  const parts = [];
  let position = body.indexOf(delimiter);

  while (position !== -1) {
    let partStart = position + delimiter.length;

    if (body[partStart] === 45 && body[partStart + 1] === 45) {
      break;
    }

    if (body[partStart] === 13 && body[partStart + 1] === 10) {
      partStart += 2;
    }

    const headerEnd = body.indexOf(headerBreak, partStart);
    if (headerEnd === -1) {
      break;
    }

    const contentStart = headerEnd + headerBreak.length;
    const nextBoundary = body.indexOf(delimiter, contentStart);
    if (nextBoundary === -1) {
      break;
    }

    let contentEnd = nextBoundary;
    if (body[contentEnd - 2] === 13 && body[contentEnd - 1] === 10) {
      contentEnd -= 2;
    }

    const headers = body.slice(partStart, headerEnd).toString("utf8");
    const disposition = headers.match(/content-disposition:\s*form-data;([^\r\n]+)/i)?.[1] || "";
    const name = disposition.match(/name="([^"]+)"/)?.[1] || "";
    const filename = disposition.match(/filename="([^"]*)"/)?.[1] || "";

    parts.push({
      name,
      filename,
      headers,
      content: body.slice(contentStart, contentEnd),
    });

    position = nextBoundary;
  }

  return parts;
}

async function loadPaper(paperId) {
  const paperPath = getPaperPath(paperId);
  const paper = JSON.parse(await readFile(paperPath, "utf8"));
  if (upgradePaperArtifacts(paper)) {
    await savePaper(paper);
  }
  return paper;
}

function upgradePaperArtifacts(paper) {
  const needsUpgrade = (paper.pageArtifacts || [])
    .some((artifact) => artifact.type === "caption" && artifact.cropVersion !== ARTIFACT_CROP_VERSION);
  if (!needsUpgrade || !Array.isArray(paper.extractionPages) || !paper.extractionPages.length) {
    return false;
  }

  const pages = paper.extractionPages.map((page) => {
    const pageImage = (paper.pageImages || []).find((item) => item.pageNumber === page.pageNumber);
    const size = inferStoredPageSize(paper, page);
    return {
      ...page,
      width: page.width || size.width,
      height: page.height || size.height,
      imagePath: pageImage?.imagePath || null,
      imageWidth: pageImage?.imageWidth || null,
      imageHeight: pageImage?.imageHeight || null,
    };
  });

  paper.pageArtifacts = extractPageArtifacts(pages);
  attachParagraphArtifactLinks(paper);
  return true;
}

function inferStoredPageSize(paper, page) {
  const artifact = (paper.pageArtifacts || [])
    .find((item) => item.pageNumber === page.pageNumber && item.pageWidth && item.pageHeight);
  if (artifact) {
    return {
      width: artifact.pageWidth,
      height: artifact.pageHeight,
    };
  }

  const boxes = (page.blocks || []).map(pickBlockBox).filter(Boolean);
  if (boxes.length) {
    return {
      width: Math.max(612, Math.max(...boxes.map((box) => box.x + box.width)) + 40),
      height: Math.max(792, Math.max(...boxes.map((box) => box.y + box.height)) + 40),
    };
  }

  return { width: 612, height: 792 };
}

async function savePaper(paper) {
  paper.updatedAt = new Date().toISOString();
  await writeFile(getPaperPath(paper.id), JSON.stringify(paper, null, 2));
}

function getPaperPath(paperId) {
  if (!/^paper_\d+_[a-f0-9-]+$/.test(paperId)) {
    throw new Error("Invalid paper id.");
  }

  return path.join(DATA_DIR, `${paperId}.json`);
}

async function serveStatic(res, filePath) {
  const normalized = path.normalize(filePath);
  if (!normalized.startsWith(PUBLIC_DIR) && normalized !== path.join(PUBLIC_DIR, "index.html")) {
    return json(res, { error: "Forbidden" }, 403);
  }

  try {
    const fileStat = await stat(normalized);
    if (!fileStat.isFile()) {
      return json(res, { error: "Not found" }, 404);
    }

    const data = await readFile(normalized);
    res.writeHead(200, {
      "content-type": getContentType(normalized),
      "cache-control": "no-store",
    });
    res.end(data);
  } catch {
    return json(res, { error: "Not found" }, 404);
  }
}

async function serveAsset(res, pathname) {
  let relativePath = "";
  try {
    relativePath = decodeURIComponent(pathname.replace(/^\/assets\/?/, ""));
  } catch {
    return json(res, { error: "Invalid asset path." }, 400);
  }

  if (!relativePath || relativePath.includes("\0")) {
    return json(res, { error: "Invalid asset path." }, 400);
  }

  const normalized = path.normalize(path.join(ASSET_DIR, relativePath));
  if (!normalized.startsWith(`${ASSET_DIR}${path.sep}`)) {
    return json(res, { error: "Forbidden" }, 403);
  }

  try {
    const fileStat = await stat(normalized);
    if (!fileStat.isFile()) {
      return json(res, { error: "Not found" }, 404);
    }

    const data = await readFile(normalized);
    res.writeHead(200, {
      "content-type": getContentType(normalized),
      "cache-control": "public, max-age=604800, immutable",
    });
    res.end(data);
  } catch {
    return json(res, { error: "Not found" }, 404);
  }
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
  };

  return types[ext] || "application/octet-stream";
}

function json(res, payload, status = 200) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(payload));
}
