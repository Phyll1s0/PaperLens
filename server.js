import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { execFile, spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, unlink, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import {
  clampAdaptiveBatchSize,
  nextAdaptiveBatchSizeAfterSplit,
} from "./lib/analysis-batching.js";
import {
  approximateTokenCount as estimateApproximateTokenCount,
  buildAnalysisResourceEstimate as buildAnalysisResourceEstimatePayload,
  estimateAnalysisBudget,
  isTaskBudgetExceeded,
  normalizeTaskBudgetUsd,
} from "./lib/analysis-budget.js";
import {
  isLikelyCaptionBlockText,
  isLikelyCodeBlockText,
  isLikelyFormulaBlockText,
  isLikelyTableBodyBlockText,
  isUsefulFormulaArtifactText,
} from "./lib/artifact-classifier.js";
import {
  buildPaperExportQa as buildPaperExportQaReport,
} from "./lib/export-qa.js";
import {
  buildPaperSegmentationDebugReport,
} from "./lib/segmentation-debug.js";
import {
  buildHeuristicPaperMemory,
  buildPaperMemoryScanInput,
  formatPaperMemoryForPrompt,
  normalizePaperMemory,
} from "./lib/paper-memory.js";
import {
  enrichPaperParagraphLocations,
} from "./lib/paragraph-location.js";
import {
  rescueReadableSegmentsFromMixedBlock,
} from "./lib/segmentation-block-rescue.js";
import {
  buildSegmentationPageText as buildSegmentationPageInputText,
  extractTextBlocks as extractSegmentationTextBlocks,
  getReadablePageBlocks as getSegmentationReadablePageBlocks,
  normalizeReadableBlockText as normalizeSegmentationReadableBlockText,
} from "./lib/segmentation-page-input.js";
import {
  buildPaperDocxExport,
} from "./lib/export-docx.js";
import {
  buildPaperMarkdownExport,
} from "./lib/export-markdown.js";
import {
  buildModelDiagnosticReport as buildModelDiagnosticReportPayload,
  redactProxyUrl,
} from "./lib/model-diagnostics.js";
import {
  KIMI_CODE_ANTHROPIC_ENDPOINT,
  buildKimiCodeAnthropicHeaders,
  buildKimiCodeAnthropicRequestBody,
  extractAnthropicTextContent,
} from "./lib/kimi-code-direct.js";
import {
  isActiveJobStatus,
  normalizeLoadedJobItemStatus,
  normalizeLoadedJobStatus,
  recoverInterruptedJobsForRuntime,
} from "./lib/job-recovery.js";
import {
  buildOpenAiCompatibleProviderRequest,
  extractChatCompletionTextContent,
  formatModelError,
  getChatCompletionsEndpoint,
} from "./lib/openai-compatible-provider.js";
import {
  extractPdfText,
} from "./lib/pdf-extraction.js";
import {
  isLikelyBibliographyEntryText,
  isLikelyFrontMatterTitleText,
  isLikelyPageNumberOrRunningHeaderText,
  isLikelyPublicationMetadataText,
  isLikelyPdfExtractionGarbageText,
  isLikelyReferencesHeadingBlock,
  isReferencesSectionTitleText,
  shouldMergeSegmentedText,
  startsLikeTextContinuation,
  stripPublicationMetadataFragments,
} from "./lib/segmentation-repair.js";
import {
  auditSegmentedParagraphNoise as auditSegmentedNoise,
  validateAndRepairSegmentedParagraphs as repairSegmentedParagraphs,
} from "./lib/segmentation-validation.js";
import {
  inferHeuristicStructureSectionsFromPages,
} from "./lib/segmentation-structure.js";
import {
  buildCropQuality,
  buildManualVisualCropUpdate,
  normalizeVisualCrop as normalizeCrop,
} from "./lib/visual-crop-quality.js";
import {
  ARTIFACT_CROP_VERSION as VISUAL_ARTIFACT_CROP_VERSION,
  VISUAL_STRUCTURE_VERSION as VISUAL_ARTIFACT_STRUCTURE_VERSION,
  buildArtifactCropSvg as buildVisualArtifactCropSvg,
  enhancePagesWithVisualStructure as enhancePagesWithVisualArtifacts,
  extractPageArtifacts as extractVisualPageArtifacts,
} from "./lib/visual-artifacts.js";
import {
  applyManualArtifactOverrides,
  buildVisualRebuildStats,
  collectManualArtifactOverrides,
} from "./lib/visual-rebuild-summary.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_VERSION = readPackageVersion();
const SERVICE_SCHEMA_VERSION = 2;
const SERVICE_STARTED_AT_MS = Date.now();

loadDotEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const ACCESS_TOKEN = process.env.PAPERLENS_ACCESS_TOKEN || process.env.PAPERLENS_AUTH_TOKEN || "";
const AUTH_REQUIRED = Boolean(ACCESS_TOKEN);
const AUTH_COOKIE_NAME = "paperlens_access";
const AUTH_COOKIE_MAX_AGE_SECONDS = readIntegerEnv("PAPERLENS_AUTH_COOKIE_MAX_AGE_DAYS", 14, 1, 90) * 86400;
const SECRET_ENCRYPTION_KEY = process.env.PAPERLENS_SECRET_KEY || ACCESS_TOKEN;
const PDF_ENGINE = process.env.PAPERLENS_PDF_ENGINE || "auto";
const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const DATA_DIR = path.join(__dirname, "data");
const DATA_BACKUP_DIR = path.join(DATA_DIR, ".backups");
const ASSET_DIR = path.join(__dirname, "paper-assets");
const CACHE_DIR = path.join(__dirname, ".cache");
const JOBS_PATH = path.join(DATA_DIR, "jobs.json");
const SECRETS_PATH = path.join(DATA_DIR, "secrets.json");
const JOB_WORKER_LOCK_DIR = path.join(CACHE_DIR, "job-worker.lock");
const SERVICE_STATIC_ASSET_PATHS = [
  path.join(PUBLIC_DIR, "index.html"),
  path.join(PUBLIC_DIR, "app.js"),
  path.join(PUBLIC_DIR, "styles.css"),
];
const WORKSPACE_CACHE_KEY = createHash("sha1").update(__dirname).digest("hex").slice(0, 12);
const SWIFT_MODULE_CACHE_DIR = path.join(CACHE_DIR, `swift-module-cache-${WORKSPACE_CACHE_KEY}`);
const TMP_DIR = path.join(CACHE_DIR, "tmp");
const MAX_UPLOAD_BYTES = 120 * 1024 * 1024;
const JSON_BACKUP_RETENTION = readIntegerEnv("PAPERLENS_JSON_BACKUP_RETENTION", 8, 0, 50);
const JSON_BACKUP_MIN_INTERVAL_MS = readIntegerEnv("PAPERLENS_JSON_BACKUP_MIN_INTERVAL_SECONDS", 300, 0, 86_400) * 1000;
const MAX_ANALYSIS_JOB_PARAGRAPHS = readIntegerEnv("PAPERLENS_MAX_ANALYSIS_JOB_PARAGRAPHS", 420, 0, 5000);
const MAX_ANALYSIS_JOB_CHARS = readIntegerEnv("PAPERLENS_MAX_ANALYSIS_JOB_CHARS", 360_000, 0, 5_000_000);
const MAX_AI_SEGMENTATION_PAGES = readIntegerEnv("PAPERLENS_MAX_AI_SEGMENTATION_PAGES", 80, 0, 1000);
const MAX_OCR_JOB_PAGES = readIntegerEnv("PAPERLENS_MAX_OCR_JOB_PAGES", 120, 0, 1000);
const MAX_VISUAL_REBUILD_PAPERS = readIntegerEnv("PAPERLENS_MAX_VISUAL_REBUILD_PAPERS", 80, 0, 5000);
const MAX_VISUAL_REBUILD_PAGES = readIntegerEnv("PAPERLENS_MAX_VISUAL_REBUILD_PAGES", 1200, 0, 20_000);
const OCR_LANGUAGE = process.env.PAPERLENS_OCR_LANGUAGE || process.env.PAPERLENS_OCR_LANG || "eng";
const OCR_TIMEOUT_MS = readIntegerEnv("PAPERLENS_OCR_TIMEOUT_SECONDS", 1800, 60, 7200) * 1000;
const ARTIFACT_CROP_VERSION = VISUAL_ARTIFACT_CROP_VERSION;
const VISUAL_STRUCTURE_VERSION = VISUAL_ARTIFACT_STRUCTURE_VERSION;
const SEGMENTATION_AUDIT_VERSION = 1;
const JOB_ITEM_MAX_ATTEMPTS = 2;
const JOB_POLL_LIMIT = 20;
const ANALYSIS_BATCH_SIZE = readIntegerEnv("PAPERLENS_ANALYSIS_BATCH_SIZE", 12, 1, 24);
const CLAUDE_AGENT_ANALYSIS_BATCH_SIZE = readIntegerEnv("PAPERLENS_AGENT_ANALYSIS_BATCH_SIZE", 8, 1, 20);
const ANALYSIS_CONCURRENCY = readIntegerEnv("PAPERLENS_ANALYSIS_CONCURRENCY", 3, 1, 6);
const CLAUDE_AGENT_ANALYSIS_CONCURRENCY = readIntegerEnv("PAPERLENS_AGENT_ANALYSIS_CONCURRENCY", 2, 1, 3);
const ANALYSIS_FAILED_RETRY_BATCH_SIZE = readIntegerEnv("PAPERLENS_ANALYSIS_FAILED_RETRY_BATCH_SIZE", 2, 1, 8);
const ANALYSIS_TARGET_MINUTES = readIntegerEnv("PAPERLENS_ANALYSIS_TARGET_MINUTES", 20, 5, 240);
const KIMI_CODE_USE_CLAUDE_CLI = /^(1|true|yes|on)$/i
  .test(String(process.env.PAPERLENS_KIMI_CODE_USE_CLAUDE_CLI || ""));
const KIMI_CODE_DIRECT_MAX_TOKENS = readIntegerEnv("PAPERLENS_KIMI_CODE_MAX_TOKENS", 12_000, 1024, 64_000);
const ANALYSIS_CACHE_VERSION = 1;
const ANALYSIS_CACHE_MAX_ENTRIES = 800;
const ANALYSIS_CONTEXT_TEXT_LIMIT = 900;
const ANALYSIS_CONTEXT_TOTAL_LIMIT = 5200;
const BATCH_ANALYSIS_CONTEXT_LIMIT = 1100;
const BATCH_GLOBAL_CONTEXT_LIMIT = 900;
const MAX_BATCH_SPLIT_DEPTH = 4;
const SEGMENTATION_CONTEXT_TEXT_LIMIT = 1600;
const SEGMENTATION_STRUCTURE_INPUT_LIMIT = 28_000;
const CLAUDE_SEGMENTATION_STRUCTURE_INPUT_LIMIT = 14_000;
const CLAUDE_SEGMENTATION_STRUCTURE_SCAN = /^(1|true|yes|on)$/i
  .test(String(process.env.PAPERLENS_CLAUDE_SEGMENTATION_STRUCTURE_SCAN || ""));
const CLAUDE_AGENT_AI_SEGMENTATION = /^(1|true|yes|on)$/i
  .test(String(process.env.PAPERLENS_CLAUDE_AGENT_AI_SEGMENTATION || ""));
const SEGMENTATION_STRUCTURE_PAGE_LIMIT = 1800;
const SEGMENTATION_STRUCTURE_TIMEOUT_MS = readIntegerEnv("PAPERLENS_SEGMENTATION_STRUCTURE_TIMEOUT_SECONDS", 300, 60, 1800) * 1000;
const SEGMENTATION_CHUNK_TIMEOUT_MS = readIntegerEnv("PAPERLENS_SEGMENTATION_CHUNK_TIMEOUT_SECONDS", 240, 60, 1200) * 1000;
const CLAUDE_SEGMENTATION_CHUNK_TIMEOUT_MS = readIntegerEnv("PAPERLENS_CLAUDE_SEGMENTATION_CHUNK_TIMEOUT_SECONDS", 90, 30, 600) * 1000;
const CLAUDE_SEGMENTATION_CHUNK_MAX_PAGES = readIntegerEnv("PAPERLENS_CLAUDE_SEGMENTATION_CHUNK_MAX_PAGES", 1, 1, 3);
const CLAUDE_SEGMENTATION_CHUNK_MAX_CHARS = readIntegerEnv("PAPERLENS_CLAUDE_SEGMENTATION_CHUNK_MAX_CHARS", 4200, 1800, 12000);
const PAPER_MEMORY_INPUT_LIMIT = readIntegerEnv("PAPERLENS_PAPER_MEMORY_INPUT_CHARS", 36_000, 8_000, 120_000);
const PAPER_MEMORY_CHUNK_TIMEOUT_MS = readIntegerEnv("PAPERLENS_PAPER_MEMORY_CHUNK_TIMEOUT_SECONDS", 210, 60, 1200) * 1000;
const PAPER_MEMORY_SYNTHESIS_TIMEOUT_MS = readIntegerEnv("PAPERLENS_PAPER_MEMORY_SYNTHESIS_TIMEOUT_SECONDS", 210, 60, 1200) * 1000;
const SEGMENTATION_ITEM_TEXT_LIMIT = 900;
const SECTION_CONTEXT_TEXT_LIMIT = 900;
const SEGMENTATION_PLAN_VERSION = 1;
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
await mkdir(DATA_BACKUP_DIR, { recursive: true });
await mkdir(ASSET_DIR, { recursive: true });
await mkdir(SWIFT_MODULE_CACHE_DIR, { recursive: true });
await mkdir(TMP_DIR, { recursive: true });

const jobStore = {
  jobs: new Map(),
  activeJobId: null,
  controllers: new Map(),
  workerScheduled: false,
  savePromise: Promise.resolve(),
  syncPromise: null,
};
const secretStore = {
  keys: new Map(),
  savePromise: Promise.resolve(),
};
const paperWriteLocks = new Map();
const pagePixelCache = new Map();

await loadSecrets();
await loadJobs();
await recoverInterruptedJobs();
scheduleJobWorker();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/") {
      return serveStatic(res, path.join(PUBLIC_DIR, "index.html"));
    }

    if (req.method === "GET" && url.pathname === "/api/auth/status") {
      return json(res, buildAuthStatus(req));
    }

    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      return await handleAuthLogin(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      return handleAuthLogout(req, res);
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      return json(res, await buildHealthPayload(req));
    }

    if (req.method === "GET" && url.pathname.startsWith("/public/")) {
      return serveStatic(res, path.join(__dirname, url.pathname));
    }

    if (!isAuthorizedRequest(req, url.pathname)) {
      return json(res, {
        error: "需要访问令牌。请先登录 PaperLens。",
        authRequired: AUTH_REQUIRED,
        authenticated: false,
      }, 401);
    }

    if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
      return serveAsset(res, url.pathname);
    }

    if (req.method === "POST" && url.pathname === "/api/papers/upload") {
      return await handleUpload(req, res);
    }

    if (req.method === "GET" && url.pathname === "/api/papers") {
      return json(res, await listPapers(url.searchParams));
    }

    if (req.method === "POST" && url.pathname === "/api/papers/visual-artifacts/rebuild") {
      return await handleRebuildAllVisualArtifacts(res);
    }

    const exportQaMatch = url.pathname.match(/^\/api\/papers\/([^/]+)\/export-qa$/);
    if (req.method === "GET" && exportQaMatch) {
      return await handleExportPaperQa(res, exportQaMatch[1]);
    }

    const segmentationDebugMatch = url.pathname.match(/^\/api\/papers\/([^/]+)\/segmentation-debug$/);
    if (req.method === "GET" && segmentationDebugMatch) {
      return await handlePaperSegmentationDebug(res, segmentationDebugMatch[1]);
    }

    const exportMatch = url.pathname.match(/^\/api\/papers\/([^/]+)\/export\.md$/);
    if (req.method === "GET" && exportMatch) {
      return await handleExportPaperMarkdown(req, res, exportMatch[1]);
    }

    const exportDocxMatch = url.pathname.match(/^\/api\/papers\/([^/]+)\/export\.docx$/);
    if (req.method === "GET" && exportDocxMatch) {
      return await handleExportPaperDocx(res, exportDocxMatch[1]);
    }

    const artifactEditMatch = url.pathname.match(/^\/api\/papers\/([^/]+)\/artifacts\/([^/]+)\/edit$/);
    if (req.method === "POST" && artifactEditMatch) {
      return await handleEditPaperArtifact(req, res, artifactEditMatch[1], artifactEditMatch[2]);
    }

    const artifactCropMatch = url.pathname.match(/^\/api\/papers\/([^/]+)\/artifacts\/([^/]+)\/crop\.svg$/);
    if (req.method === "GET" && artifactCropMatch) {
      return await handleArtifactCropSvg(req, res, artifactCropMatch[1], artifactCropMatch[2]);
    }

    const visualRebuildMatch = url.pathname.match(/^\/api\/papers\/([^/]+)\/visual-artifacts\/rebuild$/);
    if (req.method === "POST" && visualRebuildMatch) {
      return await handleRebuildVisualArtifacts(res, visualRebuildMatch[1]);
    }

    const segmentMatch = url.pathname.match(/^\/api\/papers\/([^/]+)\/segment$/);
    if (req.method === "POST" && segmentMatch) {
      return await handleSegmentPaper(req, res, segmentMatch[1]);
    }

    const segmentJobsMatch = url.pathname.match(/^\/api\/papers\/([^/]+)\/segment-jobs$/);
    if (req.method === "GET" && segmentJobsMatch) {
      return await handleListSegmentationJobs(res, segmentJobsMatch[1]);
    }

    if (req.method === "POST" && segmentJobsMatch) {
      return await handleSegmentPaper(req, res, segmentJobsMatch[1]);
    }

    const activeSegmentJobMatch = url.pathname.match(/^\/api\/papers\/([^/]+)\/segment-jobs\/active$/);
    if (req.method === "GET" && activeSegmentJobMatch) {
      return await handleGetActiveSegmentationJob(res, activeSegmentJobMatch[1]);
    }

    const paragraphEditMatch = url.pathname.match(/^\/api\/papers\/([^/]+)\/paragraphs\/([^/]+)\/edit$/);
    if (req.method === "POST" && paragraphEditMatch) {
      return await handleEditPaperParagraph(req, res, paragraphEditMatch[1], paragraphEditMatch[2]);
    }

    const analysisJobsMatch = url.pathname.match(/^\/api\/papers\/([^/]+)\/analysis-jobs$/);
    if (req.method === "GET" && analysisJobsMatch) {
      return await handleListAnalysisJobs(res, analysisJobsMatch[1]);
    }

    if (req.method === "POST" && analysisJobsMatch) {
      return await handleCreateAnalysisJob(req, res, analysisJobsMatch[1]);
    }

    const activeAnalysisJobMatch = url.pathname.match(/^\/api\/papers\/([^/]+)\/analysis-jobs\/active$/);
    if (req.method === "GET" && activeAnalysisJobMatch) {
      return await handleGetActiveAnalysisJob(res, activeAnalysisJobMatch[1]);
    }

    const ocrJobsMatch = url.pathname.match(/^\/api\/papers\/([^/]+)\/ocr-jobs$/);
    if (req.method === "GET" && ocrJobsMatch) {
      return await handleListOcrJobs(res, ocrJobsMatch[1]);
    }

    if (req.method === "POST" && ocrJobsMatch) {
      return await handleCreateOcrJob(res, ocrJobsMatch[1]);
    }

    const activeOcrJobMatch = url.pathname.match(/^\/api\/papers\/([^/]+)\/ocr-jobs\/active$/);
    if (req.method === "GET" && activeOcrJobMatch) {
      return await handleGetActiveOcrJob(res, activeOcrJobMatch[1]);
    }

    const paperMatch = url.pathname.match(/^\/api\/papers\/([^/]+)$/);
    if (req.method === "GET" && paperMatch) {
      return json(res, await loadPaper(paperMatch[1]));
    }

    if (req.method === "PATCH" && paperMatch) {
      return await handleUpdatePaperMetadata(req, res, paperMatch[1]);
    }

    const jobCancelMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/cancel$/);
    if (req.method === "POST" && jobCancelMatch) {
      return await handleCancelJob(res, jobCancelMatch[1]);
    }

    const jobRetryFailedMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/retry-failed$/);
    if (req.method === "POST" && jobRetryFailedMatch) {
      return await handleRetryFailedJob(res, jobRetryFailedMatch[1]);
    }

    const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (req.method === "GET" && jobMatch) {
      return await handleGetJob(res, jobMatch[1]);
    }

    if (req.method === "POST" && url.pathname === "/api/analyze") {
      return await handleAnalyze(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/model/ping") {
      return await handleModelPing(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/model/diagnostics") {
      return await handleModelDiagnostics(req, res);
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
    const payload = { error: error.message || "Internal server error" };
    if (error.resourceLimit) {
      payload.resourceLimit = error.resourceLimit;
    }
    return json(res, payload, error.statusCode || 500);
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

  const extraction = await extractPdfText(pdfPath, assetDir, `/assets/${paperId}`, {
    pdfEngine: PDF_ENGINE,
    rootDir: __dirname,
    swiftModuleCacheDir: SWIFT_MODULE_CACHE_DIR,
    tmpDir: TMP_DIR,
  });
  const paper = buildPaperRecord({
    id: paperId,
    filename: filePart.filename,
    pdfPath,
    extraction,
  });

  if (!getReadingParagraphs(paper).length) {
    markPaperNeedsOcr(paper);
  }

  await savePaper(paper);
  return json(res, paper);
}

async function handleExportPaperMarkdown(req, res, paperId) {
  const paper = await loadPaper(paperId);
  const markdown = buildPaperMarkdownExport(paper, getRequestBaseUrl(req), {
    isReadingParagraphForPaper,
    getVisiblePaperArtifacts,
  });
  const filename = `${sanitizeDownloadFilename(paper.title || paper.filename || paper.id)}.md`;
  await recordPaperExport(paper, "markdown", filename);

  res.writeHead(200, {
    "content-type": "text/markdown; charset=utf-8",
    "content-disposition": `attachment; filename="${filename}"`,
    "cache-control": "no-store",
  });
  res.end(markdown);
}

async function handleExportPaperDocx(res, paperId) {
  const paper = await loadPaper(paperId);
  const docx = await buildPaperDocxExport(paper, {
    isReadingParagraphForPaper,
    getVisiblePaperArtifacts,
    readArtifactAsset: async (imagePath) => {
      const filePath = getAssetPathFromPublicPath(imagePath);
      if (!filePath) {
        return null;
      }

      const data = await readFile(filePath).catch(() => null);
      return data ? { data, ext: path.extname(filePath) || ".png" } : null;
    },
  });
  const filename = `${sanitizeDownloadFilename(paper.title || paper.filename || paper.id)}.docx`;
  await recordPaperExport(paper, "docx", filename);

  res.writeHead(200, {
    "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "content-disposition": `attachment; filename="${filename}"`,
    "cache-control": "no-store",
  });
  res.end(docx);
}

async function handleExportPaperQa(res, paperId) {
  const paper = await loadPaper(paperId);
  return json(res, buildPaperExportQaReport(paper, {
    isReadingParagraphForPaper,
    isVisiblePaperArtifact,
    isPaperOcrRequired,
    artifactAssetExists: (artifact) => {
      const assetPath = getAssetPathFromPublicPath(artifact.imagePath);
      return Boolean(assetPath && existsSync(assetPath));
    },
  }));
}

async function handlePaperSegmentationDebug(res, paperId) {
  const paper = await loadPaper(paperId);
  return json(res, buildPaperSegmentationDebugReport(paper));
}

async function handleUpdatePaperMetadata(req, res, paperId) {
  const payload = await readJson(req);
  const paper = await loadPaper(paperId);

  if (Object.prototype.hasOwnProperty.call(payload, "favorite")) {
    paper.favorite = Boolean(payload.favorite);
  }

  if (Object.prototype.hasOwnProperty.call(payload, "tags")) {
    paper.tags = normalizePaperTags(payload.tags);
  }

  if (Object.prototype.hasOwnProperty.call(payload, "readingProgress")) {
    paper.readingProgress = normalizeReadingProgress(payload.readingProgress, paper);
    paper.readingProgress.updatedAt = new Date().toISOString();
  }

  paper.updatedAt = new Date().toISOString();
  await savePaper(paper);
  return json(res, paper);
}

async function handleArtifactCropSvg(req, res, paperId, artifactId) {
  const paper = await loadPaper(paperId);
  const artifact = (paper.pageArtifacts || []).find((item) => item.id === artifactId);
  if (!artifact) {
    return json(res, { error: "Artifact not found." }, 404);
  }

  const svg = buildVisualArtifactCropSvg(artifact, getRequestBaseUrl(req));
  if (!svg) {
    return json(res, { error: "Artifact crop is not available." }, 404);
  }

  const headers = {
    "content-type": "image/svg+xml; charset=utf-8",
    "cache-control": "no-store",
  };
  const requestUrl = new URL(req.url || "/", getRequestBaseUrl(req));
  if (requestUrl.searchParams.get("download") === "1") {
    const filename = `${sanitizeDownloadFilename(artifact.label || artifact.visualType || artifact.type || artifact.id)}.svg`;
    headers["content-disposition"] = `attachment; filename="${filename}"`;
  }

  res.writeHead(200, headers);
  res.end(svg);
}

async function handleRebuildVisualArtifacts(res, paperId) {
  const paper = await loadPaper(paperId);
  enforcePageResourceLimit({
    label: "单篇视觉重建",
    pageCount: getPaperPageCount(paper),
    limit: MAX_VISUAL_REBUILD_PAGES,
    envName: "PAPERLENS_MAX_VISUAL_REBUILD_PAGES",
  });
  const result = rebuildPaperVisualArtifacts(paper, { force: true });
  if (!result.changed) {
    const status = result.reason === "missing-extraction-pages" ? 400 : 200;
    return json(res, {
      paper,
      stats: result.stats,
      message: result.reason === "missing-extraction-pages"
        ? "这篇旧论文缺少原始页面结构，无法重建视觉结构。请重新上传 PDF。"
        : "没有可重建的视觉结构。",
    }, status);
  }

  paper.updatedAt = new Date().toISOString();
  paper.maintenance = {
    ...(paper.maintenance || {}),
    visualArtifacts: {
      rebuiltAt: paper.updatedAt,
      stats: result.stats,
    },
  };
  await savePaper(paper);
  return json(res, {
    paper,
    stats: result.stats,
    message: formatVisualRebuildMessage(result.stats),
  });
}

async function handleRebuildAllVisualArtifacts(res) {
  const files = await readdir(DATA_DIR).catch(() => []);
  const summary = {
    papers: 0,
    rebuilt: 0,
    skipped: 0,
    failed: 0,
    resourceLimited: 0,
    pages: 0,
    scannedPages: 0,
    artifacts: 0,
    pixelRefined: 0,
    lowConfidence: 0,
    resourceLimits: getResourceLimitsStatus().visualRebuild,
  };
  const results = [];
  const budget = {
    papers: 0,
    pages: 0,
  };

  for (const file of files) {
    if (!file.endsWith(".json") || file === "jobs.json" || file === "secrets.json") {
      continue;
    }

    try {
      const raw = await readJsonFileWithRecovery(path.join(DATA_DIR, file), { optional: true });
      if (!raw?.id || !Array.isArray(raw.paragraphs)) {
        continue;
      }

      summary.papers += 1;
      const paper = await loadPaper(raw.id);
      const pageCount = getPaperPageCount(paper);
      const resourceBlock = getVisualRebuildResourceBlock(budget, pageCount);
      if (resourceBlock) {
        summary.skipped += 1;
        summary.resourceLimited += 1;
        results.push({
          id: raw.id,
          title: raw.title || raw.filename || raw.id,
          status: "skipped",
          reason: "resource-limit",
          message: resourceBlock.message,
        });
        continue;
      }
      budget.papers += 1;
      budget.pages += pageCount;
      summary.scannedPages = budget.pages;
      const result = rebuildPaperVisualArtifacts(paper, { force: true });
      if (!result.changed) {
        summary.skipped += 1;
        results.push({
          id: raw.id,
          title: raw.title || raw.filename || raw.id,
          status: "skipped",
          reason: result.reason,
          stats: result.stats,
        });
        continue;
      }

      paper.updatedAt = new Date().toISOString();
      paper.maintenance = {
        ...(paper.maintenance || {}),
        visualArtifacts: {
          rebuiltAt: paper.updatedAt,
          stats: result.stats,
        },
      };
      await savePaper(paper);
      summary.rebuilt += 1;
      summary.pages += Number(result.stats.pages || 0);
      summary.artifacts += Number(result.stats.artifacts || 0);
      summary.pixelRefined += Number(result.stats.pixelRefined || 0);
      summary.lowConfidence += Number(result.stats.lowConfidence || 0);
      results.push({
        id: paper.id,
        title: paper.title || paper.filename || paper.id,
        status: "rebuilt",
        stats: result.stats,
      });
    } catch (error) {
      summary.failed += 1;
      results.push({
        id: file.replace(/\.json$/i, ""),
        title: file,
        status: "failed",
        error: error.message || "重建失败",
      });
    }
  }

  return json(res, {
    summary,
    results,
    message: formatVisualRebuildAllMessage(summary),
  });
}

async function handleSegmentPaper(req, res, paperId) {
  const payload = await readJson(req);
  const paper = await loadPaper(paperId);
  const pages = Array.isArray(paper.extractionPages) ? paper.extractionPages : [];

  if (!pages.length) {
    return json(res, { error: "这篇论文缺少原始页面文本，无法重新 AI 分段。请重新上传 PDF。" }, 400);
  }
  const settings = await secureSettingsForJob(payload.settings || {});
  const force = Boolean(payload.force);
  const useLocalFirstSegmentation = shouldUseLocalFirstSegmentation(settings);
  if (!useLocalFirstSegmentation) {
    enforcePageResourceLimit({
      label: "AI 分段",
      pageCount: pages.length,
      limit: MAX_AI_SEGMENTATION_PAGES,
      envName: "PAPERLENS_MAX_AI_SEGMENTATION_PAGES",
    });
  }

  await syncJobsFromDisk();
  const existing = findActiveSegmentationJobForPaper(paperId);
  if (existing && !force) {
    return json(res, {
      job: serializeJob(existing),
      paper,
      settings: serializeClientSettings(existing.settings || settings),
      message: "AI 分段任务已经在运行。",
    });
  }

  if (existing && force) {
    await cancelJob(existing.id);
  }

  if (useLocalFirstSegmentation) {
    const segmented = segmentPaperLocally(paper, "claude-agent-local-first");
    await savePaper(segmented);
    return json(res, {
      job: null,
      paper: segmented,
      settings: serializeClientSettings(settings),
      message: "Claude Agent 通道较慢，已使用本地视觉分段；可以直接开始翻译讲解。",
    });
  }

  const job = createSegmentationJob({ paper, settings });
  paper.segmentationJob = buildPaperSegmentationJobStatus(job, {
    status: "queued",
    phase: "queued",
    message: "AI 分段任务已加入本机队列。",
  });
  paper.updatedAt = new Date().toISOString();
  await savePaper(paper);

  jobStore.jobs.set(job.id, job);
  await persistJobs();
  scheduleJobWorker();

  return json(res, {
    job: serializeJob(job),
    paper,
    settings: serializeClientSettings(settings),
    message: "AI 分段任务已加入本机队列。",
  });
}

async function handleListSegmentationJobs(res, paperId) {
  await syncJobsFromDisk();
  const jobs = [...jobStore.jobs.values()]
    .filter((job) => job.type === "segmentation" && job.paperId === paperId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, JOB_POLL_LIMIT)
    .map(serializeJobSummary);

  return json(res, { jobs });
}

async function handleGetActiveSegmentationJob(res, paperId) {
  await syncJobsFromDisk();
  const job = findActiveSegmentationJobForPaper(paperId);
  return json(res, { job: job ? serializeJob(job) : null });
}

async function handleEditPaperParagraph(req, res, paperId, paragraphId) {
  const payload = await readJson(req);
  const result = await withPaperWriteLock(paperId, async () => {
    const paper = await loadPaper(paperId);
    const editResult = applyPaperParagraphEdit(paper, paragraphId, payload);
    rebuildPaperAfterManualParagraphEdit(paper);
    await savePaper(paper);
    return {
      paper,
      ...editResult,
    };
  });

  return json(res, result);
}

async function handleEditPaperArtifact(req, res, paperId, artifactId) {
  const payload = await readJson(req);
  const result = await withPaperWriteLock(paperId, async () => {
    const paper = await loadPaper(paperId);
    const editResult = applyPaperArtifactEdit(paper, artifactId, payload);
    attachParagraphArtifactLinks(paper);
    await savePaper(paper);
    return {
      paper,
      ...editResult,
    };
  });

  return json(res, result);
}

function applyPaperArtifactEdit(paper, artifactId, payload = {}) {
  if (!Array.isArray(paper.pageArtifacts)) {
    throw badRequest("这篇论文没有可编辑的视觉材料。");
  }

  const artifact = paper.pageArtifacts.find((item) => item.id === artifactId);
  if (!artifact) {
    throw badRequest("找不到要编辑的视觉材料。");
  }

  const action = String(payload.action || "").trim();
  const now = new Date().toISOString();
  const previous = {
    type: artifact.type || "",
    visualType: artifact.visualType || "",
    label: artifact.label || "",
    text: artifact.text || "",
    crop: artifact.crop || null,
    cropQuality: artifact.cropQuality || null,
    hidden: Boolean(artifact.hidden),
  };
  let message = "视觉材料已更新。";

  if (action === "hide") {
    artifact.hidden = true;
    message = "已隐藏该视觉材料，后续 AI 上下文和导出会跳过它。";
  } else if (action === "restore") {
    artifact.hidden = false;
    message = "已恢复该视觉材料。";
  } else if (action === "set-type") {
    const next = normalizeManualArtifactType(payload.type, payload.visualType);
    artifact.type = next.type;
    artifact.visualType = next.visualType;
    if (Object.prototype.hasOwnProperty.call(payload, "label")) {
      artifact.label = normalizeManualArtifactLabel(payload.label);
    } else if (next.type === "formula") {
      artifact.label = extractFormulaLabel(artifact.text || "");
    }
    artifact.hidden = false;
    message = `已改为${formatManualArtifactTypeLabel(next)}。`;
  } else if (action === "set-text") {
    const nextText = normalizeManualArtifactText(payload.text);
    artifact.text = nextText;
    if (Object.prototype.hasOwnProperty.call(payload, "label")) {
      artifact.label = normalizeManualArtifactLabel(payload.label);
    } else if (artifact.type === "formula") {
      artifact.label = extractFormulaLabel(nextText);
    }
    artifact.hidden = false;
    message = "视觉材料文本已更新。";
  } else if (action === "set-label") {
    artifact.label = normalizeManualArtifactLabel(payload.label);
    message = "视觉材料标签已更新。";
  } else if (action === "set-crop") {
    const next = buildManualVisualCropUpdate(artifact, payload.crop || payload);
    if (next.error) {
      throw badRequest("裁剪区域无效：请确认 x/y/宽/高是正数，并且页面尺寸可用。");
    }
    artifact.crop = next.crop;
    artifact.cropQuality = next.cropQuality;
    artifact.cropVersion = ARTIFACT_CROP_VERSION;
    artifact.pageWidth = next.crop.pageWidth;
    artifact.pageHeight = next.crop.pageHeight;
    artifact.manualCropEditedAt = now;
    message = "裁剪区域已更新。";
  } else {
    throw badRequest("不支持的视觉材料编辑操作。");
  }

  artifact.manualEditedAt = now;
  artifact.manualArtifactOverride = {
    action,
    updatedAt: now,
    previous,
  };
  paper.maintenance = {
    ...(paper.maintenance || {}),
    artifactEdits: {
      updatedAt: now,
      lastArtifactId: artifact.id,
      count: Number(paper.maintenance?.artifactEdits?.count || 0) + 1,
    },
  };

  return { artifact, message };
}

function normalizeManualArtifactType(type, visualType = "") {
  const value = String(type || "").trim().toLowerCase();
  if (value === "figure" || value === "image") {
    return { type: "caption", visualType: "figure" };
  }
  if (value === "table") {
    return { type: "caption", visualType: "table" };
  }
  if (value === "formula") {
    return { type: "formula", visualType: "formula" };
  }
  if (value === "code") {
    return { type: "code", visualType: "code" };
  }
  if (value === "caption") {
    const normalizedVisualType = String(visualType || "").trim().toLowerCase();
    return {
      type: "caption",
      visualType: normalizedVisualType === "table" ? "table" : "figure",
    };
  }

  throw badRequest("视觉材料类型只能是图片、表格、公式或代码。");
}

function formatManualArtifactTypeLabel(artifactType) {
  if (artifactType.type === "caption" && artifactType.visualType === "table") {
    return "表格";
  }
  if (artifactType.type === "caption") {
    return "图片";
  }
  if (artifactType.type === "formula") {
    return "公式";
  }
  if (artifactType.type === "code") {
    return "代码";
  }
  return "页面材料";
}

function normalizeManualArtifactText(text) {
  const value = String(text || "").replace(/\r/g, "\n").trim();
  if (!value) {
    throw badRequest("视觉材料文本不能为空。");
  }
  if (value.length > 8000) {
    throw badRequest("视觉材料文本过长，请缩短后再保存。");
  }
  return value;
}

function normalizeManualArtifactLabel(label) {
  const value = String(label || "").replace(/\s+/g, " ").trim();
  if (value.length > 120) {
    throw badRequest("视觉材料标签过长，请控制在 120 个字符以内。");
  }
  return value;
}

function applyPaperParagraphEdit(paper, paragraphId, payload = {}) {
  if (!Array.isArray(paper.paragraphs)) {
    throw badRequest("这篇论文没有可编辑的段落。");
  }

  const action = String(payload.action || "").trim();
  const index = paper.paragraphs.findIndex((paragraph) => paragraph.id === paragraphId);
  if (index < 0) {
    throw badRequest("找不到要编辑的段落。");
  }

  const paragraph = paper.paragraphs[index];
  if (paragraph.kind !== "paragraph") {
    throw badRequest("只能编辑正文段落。");
  }

  const now = new Date().toISOString();
  const changedParagraphIds = new Set([paragraph.id]);
  let message = "分段已更新，变动段落已标记为待补跑。";

  if (action === "mark-noise") {
    markManualParagraphEdit(paragraph, "mark-noise", now);
    paragraph.manualSegmentationOverride = "noise";
    paragraph.analysisEligible = false;
    paragraph.segmentationNoise = {
      version: SEGMENTATION_AUDIT_VERSION,
      action: "skip-analysis",
      confidence: "manual",
      reasons: ["manual"],
      updatedAt: now,
    };
    resetParagraphAnalysis(paragraph);
    message = "已隐藏该段落，后续自动讲解会跳过它。";
  } else if (action === "restore") {
    markManualParagraphEdit(paragraph, "restore", now);
    paragraph.manualSegmentationOverride = "reading";
    paragraph.analysisEligible = true;
    delete paragraph.segmentationNoise;
    resetParagraphAnalysis(paragraph);
    message = "已恢复该段落，并标记为待补跑。";
  } else if (action === "merge-next") {
    const nextIndex = findNextManualEditableParagraphIndex(paper.paragraphs, index);
    if (nextIndex < 0) {
      throw badRequest("当前段落后面没有可合并的正文段落。");
    }

    const next = paper.paragraphs[nextIndex];
    mergeManualParagraphs(paragraph, next);
    markManualParagraphEdit(paragraph, "merge-next", now, { mergedParagraphId: next.id });
    paragraph.manualSegmentationOverride = "reading";
    paragraph.analysisEligible = true;
    delete paragraph.segmentationNoise;
    resetParagraphAnalysis(paragraph);
    paper.paragraphs.splice(nextIndex, 1);
    changedParagraphIds.add(next.id);
    message = "已合并下一段，合并后的段落已标记为待补跑。";
  } else if (action === "split") {
    const firstText = normalizeParagraph(payload.firstText || "");
    const secondText = normalizeParagraph(payload.secondText || "");
    if (!firstText || !secondText) {
      throw badRequest("拆分失败：两段都需要有内容。");
    }

    const splitParagraph = createManualSplitParagraph(paragraph, secondText, now);
    paragraph.sourceText = firstText;
    paragraph.rawSourceText = firstText;
    paragraph.continuesToNext = true;
    paragraph.manualSegmentationOverride = "reading";
    paragraph.analysisEligible = true;
    delete paragraph.segmentationNoise;
    markManualParagraphEdit(paragraph, "split-first", now, { splitParagraphId: splitParagraph.id });
    resetParagraphAnalysis(paragraph);
    paper.paragraphs.splice(index + 1, 0, splitParagraph);
    changedParagraphIds.add(splitParagraph.id);
    message = "已拆成两段，这两段已标记为待补跑。";
  } else if (action === "set-section") {
    const sectionTitle = normalizeSectionTitleHint(payload.sectionTitle || "");
    if (!sectionTitle) {
      throw badRequest("改章节失败：章节名不能为空。");
    }

    paragraph.sectionTitleHint = sectionTitle;
    paragraph.plannedSectionId = "";
    paragraph.manualSegmentationOverride = "reading";
    paragraph.analysisEligible = true;
    delete paragraph.segmentationNoise;
    markManualParagraphEdit(paragraph, "set-section", now, { sectionTitle });
    resetParagraphAnalysis(paragraph);
    message = "已更新段落章节，并标记该段为待补跑。";
  } else {
    throw badRequest("不支持的段落编辑动作。");
  }

  normalizePaperParagraphOrders(paper.paragraphs);
  paper.manualSegmentationEdits = [
    {
      action,
      paragraphId: paragraph.id,
      changedParagraphIds: [...changedParagraphIds],
      updatedAt: now,
    },
    ...(Array.isArray(paper.manualSegmentationEdits) ? paper.manualSegmentationEdits : []),
  ].slice(0, 80);
  paper.segmentationEditedAt = now;

  return {
    changedParagraphIds: [...changedParagraphIds],
    message,
  };
}

function markManualParagraphEdit(paragraph, action, updatedAt, extra = {}) {
  paragraph.manualSegmentationEdit = {
    action,
    updatedAt,
    ...extra,
  };
  paragraph.updatedAt = updatedAt;
}

function findNextManualEditableParagraphIndex(paragraphs, currentIndex) {
  for (let index = currentIndex + 1; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index];
    if (paragraph?.kind === "heading") {
      return -1;
    }

    if (paragraph?.kind === "paragraph") {
      return index;
    }
  }

  return -1;
}

function mergeManualParagraphs(previous, next) {
  previous.sourceText = mergeParagraphText(
    normalizeParagraph(previous.sourceText || ""),
    normalizeParagraph(next.sourceText || ""),
  );
  previous.rawSourceText = previous.sourceText;
  previous.pageEndNumber = Math.max(
    normalizePositivePageNumber(previous.pageEndNumber || previous.pageNumber, previous.pageNumber || 1),
    normalizePositivePageNumber(next.pageEndNumber || next.pageNumber, next.pageNumber || 1),
  );
  previous.continuesToNext = Boolean(next.continuesToNext);
  previous.contextKeywords = [
    ...normalizeKeywordList(previous.contextKeywords),
    ...normalizeKeywordList(next.contextKeywords),
  ].slice(0, 12);
  previous.relatedArtifactIds = [
    ...new Set([
      ...(Array.isArray(previous.relatedArtifactIds) ? previous.relatedArtifactIds : []),
      ...(Array.isArray(next.relatedArtifactIds) ? next.relatedArtifactIds : []),
    ]),
  ];
}

function createManualSplitParagraph(source, sourceText, updatedAt) {
  const startPage = normalizePositivePageNumber(source.pageNumber, 1);
  const endPage = normalizePositivePageNumber(source.pageEndNumber || source.pageNumber, startPage);
  const paragraph = {
    ...source,
    id: `para_${Number(source.order || 0) + 1}_${randomUUID().slice(0, 8)}`,
    order: Number(source.order || 0) + 1,
    pageNumber: startPage,
    pageEndNumber: endPage,
    sourceText,
    rawSourceText: sourceText,
    translation: "",
    explanation: "",
    keyTerms: [],
    relatedArtifactIds: [],
    chatMessages: [],
    analysisStatus: "pending",
    analysisError: "",
    analysisEligible: true,
    analysisCacheHit: false,
    analysisCachedAt: "",
    continuesFromPrevious: true,
    continuesToNext: Boolean(source.continuesToNext),
    manualSegmentationEdit: {
      action: "split-second",
      updatedAt,
      splitFromParagraphId: source.id,
    },
    manualSegmentationOverride: "reading",
    updatedAt,
  };

  delete paragraph.segmentationNoise;
  return paragraph;
}

function normalizePaperParagraphOrders(paragraphs) {
  for (const [index, paragraph] of paragraphs.entries()) {
    paragraph.order = index;
  }
}

function rebuildPaperAfterManualParagraphEdit(paper) {
  const paragraphs = Array.isArray(paper.paragraphs) ? paper.paragraphs : [];
  const chunkSummaries = Array.isArray(paper.segmentationChunkSummaries) ? paper.segmentationChunkSummaries : [];
  paper.sections = inferSectionsFromSegmentationPlan(paragraphs, paper.structureMap || null);
  enrichSectionsWithContext(paper.sections, paragraphs, chunkSummaries);
  paper.contextProfile = buildPaperContextProfile(paragraphs, paper.sections, chunkSummaries, paper.structureMap || null);
  attachParagraphArtifactLinks(paper);
  paper.segmentationStages = {
    ...(paper.segmentationStages || {}),
    manualEdit: {
      updatedAt: paper.segmentationEditedAt || new Date().toISOString(),
      edits: Array.isArray(paper.manualSegmentationEdits) ? paper.manualSegmentationEdits.length : 0,
    },
  };
}

async function handleCreateAnalysisJob(req, res, paperId) {
  const payload = await readJson(req);
  const paper = await loadPaper(paperId);
  const settings = await secureSettingsForJob(payload.settings || {});
  const requestedIds = Array.isArray(payload.paragraphIds)
    ? payload.paragraphIds.map(String).filter(Boolean)
    : payload.paragraphId
      ? [String(payload.paragraphId)]
      : [];
  const rerunAll = Boolean(payload.rerunAll);
  const forceSelected = Boolean(payload.force);
  await syncJobsFromDisk();
  const existing = findActiveAnalysisJobForPaper(paperId);

  if (existing && !rerunAll && !forceSelected) {
    return json(res, {
      job: serializeJob(existing),
      paper,
      settings: serializeClientSettings(existing.settings || settings),
    });
  }

  if (existing && (rerunAll || forceSelected)) {
    await cancelJob(existing.id);
  }

  const segmentationAuditChanged = auditPaperSegmentationQuality(paper);
  const readingParagraphs = getReadingParagraphs(paper);
  const requestedSet = requestedIds.length ? new Set(requestedIds) : null;
  const cacheEnabled = payload.useCache !== false && !forceSelected;
  let cacheWarmups = 0;
  let cacheHits = 0;
  if (cacheEnabled) {
    cacheWarmups = ensurePaperAnalysisCache(paper);
  }
  const targets = readingParagraphs.filter((paragraph) => {
    if (requestedSet && !requestedSet.has(paragraph.id)) {
      return false;
    }

    const needsAnalysisNow = needsParagraphAnalysis(paragraph);
    if (cacheEnabled && (rerunAll || needsAnalysisNow) && hydrateParagraphAnalysisFromCache(paper, paragraph)) {
      cacheHits += 1;
      return false;
    }

    return rerunAll || forceSelected || needsAnalysisNow;
  });
  const resourceEstimate = buildAnalysisResourceEstimate(targets);
  const budgetEstimate = buildAnalysisBudgetEstimate(targets, settings, resourceEstimate);

  if (!targets.length) {
    if (cacheHits > 0 || cacheWarmups > 0 || segmentationAuditChanged) {
      await savePaper(paper);
    }
    return json(res, {
      job: null,
      paper,
      settings: serializeClientSettings(settings),
      message: cacheHits > 0 ? `已从缓存恢复 ${cacheHits} 段，没有待分析段落。` : "没有待分析段落。",
    });
  }
  enforceAnalysisResourceLimits(resourceEstimate);
  enforceAnalysisTaskBudget(budgetEstimate);

  for (const paragraph of targets) {
    if (rerunAll || forceSelected) {
      resetParagraphAnalysis(paragraph);
    }
    paragraph.analysisStatus = "queued";
    paragraph.analysisError = "";
  }
  await savePaper(paper);

  const job = createAnalysisJob({
    paper,
    paragraphIds: targets.map((paragraph) => paragraph.id),
    settings,
    rerunAll,
    cacheHits,
    resourceEstimate,
    budgetEstimate,
  });
  jobStore.jobs.set(job.id, job);
  await persistJobs();
  scheduleJobWorker();

  return json(res, {
    job: serializeJob(job),
    paper,
    settings: serializeClientSettings(settings),
  });
}

async function handleListAnalysisJobs(res, paperId) {
  await syncJobsFromDisk();
  const jobs = [...jobStore.jobs.values()]
    .filter((job) => job.type === "analysis" && job.paperId === paperId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, JOB_POLL_LIMIT)
    .map(serializeJobSummary);

  return json(res, { jobs });
}

async function handleGetActiveAnalysisJob(res, paperId) {
  await syncJobsFromDisk();
  const job = findActiveAnalysisJobForPaper(paperId);
  return json(res, { job: job ? serializeJob(job) : null });
}

async function handleCreateOcrJob(res, paperId) {
  const paper = await loadPaper(paperId);
  await syncJobsFromDisk();
  const existing = findActiveOcrJobForPaper(paperId);
  if (existing) {
    return json(res, {
      job: serializeJob(existing),
      paper,
      message: "OCR 任务已经在运行。",
    });
  }

  if (!isPaperOcrRequired(paper)) {
    return json(res, {
      job: null,
      paper,
      message: "这篇 PDF 已有可阅读文本，不需要 OCR。",
    });
  }
  enforcePageResourceLimit({
    label: "OCR",
    pageCount: getPaperPageCount(paper),
    limit: MAX_OCR_JOB_PAGES,
    envName: "PAPERLENS_MAX_OCR_JOB_PAGES",
  });

  const job = createOcrJob({ paper });
  paper.status = "needs_ocr";
  paper.segmentationMode = "ocr-required";
  paper.ocr = buildPaperOcrStatus(paper, {
    needed: true,
    status: "queued",
    reason: paper.ocr?.reason || "no-readable-text",
    detectedAt: paper.ocr?.detectedAt || new Date().toISOString(),
    jobId: job.id,
    language: OCR_LANGUAGE,
    queuedAt: job.createdAt,
    error: "",
  });
  await savePaper(paper);

  jobStore.jobs.set(job.id, job);
  await persistJobs();
  scheduleJobWorker();

  return json(res, {
    job: serializeJob(job),
    paper,
    message: "已加入本机 OCR 队列。",
  });
}

async function handleListOcrJobs(res, paperId) {
  await syncJobsFromDisk();
  const jobs = [...jobStore.jobs.values()]
    .filter((job) => job.type === "ocr" && job.paperId === paperId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, JOB_POLL_LIMIT)
    .map(serializeJobSummary);

  return json(res, { jobs });
}

async function handleGetActiveOcrJob(res, paperId) {
  await syncJobsFromDisk();
  const job = findActiveOcrJobForPaper(paperId);
  return json(res, { job: job ? serializeJob(job) : null });
}

async function handleGetJob(res, jobId) {
  await syncJobsFromDisk();
  const job = jobStore.jobs.get(jobId);
  if (!job) {
    return json(res, { error: "Job not found." }, 404);
  }

  return json(res, { job: serializeJob(job) });
}

async function handleCancelJob(res, jobId) {
  await syncJobsFromDisk();
  const job = jobStore.jobs.get(jobId);
  if (!job) {
    return json(res, { error: "Job not found." }, 404);
  }

  await cancelJob(jobId);
  return json(res, { job: serializeJob(job) });
}

async function handleRetryFailedJob(res, jobId) {
  await syncJobsFromDisk();
  const job = jobStore.jobs.get(jobId);
  if (!job) {
    return json(res, { error: "Job not found." }, 404);
  }

  if (isActiveJobStatus(job.status)) {
    return json(res, { error: "任务还在运行，不能同时重跑失败项。" }, 409);
  }

  if (job.type !== "analysis") {
    return json(res, { error: "只有段落分析任务支持重跑失败项。" }, 400);
  }

  const failedItems = job.items.filter((item) => item.status === "error");
  if (!failedItems.length) {
    return json(res, { job: serializeJob(job), message: "没有失败项需要重跑。" });
  }
  const paper = await loadPaper(job.paperId);
  const failedParagraphIds = new Set(failedItems.map((item) => item.paragraphId));
  const failedParagraphs = getReadingParagraphs(paper).filter((paragraph) => failedParagraphIds.has(paragraph.id));
  const resourceEstimate = failedParagraphs.length
    ? buildAnalysisResourceEstimate(failedParagraphs)
    : buildAnalysisRetryResourceEstimate(failedItems);
  const budgetEstimate = failedParagraphs.length
    ? buildAnalysisBudgetEstimate(failedParagraphs, job.settings, resourceEstimate)
    : null;
  enforceAnalysisResourceLimits(resourceEstimate);
  if (budgetEstimate) {
    enforceAnalysisTaskBudget(budgetEstimate);
  }

  for (const item of failedItems) {
    item.status = "queued";
    item.attempts = 0;
    item.error = "";
    item.startedAt = "";
    item.completedAt = "";
    await updatePaperParagraph(job.paperId, item.paragraphId, (paragraph) => {
      paragraph.analysisStatus = "queued";
      paragraph.analysisError = "";
    });
  }

  job.status = "queued";
  job.cancelRequested = false;
  job.retryFailedOnly = true;
  job.resourceEstimate = resourceEstimate;
  job.budgetEstimate = budgetEstimate;
  job.adaptiveBatchSize = getAnalysisProviderStrategy(job.settings, { ...job, retryFailedOnly: true }).failedRetryBatchSize;
  job.retryFailedAt = new Date().toISOString();
  job.currentParagraphId = "";
  job.error = "";
  job.startedAt = "";
  job.completedAt = "";
  job.updatedAt = new Date().toISOString();
  recalculateJobProgress(job);
  await persistJobs();
  scheduleJobWorker();

  return json(res, { job: serializeJob(job) });
}

async function listPapers(searchParams = new URLSearchParams()) {
  const files = await readdir(DATA_DIR).catch(() => []);
  const papers = [];
  const query = normalizeLibraryQuery(searchParams.get("q") || searchParams.get("query") || "");
  const tagFilter = normalizePaperTag(searchParams.get("tag") || "");
  const favoriteOnly = /^(1|true|yes)$/i.test(String(searchParams.get("favorite") || ""));

  for (const file of files) {
    if (!file.endsWith(".json") || file === "jobs.json") {
      continue;
    }

    try {
      const paper = await readJsonFileWithRecovery(path.join(DATA_DIR, file), { optional: true });
      if (!paper?.id || !Array.isArray(paper.paragraphs)) {
        continue;
      }

      const summary = summarizePaperForLibrary(paper, query);
      if (favoriteOnly && !summary.favorite) {
        continue;
      }
      if (tagFilter && !summary.tags.some((tag) => tag.toLowerCase() === tagFilter.toLowerCase())) {
        continue;
      }
      if (query && !summary.searchMatched) {
        continue;
      }

      papers.push({
        id: paper.id,
        title: paper.title,
        filename: paper.filename,
        pageCount: paper.pageCount,
        paragraphCount: summary.paragraphCount,
        analyzedCount: summary.analyzedCount,
        favorite: summary.favorite,
        tags: summary.tags,
        readingProgress: summary.readingProgress,
        exportHistory: summary.exportHistory,
        latestExport: summary.latestExport,
        ocr: summary.ocr,
        matchSnippet: summary.matchSnippet,
        matchedParagraphCount: summary.matchedParagraphCount,
        updatedAt: paper.updatedAt,
      });
    } catch {
      continue;
    }
  }

  papers.sort((a, b) => {
    if (a.favorite !== b.favorite) {
      return a.favorite ? -1 : 1;
    }
    return String(b.updatedAt).localeCompare(String(a.updatedAt));
  });
  return { papers };
}

function summarizePaperForLibrary(paper, query = "") {
  const readingParagraphs = getReadingParagraphs(paper);
  const tags = normalizePaperTags(paper.tags);
  const exportHistory = normalizeExportHistory(paper.exportHistory).slice(0, 5);
  const latestExport = exportHistory[0] || null;
  const readingProgress = normalizeReadingProgress(paper.readingProgress, paper);
  const searchableBlocks = [
    paper.title,
    paper.filename,
    ...tags,
    ...readingParagraphs.flatMap((paragraph) => [
      paragraph.sourceText,
      paragraph.translation,
      paragraph.explanation,
      ...(paragraph.keyTerms || []),
    ]),
  ];
  const haystack = searchableBlocks.join(" ").toLowerCase();
  const matchedParagraphs = query
    ? readingParagraphs.filter((paragraph) => paperParagraphMatchesQuery(paragraph, query))
    : [];

  return {
    paragraphCount: readingParagraphs.length,
    analyzedCount: readingParagraphs.filter((paragraph) => !needsParagraphAnalysis(paragraph)).length,
    favorite: Boolean(paper.favorite),
    tags,
    readingProgress,
    exportHistory,
    latestExport,
    ocr: normalizePaperOcrStatus(paper),
    searchMatched: !query || haystack.includes(query),
    matchedParagraphCount: matchedParagraphs.length,
    matchSnippet: query ? buildLibraryMatchSnippet(paper, matchedParagraphs[0], query) : "",
  };
}

function normalizeLibraryQuery(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 120);
}

function paperParagraphMatchesQuery(paragraph, query) {
  const haystack = [
    paragraph.sourceText,
    paragraph.translation,
    paragraph.explanation,
    ...(paragraph.keyTerms || []),
  ].join(" ").toLowerCase();
  return haystack.includes(query);
}

function buildLibraryMatchSnippet(paper, paragraph, query) {
  if (!paragraph) {
    const title = normalizeParagraph(paper.title || paper.filename || "");
    return title.toLowerCase().includes(query) ? title : "";
  }

  const text = normalizeParagraph([
    paragraph.sourceText,
    paragraph.translation,
    paragraph.explanation,
  ].filter(Boolean).join(" "));
  const index = text.toLowerCase().indexOf(query);
  if (index === -1) {
    return truncateText(text, 160);
  }

  const start = Math.max(0, index - 56);
  return `${start > 0 ? "..." : ""}${truncateText(text.slice(start), 180)}`;
}

function normalizePaperTags(tags) {
  const source = Array.isArray(tags)
    ? tags
    : String(tags || "").split(/[,，#\n]/);
  const result = [];
  for (const tag of source) {
    const clean = normalizePaperTag(tag);
    if (clean && !result.some((item) => item.toLowerCase() === clean.toLowerCase())) {
      result.push(clean);
    }
  }
  return result.slice(0, 12);
}

function normalizePaperTag(tag) {
  return String(tag || "")
    .replace(/^#+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32);
}

function normalizeReadingProgress(progress, paper) {
  const readingParagraphs = getReadingParagraphs(paper);
  const hasExplicitProgress = Boolean(progress?.paragraphId) ||
    Number.isFinite(Number(progress?.paragraphOrder)) ||
    Number.isFinite(Number(progress?.percent));
  if (!hasExplicitProgress) {
    return {
      paragraphId: "",
      paragraphOrder: null,
      pageNumber: null,
      percent: 0,
      updatedAt: progress?.updatedAt || "",
    };
  }

  const paragraphId = String(progress?.paragraphId || "");
  const paragraph = readingParagraphs.find((item) => item.id === paragraphId) ||
    readingParagraphs.find((item) => Number(item.order) === Number(progress?.paragraphOrder)) ||
    null;
  const total = Math.max(1, readingParagraphs.length);
  const order = paragraph ? Number(paragraph.order || 0) : 0;
  const percent = paragraph
    ? Math.round(((order + 1) / total) * 100)
    : Math.trunc(clampNumber(Number(progress?.percent || 0), 0, 100));

  return {
    paragraphId: paragraph?.id || "",
    paragraphOrder: paragraph ? order : null,
    pageNumber: paragraph ? Number(paragraph.pageNumber || 0) || null : null,
    percent: clampNumber(percent, 0, 100),
    updatedAt: progress?.updatedAt || "",
  };
}

function normalizeExportHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter((item) => item && item.format && item.exportedAt)
    .map((item) => ({
      format: String(item.format || ""),
      filename: String(item.filename || ""),
      exportedAt: String(item.exportedAt || ""),
    }))
    .sort((a, b) => String(b.exportedAt).localeCompare(String(a.exportedAt)))
    .slice(0, 20);
}

async function recordPaperExport(paper, format, filename) {
  const history = normalizeExportHistory(paper.exportHistory);
  history.unshift({
    format,
    filename,
    exportedAt: new Date().toISOString(),
  });
  paper.exportHistory = normalizeExportHistory(history);
  paper.updatedAt = new Date().toISOString();
  await savePaper(paper);
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

async function handleAuthLogin(req, res) {
  if (!AUTH_REQUIRED) {
    return json(res, buildAuthStatus(req));
  }

  const payload = await readJson(req);
  const token = String(payload.token || "");
  if (!isAccessTokenValid(token)) {
    return json(res, {
      error: "访问令牌不正确。",
      authRequired: true,
      authenticated: false,
    }, 401);
  }

  return json(res, {
    ...buildAuthStatus({ ...req, headers: { ...req.headers, cookie: `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}` } }),
    authenticated: true,
  }, 200, {
    "set-cookie": buildAuthCookie(token, req),
  });
}

function handleAuthLogout(req, res) {
  return json(res, {
    ...buildAuthStatus(req),
    authenticated: false,
  }, 200, {
    "set-cookie": clearAuthCookie(req),
  });
}

function buildAuthStatus(req = null) {
  const publicRisk = !AUTH_REQUIRED && !isLocalBindHost(HOST);
  return {
    authRequired: AUTH_REQUIRED,
    authenticated: AUTH_REQUIRED ? Boolean(req && isAuthorizedRequest(req, "")) : true,
    publicRisk,
    secretsEncrypted: Boolean(SECRET_ENCRYPTION_KEY),
    message: AUTH_REQUIRED
      ? "访问保护已启用。"
      : publicRisk
        ? "当前服务绑定在非本机地址，但没有设置 PAPERLENS_ACCESS_TOKEN。公网部署前请启用访问令牌。"
        : "本机开发模式未启用访问令牌。",
  };
}

function isAuthorizedRequest(req, pathname = "") {
  if (!AUTH_REQUIRED) {
    return true;
  }

  if (pathname === "/api/health" || pathname.startsWith("/api/auth/")) {
    return true;
  }

  return isAccessTokenValid(getRequestAccessToken(req));
}

function getRequestAccessToken(req) {
  const authorization = String(req.headers.authorization || "");
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) {
    return bearer.trim();
  }

  const headerToken = String(req.headers["x-paperlens-token"] || "").trim();
  if (headerToken) {
    return headerToken;
  }

  const cookies = parseCookies(req.headers.cookie || "");
  return cookies[AUTH_COOKIE_NAME] || "";
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) {
      continue;
    }
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }
  return cookies;
}

function isAccessTokenValid(token) {
  if (!AUTH_REQUIRED || !token) {
    return !AUTH_REQUIRED;
  }

  return safeCompareStrings(token, ACCESS_TOKEN);
}

function safeCompareStrings(a, b) {
  const left = createHash("sha256").update(String(a)).digest();
  const right = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(left, right);
}

function buildAuthCookie(token, req) {
  return [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${AUTH_COOKIE_MAX_AGE_SECONDS}`,
    isSecureRequest(req) ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

function clearAuthCookie(req) {
  return [
    `${AUTH_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    isSecureRequest(req) ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

function isSecureRequest(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  return forwardedProto === "https" || Boolean(req.socket?.encrypted);
}

function isLocalBindHost(host) {
  return ["127.0.0.1", "localhost", "::1"].includes(String(host || "").toLowerCase());
}

async function loadJobs() {
  let payload = null;
  try {
    payload = await readJsonFileWithRecovery(JOBS_PATH, { optional: true });
  } catch {
    payload = null;
  }

  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  for (const job of jobs) {
    if (!job?.id || !["analysis", "ocr", "segmentation"].includes(job.type)) {
      continue;
    }

    const normalized = await normalizeLoadedJobForRuntime(job);
    if (!normalized) {
      continue;
    }
    jobStore.jobs.set(job.id, normalized);
  }

  await persistSecrets();
  await persistJobs();
}

async function syncJobsFromDisk() {
  if (jobStore.syncPromise) {
    return jobStore.syncPromise;
  }

  jobStore.syncPromise = (async () => {
    let payload = null;
    try {
      payload = await readJsonFileWithRecovery(JOBS_PATH, { optional: true });
    } catch {
      payload = null;
    }

    const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
    for (const job of jobs) {
      if (!job?.id || !["analysis", "ocr", "segmentation"].includes(job.type)) {
        continue;
      }

      const normalized = await normalizeLoadedJobForRuntime(job);
      if (!normalized) {
        continue;
      }

      const existing = jobStore.jobs.get(normalized.id);
      if (existing && existing.id === jobStore.activeJobId) {
        if (normalized.cancelRequested && !existing.cancelRequested) {
          existing.cancelRequested = true;
          existing.status = existing.status === "queued" ? "canceled" : "canceling";
          existing.updatedAt = normalized.updatedAt || new Date().toISOString();
          jobStore.controllers.get(existing.id)?.abort();
        }
        continue;
      }

      if (!existing || isDiskJobNewer(normalized, existing)) {
        jobStore.jobs.set(normalized.id, normalized);
      }
    }
  })().finally(() => {
    jobStore.syncPromise = null;
  });

  return jobStore.syncPromise;
}

async function normalizeLoadedJobForRuntime(job) {
  const normalized = normalizeLoadedJob(job);
  if (!normalized) {
    return null;
  }

  normalized.status = normalizeRuntimeJobStatus(job.status);
  normalized.cancelRequested = Boolean(job.cancelRequested);
  if (Array.isArray(job.items)) {
    normalized.items = normalized.items.map((item, index) => ({
      ...item,
      status: normalizeRuntimeJobItemStatus(job.items[index]?.status),
    }));
    recalculateJobProgress(normalized);
  }

  if (normalized.type === "analysis" || normalized.type === "segmentation") {
    try {
      normalized.settings = await secureSettingsForJob(normalized.settings, { migrate: true });
    } catch (error) {
      console.warn(`Skipping invalid model settings for job ${normalized.id}: ${error.message}`);
      normalized.settings = redactJobSettings(normalized.settings || {});
      if (isActiveJobStatus(normalized.status)) {
        normalized.status = "error";
        normalized.error = "历史任务模型配置无法迁移，请重新创建任务。";
        normalized.completedAt = new Date().toISOString();
      }
    }
  }

  return normalized;
}

function normalizeRuntimeJobStatus(status) {
  if (status === "queued" || status === "running" || status === "canceling" || status === "done" || status === "error" || status === "canceled") {
    return status;
  }

  return "queued";
}

function normalizeRuntimeJobItemStatus(status) {
  if (status === "queued" || status === "running" || status === "done" || status === "error" || status === "canceled") {
    return status;
  }

  return "queued";
}

function isDiskJobNewer(nextJob, currentJob) {
  return getJobTimestampMs(nextJob) >= getJobTimestampMs(currentJob);
}

function getJobTimestampMs(job) {
  return Date.parse(job?.updatedAt || job?.completedAt || job?.startedAt || job?.createdAt || "") || 0;
}

async function loadSecrets() {
  let payload = null;
  try {
    payload = await readJsonFileWithRecovery(SECRETS_PATH, { optional: true, mode: 0o600 });
    payload = decryptSecretsPayload(payload);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`Could not load PaperLens secrets: ${error.message}`);
    }
    payload = null;
  }

  const keys = Array.isArray(payload?.keys) ? payload.keys : [];
  for (const item of keys) {
    if (!item?.id || !item.key) {
      continue;
    }

    secretStore.keys.set(String(item.id), {
      id: String(item.id),
      provider: String(item.provider || ""),
      baseUrl: String(item.baseUrl || ""),
      key: String(item.key),
      keyPrefix: String(item.keyPrefix || ""),
      keyLength: Number(item.keyLength || String(item.key || "").length),
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || new Date().toISOString(),
    });
  }
}

async function secureSettingsForJob(settings, options = {}) {
  const normalized = normalizeSettings(settings || {});
  if (!normalized.apiKey) {
    if (normalized.apiKeyRef && !options.migrate) {
      resolveSecretForSettings(normalized);
    }

    return redactJobSettings(normalized);
  }

  const now = new Date().toISOString();
  const id = `key_${createHash("sha256")
    .update([normalized.provider, normalized.baseUrl, normalized.apiKey].join("\n"))
    .digest("hex")
    .slice(0, 20)}`;
  const existing = secretStore.keys.get(id);
  secretStore.keys.set(id, {
    id,
    provider: normalized.provider,
    baseUrl: normalized.baseUrl,
    key: normalized.apiKey,
    keyPrefix: getApiKeyPrefix(normalized.apiKey),
    keyLength: normalized.apiKey.length,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  });

  if (!options.migrate) {
    await persistSecrets();
  }

  return redactJobSettings({
    ...normalized,
    apiKeyRef: id,
  });
}

function resolveJobSettings(settings) {
  return resolveSettingsForModel(settings);
}

function resolveSettingsForModel(settings) {
  const normalized = normalizeSettings(settings || {});
  if (normalized.apiKey || !normalized.apiKeyRef) {
    return normalized;
  }

  const secret = resolveSecretForSettings(normalized);
  return {
    ...normalized,
    apiKey: secret.key,
  };
}

function resolveSecretForSettings(settings) {
  const secret = secretStore.keys.get(settings.apiKeyRef);
  if (!secret) {
    throw badRequest("本地 API Key 引用不存在。请重新输入 API Key。");
  }

  if (secret.provider !== settings.provider || secret.baseUrl !== settings.baseUrl) {
    throw badRequest("本地 API Key 引用与当前 Provider/Base URL 不匹配。请重新输入 API Key。");
  }

  if (settings.baseUrl === "local:claude-kimi" && !secret.key.startsWith("sk-kimi-")) {
    throw badRequest("Kimi Code Key 格式不对：Kimi Code Direct 需要输入以 sk-kimi- 开头的完整 Key。请不要复制控制台列表里的脱敏显示值。");
  }

  return secret;
}

function serializeClientSettings(settings = {}) {
  const safeSettings = redactJobSettings(settings);
  const secret = safeSettings.apiKeyRef ? secretStore.keys.get(safeSettings.apiKeyRef) : null;
  return {
    ...safeSettings,
    keyInfo: secret ? serializeKeyInfo(secret) : null,
  };
}

function serializeKeyInfo(secret) {
  return {
    id: secret.id,
    provider: secret.provider,
    baseUrl: secret.baseUrl,
    keyPrefix: secret.keyPrefix,
    keyLength: secret.keyLength,
    createdAt: secret.createdAt,
    updatedAt: secret.updatedAt,
  };
}

function getApiKeyPrefix(apiKey) {
  if (apiKey.startsWith("sk-kimi-")) {
    return "sk-kimi";
  }

  if (apiKey.startsWith("sk-")) {
    return "sk";
  }

  return apiKey ? "unknown" : "missing";
}

async function persistSecrets() {
  const plainPayload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    keys: [...secretStore.keys.values()].sort((a, b) => String(a.id).localeCompare(String(b.id))),
  };
  const payload = encryptSecretsPayload(plainPayload);
  secretStore.savePromise = secretStore.savePromise
    .catch(() => {})
    .then(async () => {
      await writeJsonFileAtomic(SECRETS_PATH, payload, {
        mode: 0o600,
        backup: Boolean(SECRET_ENCRYPTION_KEY),
      });
    });
  await secretStore.savePromise;
}

function encryptSecretsPayload(payload) {
  if (!SECRET_ENCRYPTION_KEY) {
    return payload;
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getSecretEncryptionKeyBytes(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return {
    version: 2,
    encrypted: true,
    algorithm: "aes-256-gcm",
    updatedAt: payload.updatedAt,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  };
}

function decryptSecretsPayload(payload) {
  if (!payload?.encrypted) {
    return payload;
  }

  if (!SECRET_ENCRYPTION_KEY) {
    throw new Error("data/secrets.json 已加密，但没有设置 PAPERLENS_SECRET_KEY 或 PAPERLENS_ACCESS_TOKEN。");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getSecretEncryptionKeyBytes(),
    Buffer.from(payload.iv || "", "base64"),
  );
  decipher.setAuthTag(Buffer.from(payload.tag || "", "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.data || "", "base64")),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8"));
}

function getSecretEncryptionKeyBytes() {
  return createHash("sha256").update(SECRET_ENCRYPTION_KEY).digest();
}

function normalizeLoadedJob(job) {
  if (job.type === "ocr") {
    return normalizeLoadedOcrJob(job);
  }

  if (job.type === "segmentation") {
    return normalizeLoadedSegmentationJob(job);
  }

  const items = Array.isArray(job.items) ? job.items : [];
  const normalizedItems = items
    .filter((item) => item?.paragraphId)
    .map((item) => ({
      paragraphId: String(item.paragraphId),
      status: normalizeLoadedJobItemStatus(item.status),
      attempts: Number.isFinite(Number(item.attempts)) ? Number(item.attempts) : 0,
      error: String(item.error || ""),
      startedAt: item.startedAt || "",
      completedAt: item.completedAt || "",
    }));

  const completed = normalizedItems.filter((item) => item.status === "done").length;
  const failed = normalizedItems.filter((item) => item.status === "error").length;
  return {
    id: String(job.id),
    type: "analysis",
    paperId: String(job.paperId || ""),
    paperTitle: String(job.paperTitle || ""),
    status: normalizeLoadedJobStatus(job.status),
    cancelRequested: Boolean(job.cancelRequested),
    rerunAll: Boolean(job.rerunAll),
    retryFailedOnly: Boolean(job.retryFailedOnly),
    cacheHits: Number.isFinite(Number(job.cacheHits)) ? Number(job.cacheHits) : 0,
    adaptiveBatchSize: Number.isFinite(Number(job.adaptiveBatchSize)) ? Number(job.adaptiveBatchSize) : null,
    resourceEstimate: normalizeJobResourceEstimate(job.resourceEstimate),
    budgetEstimate: normalizeJobBudgetEstimate(job.budgetEstimate),
    settings: job.settings || {},
    items: normalizedItems,
    total: normalizedItems.length,
    completed,
    failed,
    currentParagraphId: "",
    currentBatchSize: 0,
    error: String(job.error || ""),
    createdAt: job.createdAt || new Date().toISOString(),
    startedAt: job.startedAt || "",
    completedAt: job.completedAt || "",
    updatedAt: job.updatedAt || new Date().toISOString(),
  };
}

function normalizeLoadedSegmentationJob(job) {
  const items = Array.isArray(job.items) && job.items.length
    ? job.items
    : [{ paragraphId: "__segmentation__", status: job.status, attempts: 0 }];
  const normalizedItems = items.map((item, index) => ({
    paragraphId: String(item.paragraphId || `chunk_${index + 1}`),
    pageRange: String(item.pageRange || ""),
    status: normalizeLoadedJobItemStatus(item.status),
    attempts: Number.isFinite(Number(item.attempts)) ? Number(item.attempts) : 0,
    error: String(item.error || ""),
    startedAt: item.startedAt || "",
    completedAt: item.completedAt || "",
  }));
  const completed = normalizedItems.filter((item) => item.status === "done").length;
  const failed = normalizedItems.filter((item) => item.status === "error").length;
  return {
    id: String(job.id),
    type: "segmentation",
    paperId: String(job.paperId || ""),
    paperTitle: String(job.paperTitle || ""),
    status: normalizeLoadedJobStatus(job.status),
    cancelRequested: Boolean(job.cancelRequested),
    retryFailedOnly: false,
    cacheHits: 0,
    adaptiveBatchSize: null,
    settings: job.settings || {},
    items: normalizedItems,
    total: Math.max(1, normalizedItems.length),
    completed,
    failed,
    currentParagraphId: "",
    currentBatchSize: 0,
    phase: String(job.phase || ""),
    message: String(job.message || ""),
    segmentation: job.segmentation || null,
    error: String(job.error || ""),
    createdAt: job.createdAt || new Date().toISOString(),
    startedAt: job.startedAt || "",
    completedAt: job.completedAt || "",
    updatedAt: job.updatedAt || new Date().toISOString(),
  };
}

function normalizeLoadedOcrJob(job) {
  const items = Array.isArray(job.items) && job.items.length
    ? job.items
    : [{ paragraphId: "__ocr__", status: job.status, attempts: 0 }];
  const normalizedItems = items.map((item) => ({
    paragraphId: String(item.paragraphId || "__ocr__"),
    status: normalizeLoadedJobItemStatus(item.status),
    attempts: Number.isFinite(Number(item.attempts)) ? Number(item.attempts) : 0,
    error: String(item.error || ""),
    startedAt: item.startedAt || "",
    completedAt: item.completedAt || "",
  }));
  const completed = normalizedItems.filter((item) => item.status === "done").length;
  const failed = normalizedItems.filter((item) => item.status === "error").length;
  return {
    id: String(job.id),
    type: "ocr",
    paperId: String(job.paperId || ""),
    paperTitle: String(job.paperTitle || ""),
    status: normalizeLoadedJobStatus(job.status),
    cancelRequested: Boolean(job.cancelRequested),
    retryFailedOnly: false,
    cacheHits: 0,
    adaptiveBatchSize: null,
    settings: {},
    items: normalizedItems,
    total: Math.max(1, normalizedItems.length),
    completed,
    failed,
    currentParagraphId: "",
    currentBatchSize: 0,
    phase: String(job.phase || ""),
    message: String(job.message || ""),
    ocr: job.ocr || null,
    error: String(job.error || ""),
    createdAt: job.createdAt || new Date().toISOString(),
    startedAt: job.startedAt || "",
    completedAt: job.completedAt || "",
    updatedAt: job.updatedAt || new Date().toISOString(),
  };
}

async function recoverInterruptedJobs() {
  const owner = await readJobWorkerLockOwner();
  const hasLiveExternalWorker = Boolean(owner?.pid && Number(owner.pid) !== process.pid && isProcessAlive(owner.pid));
  const result = recoverInterruptedJobsForRuntime(jobStore.jobs.values(), { hasLiveExternalWorker });

  if (result.changed) {
    await persistJobs();
  }
}

function createAnalysisJob({
  paper,
  paragraphIds,
  settings,
  rerunAll,
  cacheHits = 0,
  resourceEstimate = null,
  budgetEstimate = null,
}) {
  const now = new Date().toISOString();
  return {
    id: `job_${Date.now()}_${randomUUID().slice(0, 8)}`,
    type: "analysis",
    paperId: paper.id,
    paperTitle: paper.title || paper.filename || "",
    status: "queued",
    cancelRequested: false,
    rerunAll: Boolean(rerunAll),
    retryFailedOnly: false,
    cacheHits: Number(cacheHits || 0),
    adaptiveBatchSize: null,
    resourceEstimate: resourceEstimate || null,
    budgetEstimate: budgetEstimate || null,
    settings,
    items: paragraphIds.map((paragraphId) => ({
      paragraphId,
      status: "queued",
      attempts: 0,
      error: "",
      startedAt: "",
      completedAt: "",
    })),
    total: paragraphIds.length,
    completed: 0,
    failed: 0,
    currentParagraphId: "",
    currentBatchSize: 0,
    error: "",
    createdAt: now,
    startedAt: "",
    completedAt: "",
    updatedAt: now,
  };
}

function createSegmentationJob({ paper, settings }) {
  const now = new Date().toISOString();
  const chunks = chunkPagesForSegmentation(paper.extractionPages || [], getSegmentationChunkOptions(settings));
  return {
    id: `seg_${Date.now()}_${randomUUID().slice(0, 8)}`,
    type: "segmentation",
    paperId: paper.id,
    paperTitle: paper.title || paper.filename || "",
    status: "queued",
    cancelRequested: false,
    retryFailedOnly: false,
    cacheHits: 0,
    adaptiveBatchSize: null,
    settings,
    items: chunks.map((chunk, index) => ({
      paragraphId: `chunk_${index + 1}`,
      pageRange: getPageRangeLabel(chunk),
      status: "queued",
      attempts: 0,
      error: "",
      startedAt: "",
      completedAt: "",
    })),
    total: chunks.length,
    completed: 0,
    failed: 0,
    currentParagraphId: "",
    currentBatchSize: 0,
    phase: "queued",
    message: "等待 AI 分段处理。",
    segmentation: {
      pageCount: getPaperPageCount(paper),
      chunks: chunks.length,
      mode: "ai",
    },
    error: "",
    createdAt: now,
    startedAt: "",
    completedAt: "",
    updatedAt: now,
  };
}

function createOcrJob({ paper }) {
  const now = new Date().toISOString();
  return {
    id: `ocr_${Date.now()}_${randomUUID().slice(0, 8)}`,
    type: "ocr",
    paperId: paper.id,
    paperTitle: paper.title || paper.filename || "",
    status: "queued",
    cancelRequested: false,
    retryFailedOnly: false,
    cacheHits: 0,
    adaptiveBatchSize: null,
    settings: {},
    items: [{
      paragraphId: "__ocr__",
      status: "queued",
      attempts: 0,
      error: "",
      startedAt: "",
      completedAt: "",
    }],
    total: 1,
    completed: 0,
    failed: 0,
    currentParagraphId: "",
    currentBatchSize: 0,
    phase: "queued",
    message: "等待本机 OCR 工具处理 PDF",
    ocr: {
      language: OCR_LANGUAGE,
    },
    error: "",
    createdAt: now,
    startedAt: "",
    completedAt: "",
    updatedAt: now,
  };
}

function findActiveSegmentationJobForPaper(paperId) {
  const jobs = [...jobStore.jobs.values()]
    .filter((job) => job.type === "segmentation" && job.paperId === paperId && isActiveJobStatus(job.status))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  return jobs[0] || null;
}

function findActiveAnalysisJobForPaper(paperId) {
  const jobs = [...jobStore.jobs.values()]
    .filter((job) => job.type === "analysis" && job.paperId === paperId && isActiveJobStatus(job.status))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  return jobs[0] || null;
}

function findActiveOcrJobForPaper(paperId) {
  const jobs = [...jobStore.jobs.values()]
    .filter((job) => job.type === "ocr" && job.paperId === paperId && isActiveJobStatus(job.status))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  return jobs[0] || null;
}

function serializeJob(job) {
  const payload = {
    id: job.id,
    type: job.type,
    paperId: job.paperId,
    paperTitle: job.paperTitle,
    status: job.status,
    cancelRequested: Boolean(job.cancelRequested),
    rerunAll: Boolean(job.rerunAll),
    retryFailedOnly: Boolean(job.retryFailedOnly),
    cacheHits: Number(job.cacheHits || 0),
    adaptiveBatchSize: Number(job.adaptiveBatchSize || 0),
    resourceEstimate: job.resourceEstimate || null,
    budgetEstimate: job.budgetEstimate || null,
    total: job.total,
    completed: job.completed,
    failed: job.failed,
    currentParagraphId: job.currentParagraphId || "",
    currentBatchSize: getRunningJobItemCount(job),
    error: job.error || "",
    createdAt: job.createdAt,
    startedAt: job.startedAt || "",
    completedAt: job.completedAt || "",
    updatedAt: job.updatedAt,
    items: job.items.map((item) => ({
      paragraphId: item.paragraphId,
      pageRange: item.pageRange || "",
      status: item.status,
      attempts: item.attempts,
      error: item.error || "",
      startedAt: item.startedAt || "",
      completedAt: item.completedAt || "",
    })),
  };

  if (job.type === "analysis") {
    payload.strategy = getAnalysisStrategySnapshot(job.settings, job);
  }

  if (job.type === "ocr") {
    payload.phase = job.phase || "";
    payload.message = job.message || "";
    payload.ocr = job.ocr || null;
  }

  if (job.type === "segmentation") {
    payload.phase = job.phase || "";
    payload.message = job.message || "";
    payload.segmentation = job.segmentation || null;
  }

  return payload;
}

function serializeJobSummary(job) {
  const payload = {
    id: job.id,
    type: job.type,
    paperId: job.paperId,
    paperTitle: job.paperTitle,
    status: job.status,
    retryFailedOnly: Boolean(job.retryFailedOnly),
    cacheHits: Number(job.cacheHits || 0),
    resourceEstimate: job.resourceEstimate || null,
    budgetEstimate: job.budgetEstimate || null,
    total: job.total,
    completed: job.completed,
    failed: job.failed,
    currentParagraphId: job.currentParagraphId || "",
    currentBatchSize: getRunningJobItemCount(job),
    createdAt: job.createdAt,
    startedAt: job.startedAt || "",
    completedAt: job.completedAt || "",
    updatedAt: job.updatedAt,
  };

  if (job.type === "analysis") {
    payload.strategy = getAnalysisStrategySnapshot(job.settings, job);
  }

  if (job.type === "ocr") {
    payload.phase = job.phase || "";
    payload.message = job.message || "";
    payload.ocr = job.ocr || null;
  }

  if (job.type === "segmentation") {
    payload.phase = job.phase || "";
    payload.message = job.message || "";
    payload.segmentation = job.segmentation || null;
  }

  return payload;
}

function getRunningJobItemCount(job) {
  return (job.items || []).filter((item) => item.status === "running").length || Number(job.currentBatchSize || 0);
}

function recalculateJobProgress(job) {
  job.total = job.items.length;
  job.completed = job.items.filter((item) => item.status === "done").length;
  job.failed = job.items.filter((item) => item.status === "error").length;
}

async function persistJobs() {
  await syncJobsFromDisk();
  const jobs = [...jobStore.jobs.values()]
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .slice(-JOB_POLL_LIMIT);
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    jobs: jobs.map((job) => ({
      ...job,
      settings: redactJobSettings(job.settings || {}),
      cancelRequested: Boolean(job.cancelRequested),
    })),
  };
  jobStore.savePromise = jobStore.savePromise
    .catch(() => {})
    .then(async () => {
      await writeJsonFileAtomic(JOBS_PATH, payload);
    });
  await jobStore.savePromise;
}

function redactJobSettings(settings = {}) {
  const { apiKey, ...rest } = settings;
  if (!rest.apiKeyRef) {
    delete rest.apiKeyRef;
  }

  if (rest.keyInfo) {
    delete rest.keyInfo;
  }

  return rest;
}

function scheduleJobWorker() {
  if (jobStore.workerScheduled || jobStore.activeJobId) {
    return;
  }

  jobStore.workerScheduled = true;
  setTimeout(() => {
    jobStore.workerScheduled = false;
    runJobWorker().catch((error) => {
      console.error("Job worker failed:", error);
    });
  }, 0);
}

async function runJobWorker() {
  if (jobStore.activeJobId) {
    return;
  }

  const workerLock = await acquireJobWorkerLock();
  if (!workerLock) {
    return;
  }

  await syncJobsFromDisk();
  const job = getNextQueuedJob();
  if (!job) {
    await releaseJobWorkerLock(workerLock);
    return;
  }

  jobStore.activeJobId = job.id;
  const controller = new AbortController();
  jobStore.controllers.set(job.id, controller);

  try {
    if (job.type === "ocr") {
      await runOcrJob(job, controller.signal);
    } else if (job.type === "segmentation") {
      await runSegmentationJob(job, controller.signal);
    } else {
      await runAnalysisJob(job, controller.signal);
    }
  } finally {
    jobStore.controllers.delete(job.id);
    jobStore.activeJobId = null;
    await persistJobs();
    await releaseJobWorkerLock(workerLock);
    if (getNextQueuedJob()) {
      scheduleJobWorker();
    }
  }
}

async function acquireJobWorkerLock() {
  try {
    await mkdir(JOB_WORKER_LOCK_DIR);
    const ownerPath = path.join(JOB_WORKER_LOCK_DIR, "owner.json");
    const owner = {
      pid: process.pid,
      port: PORT,
      startedAt: new Date().toISOString(),
    };
    await writeFile(ownerPath, JSON.stringify(owner, null, 2));
    return owner;
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }

    const owner = await readJobWorkerLockOwner();
    if (owner?.pid && !isProcessAlive(owner.pid)) {
      await rm(JOB_WORKER_LOCK_DIR, { recursive: true, force: true });
      return acquireJobWorkerLock();
    }

    return null;
  }
}

async function releaseJobWorkerLock(owner) {
  if (!owner) {
    return;
  }

  const current = await readJobWorkerLockOwner();
  if (!current || Number(current.pid) !== process.pid) {
    return;
  }

  await rm(JOB_WORKER_LOCK_DIR, { recursive: true, force: true });
}

async function readJobWorkerLockOwner() {
  try {
    const raw = await readFile(path.join(JOB_WORKER_LOCK_DIR, "owner.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function getNextQueuedJob() {
  return [...jobStore.jobs.values()]
    .filter((job) => job.status === "queued")
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0] || null;
}

async function runAnalysisJob(job, signal) {
  const now = new Date().toISOString();
  job.status = "running";
  job.startedAt ||= now;
  job.updatedAt = now;
  await persistJobs();

  while (true) {
    if (job.cancelRequested || signal.aborted) {
      await markRemainingJobItemsCanceled(job);
      break;
    }

    const batches = getNextAnalysisBatchGroup(job);
    if (!batches.length) {
      break;
    }

    await Promise.all(batches.map((batchItems) => {
      if (getAnalysisBatchSize(job.settings, job) > 1) {
        return runAnalysisJobBatch(job, batchItems, signal);
      }

      return runAnalysisJobItem(job, batchItems[0], signal);
    }));
  }

  const finishedAt = new Date().toISOString();
  job.currentParagraphId = "";
  job.currentBatchSize = 0;
  job.updatedAt = finishedAt;
  if (job.cancelRequested || signal.aborted) {
    job.status = "canceled";
    job.completedAt = finishedAt;
  } else {
    job.status = "done";
    job.completedAt = finishedAt;
  }
}

async function runSegmentationJob(job, signal) {
  const now = new Date().toISOString();
  job.status = "running";
  job.startedAt ||= now;
  job.updatedAt = now;
  job.phase = "structure";
  job.message = "AI 正在扫描全文结构。";
  await updatePaperSegmentationJobStatus(job.paperId, job, {
    status: "running",
    phase: job.phase,
    message: job.message,
  });
  await persistJobs();

  try {
    const paper = await loadPaper(job.paperId);
    const pages = Array.isArray(paper.extractionPages) ? paper.extractionPages : [];
    if (!pages.length) {
      throw new Error("这篇论文缺少原始页面文本，无法重新 AI 分段。请重新上传 PDF。");
    }

    const segmented = await segmentPaperWithAi(paper, resolveJobSettings(job.settings), {
      signal,
      onProgress: async (event) => {
        await updateSegmentationJobProgress(job, event);
      },
    });

    if (signal.aborted || job.cancelRequested) {
      throw createAbortError("AI 分段任务已停止。");
    }

    const finishedAt = new Date().toISOString();
    for (const item of job.items) {
      if (item.status !== "done") {
        item.status = "done";
        item.completedAt = finishedAt;
        item.error = "";
      }
    }
    recalculateJobProgress(job);
    job.status = "done";
    job.phase = "done";
    job.message = `AI 分段完成：${getReadingParagraphs(segmented).length} 个段落。`;
    job.currentParagraphId = "";
    job.currentBatchSize = 0;
    job.error = "";
    job.completedAt = finishedAt;
    job.updatedAt = finishedAt;
    segmented.segmentationJob = buildPaperSegmentationJobStatus(job, {
      status: "done",
      phase: job.phase,
      message: job.message,
      completedAt: finishedAt,
    });

    await withPaperWriteLock(job.paperId, async () => {
      const currentPaper = await loadPaper(job.paperId);
      mergePaperMetadataAfterSegmentation(currentPaper, segmented);
      await savePaper(segmented);
      return segmented;
    });
    await persistJobs();
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const canceled = signal.aborted || job.cancelRequested || error.statusCode === 499 || error.name === "AbortError";
    for (const item of job.items) {
      if (item.status === "queued" || item.status === "running") {
        item.status = canceled ? "canceled" : "error";
        item.error = canceled ? "" : error.message || "AI 分段失败。";
        item.completedAt = finishedAt;
      }
    }
    recalculateJobProgress(job);
    job.status = canceled ? "canceled" : "error";
    job.phase = canceled ? "canceled" : "error";
    job.message = canceled ? "AI 分段任务已停止。" : error.message || "AI 分段失败。";
    job.error = canceled ? "" : job.message;
    job.currentParagraphId = "";
    job.currentBatchSize = 0;
    job.completedAt = finishedAt;
    job.updatedAt = finishedAt;
    await updatePaperSegmentationJobStatus(job.paperId, job, {
      status: job.status,
      phase: job.phase,
      message: job.message,
      error: job.error,
      completedAt: finishedAt,
    }).catch(() => {});
    await persistJobs();
  }
}

async function updateSegmentationJobProgress(job, event = {}) {
  const now = new Date().toISOString();
  if (event.phase === "structure-start") {
    job.phase = "structure";
    job.message = "AI 正在扫描全文结构。";
  } else if (event.phase === "structure-done") {
    job.phase = "segment";
    job.message = "全文结构扫描完成，正在进入页块分段。";
  } else if (event.phase === "memory-start") {
    job.phase = "memory";
    job.message = "精读预读：AI 正在通读全文并整理 Paper Memory。";
  } else if (event.phase === "memory-chunk-start") {
    job.phase = "memory";
    job.message = `精读预读 ${Number(event.chunkIndex || 0) + 1}/${event.totalChunks || 1} · ${event.pageRange || ""}`.trim();
  } else if (event.phase === "memory-chunk-done") {
    job.phase = "memory";
    job.message = `Paper Memory 预读进度 ${Number(event.chunkIndex || 0) + 1}/${event.totalChunks || 1} · ${event.pageRange || ""}`.trim();
  } else if (event.phase === "memory-done") {
    job.phase = "segment";
    job.message = "Paper Memory 已生成，正在进入页块分段。";
  } else if (event.phase === "chunk-start") {
    const item = job.items[event.chunkIndex];
    if (item) {
      item.status = "running";
      item.startedAt ||= now;
      item.attempts = Number(item.attempts || 0) + 1;
      item.error = "";
      job.currentParagraphId = item.paragraphId;
      job.currentBatchSize = 1;
    }
    job.phase = "segment";
    job.message = `AI 正在分段 ${Number(event.chunkIndex || 0) + 1}/${event.totalChunks || job.total} · ${event.pageRange || ""}`.trim();
  } else if (event.phase === "chunk-done") {
    const item = job.items[event.chunkIndex];
    if (item && item.status !== "done") {
      item.status = "done";
      item.completedAt = now;
      item.error = "";
    }
    job.currentParagraphId = "";
    job.currentBatchSize = 0;
    job.phase = "segment";
    job.message = `AI 分段进度 ${Number(event.chunkIndex || 0) + 1}/${event.totalChunks || job.total} · 已生成 ${event.itemCount || 0} 项。`;
  } else if (event.phase === "validation") {
    job.phase = "validation";
    job.message = "AI 分段完成，正在校验和清理段落。";
  }

  recalculateJobProgress(job);
  job.updatedAt = now;
  await updatePaperSegmentationJobStatus(job.paperId, job, {
    status: job.status,
    phase: job.phase,
    message: job.message,
  }).catch(() => {});
  await persistJobs();
}

async function updatePaperSegmentationJobStatus(paperId, job, patch = {}) {
  return withPaperWriteLock(paperId, async () => {
    const paper = await loadPaper(paperId);
    paper.segmentationJob = buildPaperSegmentationJobStatus(job, patch);
    paper.updatedAt = new Date().toISOString();
    await savePaper(paper);
    return paper;
  });
}

function buildPaperSegmentationJobStatus(job, patch = {}) {
  const now = new Date().toISOString();
  return {
    jobId: job.id,
    status: patch.status || job.status,
    phase: patch.phase || job.phase || "",
    message: patch.message || job.message || "",
    total: Number(job.total || 0),
    completed: Number(job.completed || 0),
    failed: Number(job.failed || 0),
    error: patch.error || job.error || "",
    queuedAt: job.createdAt || "",
    startedAt: job.startedAt || "",
    completedAt: patch.completedAt || job.completedAt || "",
    updatedAt: now,
  };
}

function mergePaperMetadataAfterSegmentation(previousPaper, nextPaper) {
  nextPaper.favorite = Boolean(previousPaper.favorite);
  nextPaper.tags = normalizePaperTags(previousPaper.tags);
  nextPaper.exportHistory = normalizeExportHistory(previousPaper.exportHistory);
  nextPaper.createdAt = previousPaper.createdAt || nextPaper.createdAt;
  nextPaper.readingProgress = normalizeReadingProgress(previousPaper.readingProgress || {}, nextPaper);
  nextPaper.maintenance = previousPaper.maintenance || {};
  if (previousPaper.ocr) {
    nextPaper.ocr = previousPaper.ocr;
  }
}

async function runOcrJob(job, signal) {
  const now = new Date().toISOString();
  const item = job.items[0] || {
    paragraphId: "__ocr__",
    status: "queued",
    attempts: 0,
    error: "",
    startedAt: "",
    completedAt: "",
  };
  job.items = [item];
  job.status = "running";
  job.startedAt ||= now;
  job.updatedAt = now;
  job.phase = "diagnose";
  job.message = "正在检查本机 OCRmyPDF/Tesseract";
  item.status = "running";
  item.startedAt ||= now;
  item.attempts = Number(item.attempts || 0) + 1;
  await persistJobs();

  try {
    await updatePaperOcrStatus(job.paperId, {
      status: "running",
      needed: true,
      jobId: job.id,
      language: OCR_LANGUAGE,
      startedAt: job.startedAt,
      error: "",
    });

    const diagnostics = await getOcrToolDiagnostics();
    if (!diagnostics.available) {
      const error = new Error(diagnostics.message);
      error.ocrReason = "missing-tool";
      throw error;
    }

    const paper = await loadPaper(job.paperId);
    if (!isPaperOcrRequired(paper)) {
      const finishedAt = new Date().toISOString();
      item.status = "done";
      item.completedAt = finishedAt;
      job.status = "done";
      job.completed = 1;
      job.failed = 0;
      job.phase = "done";
      job.message = "这篇 PDF 已有可阅读文本，不需要 OCR。";
      job.completedAt = finishedAt;
      job.updatedAt = finishedAt;
      await persistJobs();
      return;
    }

    const outputPdfPath = buildOcrOutputPdfPath(paper);
    job.phase = "ocr";
    job.message = `OCRmyPDF 正在处理 PDF · language=${OCR_LANGUAGE}`;
    job.ocr = {
      ...(job.ocr || {}),
      language: OCR_LANGUAGE,
      tool: diagnostics.version || "ocrmypdf",
      outputPdfPath,
    };
    job.updatedAt = new Date().toISOString();
    await persistJobs();

    await runOcrMyPdf(paper.pdfPath, outputPdfPath, signal);

    if (signal.aborted || job.cancelRequested) {
      throw createAbortError("OCR 任务已停止。");
    }

    job.phase = "extract";
    job.message = "OCR 完成，正在重新提取文本和页面结构";
    job.updatedAt = new Date().toISOString();
    await persistJobs();

    const assetDir = path.join(ASSET_DIR, paper.id);
    const extraction = await extractPdfText(outputPdfPath, assetDir, `/assets/${paper.id}`, {
      pdfEngine: PDF_ENGINE,
      rootDir: __dirname,
      swiftModuleCacheDir: SWIFT_MODULE_CACHE_DIR,
      tmpDir: TMP_DIR,
    });
    const nextPaper = buildPaperRecord({
      id: paper.id,
      filename: paper.filename,
      pdfPath: outputPdfPath,
      extraction,
    });
    mergePaperMetadataAfterOcr(paper, nextPaper);
    nextPaper.originalPdfPath = paper.originalPdfPath || paper.pdfPath;
    nextPaper.ocr = buildPaperOcrStatus(nextPaper, {
      needed: false,
      status: "done",
      reason: "ocr-completed",
      detectedAt: paper.ocr?.detectedAt || new Date().toISOString(),
      jobId: job.id,
      language: OCR_LANGUAGE,
      tool: diagnostics.version || "ocrmypdf",
      startedAt: job.startedAt,
      completedAt: new Date().toISOString(),
      outputPdfPath,
      error: "",
    });

    if (!getReadingParagraphs(nextPaper).length) {
      markPaperNeedsOcr(nextPaper);
      nextPaper.ocr = buildPaperOcrStatus(nextPaper, {
        needed: true,
        status: "failed",
        reason: "ocr-produced-no-readable-text",
        detectedAt: paper.ocr?.detectedAt || new Date().toISOString(),
        jobId: job.id,
        language: OCR_LANGUAGE,
        tool: diagnostics.version || "ocrmypdf",
        startedAt: job.startedAt,
        completedAt: new Date().toISOString(),
        outputPdfPath,
        error: "OCR 完成后仍没有提取到可阅读文本，请检查 PDF 是否为照片质量过低、语言包是否正确，或手动 OCR 后重新上传。",
      });
      await savePaper(nextPaper);
      throw new Error(nextPaper.ocr.error);
    }

    await savePaper(nextPaper);

    const finishedAt = new Date().toISOString();
    item.status = "done";
    item.completedAt = finishedAt;
    job.status = "done";
    job.completed = 1;
    job.failed = 0;
    job.phase = "done";
    job.message = `OCR 完成：重新提取 ${getReadingParagraphs(nextPaper).length} 个段落`;
    job.completedAt = finishedAt;
    job.updatedAt = finishedAt;
    await persistJobs();
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const canceled = signal.aborted || job.cancelRequested || error.name === "AbortError";
    item.status = canceled ? "canceled" : "error";
    item.error = canceled ? "" : error.message;
    item.completedAt = finishedAt;
    job.status = canceled ? "canceled" : "error";
    job.completed = 0;
    job.failed = canceled ? 0 : 1;
    job.phase = canceled ? "canceled" : "error";
    job.error = canceled ? "" : error.message;
    job.message = canceled ? "OCR 任务已停止。" : error.message;
    job.completedAt = finishedAt;
    job.updatedAt = finishedAt;
    await updatePaperOcrStatus(job.paperId, {
      status: canceled ? "required" : "failed",
      needed: true,
      reason: error.ocrReason || "ocr-failed",
      jobId: job.id,
      language: OCR_LANGUAGE,
      completedAt: finishedAt,
      error: canceled ? "" : error.message,
    }).catch(() => {});
    await persistJobs();
  }
}

async function updatePaperOcrStatus(paperId, patch) {
  const paper = await loadPaper(paperId);
  paper.status = patch.needed === false ? "ready" : "needs_ocr";
  paper.segmentationMode = patch.needed === false
    ? paper.segmentationMode === "ocr-required" ? "heuristic" : paper.segmentationMode
    : "ocr-required";
  paper.ocr = buildPaperOcrStatus(paper, {
    ...(paper.ocr || {}),
    ...patch,
    needed: patch.needed !== undefined ? patch.needed : true,
  });
  await savePaper(paper);
  return paper;
}

async function getOcrToolDiagnostics() {
  try {
    const version = await execFileText("ocrmypdf", ["--version"], {
      cwd: __dirname,
      timeout: 10_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return {
      available: true,
      version: `ocrmypdf ${version.trim().split(/\r?\n/)[0]}`.trim(),
    };
  } catch (error) {
    return {
      available: false,
      message: [
        "未找到可用的 OCRmyPDF。",
        "macOS 可运行 brew install ocrmypdf tesseract tesseract-lang；",
        "Docker 用户请重新 build 镜像；",
        `当前错误：${error.message}`,
      ].join(" "),
    };
  }
}

async function runOcrMyPdf(inputPath, outputPath, signal) {
  const args = [
    "--skip-text",
    "--deskew",
    "--rotate-pages",
    "-l",
    OCR_LANGUAGE,
    inputPath,
    outputPath,
  ];
  await execFileText("ocrmypdf", args, {
    cwd: __dirname,
    timeout: OCR_TIMEOUT_MS,
    maxBuffer: 40 * 1024 * 1024,
    signal,
  });
}

function buildOcrOutputPdfPath(paper) {
  const sourceBase = path.basename(paper.pdfPath || paper.filename || "paper.pdf", ".pdf")
    .replace(/[^\w.-]+/g, "_")
    .slice(0, 80);
  return path.join(UPLOAD_DIR, `${sourceBase}.ocr-${Date.now()}.pdf`);
}

function mergePaperMetadataAfterOcr(previousPaper, nextPaper) {
  nextPaper.favorite = Boolean(previousPaper.favorite);
  nextPaper.tags = normalizePaperTags(previousPaper.tags);
  nextPaper.exportHistory = normalizeExportHistory(previousPaper.exportHistory);
  nextPaper.createdAt = previousPaper.createdAt || nextPaper.createdAt;
  nextPaper.readingProgress = normalizeReadingProgress(previousPaper.readingProgress || {}, nextPaper);
  nextPaper.maintenance = previousPaper.maintenance || {};
}

function createAbortError(message) {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

async function runAnalysisJobItem(job, item, signal) {
  item.status = "running";
  item.startedAt = new Date().toISOString();
  item.error = "";
  item.attempts += 1;
  job.currentParagraphId = item.paragraphId;
  job.updatedAt = item.startedAt;
  await updatePaperParagraph(job.paperId, item.paragraphId, (paragraph) => {
    paragraph.analysisStatus = "running";
    paragraph.analysisError = "";
  });
  await persistJobs();

  try {
    const paper = await loadPaper(job.paperId);
    const paragraph = (paper.paragraphs || []).find((entry) => entry.id === item.paragraphId);
    if (!paragraph || paragraph.kind === "heading") {
      throw new Error("Paragraph not found.");
    }

    if (!isReadingParagraphForPaper(paper, paragraph)) {
      await markJobItemSkipped(job, item);
      return;
    }

    await analyzeParagraphInPaper(paper, paragraph, resolveJobSettings(job.settings), { signal });
    await updatePaperParagraph(job.paperId, item.paragraphId, (target, targetPaper) => {
      copyParagraphAnalysisFields(target, paragraph);
      rememberParagraphAnalysisInCache(targetPaper, target);
    });
    item.status = "done";
    item.completedAt = new Date().toISOString();
    item.error = "";
    job.completed += 1;
  } catch (error) {
    if (job.cancelRequested || signal.aborted || error.statusCode === 499) {
      item.status = "canceled";
      item.error = "";
      item.completedAt = new Date().toISOString();
      await updatePaperParagraph(job.paperId, item.paragraphId, (paragraph) => {
        paragraph.analysisStatus = "pending";
        paragraph.analysisError = "";
      });
      return;
    }

    if (item.attempts < JOB_ITEM_MAX_ATTEMPTS && isRetryableJobError(error)) {
      item.status = "queued";
      item.error = error.message || "模型请求失败。";
      job.updatedAt = new Date().toISOString();
      await persistJobs();
      await sleep(1500);
      return await runAnalysisJobItem(job, item, signal);
    }

    item.status = "error";
    item.error = error.message || "模型请求失败。";
    item.completedAt = new Date().toISOString();
    job.failed += 1;
    await updatePaperParagraph(job.paperId, item.paragraphId, (paragraph) => {
      paragraph.analysisStatus = "error";
      paragraph.analysisError = item.error;
    });
  } finally {
    if (job.currentParagraphId === item.paragraphId) {
      job.currentParagraphId = "";
    }
    job.updatedAt = new Date().toISOString();
    await persistJobs();
  }
}

function getNextAnalysisBatchGroup(job) {
  const concurrency = getAnalysisConcurrency(job.settings, job);
  const reserved = new Set();
  const batches = [];
  for (const item of job.items) {
    if (batches.length >= concurrency) {
      break;
    }

    if (reserved.has(item) || item.status !== "queued") {
      continue;
    }

    const batchItems = getNextAnalysisBatchItems(job, item, reserved);
    if (!batchItems.length) {
      continue;
    }

    for (const batchItem of batchItems) {
      reserved.add(batchItem);
    }
    batches.push(batchItems);
  }

  return batches;
}

function getNextAnalysisBatchItems(job, startItem, reserved = new Set()) {
  const batchSize = getAnalysisBatchSize(job.settings, job);
  if (batchSize <= 1) {
    return [startItem];
  }

  const startIndex = job.items.indexOf(startItem);
  if (startIndex === -1) {
    return [startItem];
  }

  const items = [];
  for (const item of job.items.slice(startIndex)) {
    if (reserved.has(item)) {
      continue;
    }

    if (item.status === "done" || item.status === "error" || item.status === "canceled") {
      continue;
    }

    if (item.status !== "queued" && item !== startItem) {
      continue;
    }

    items.push(item);
    if (items.length >= batchSize) {
      break;
    }
  }

  return items;
}

function getAnalysisConcurrency(settings = {}, job = null) {
  return getAnalysisProviderStrategy(settings, job).concurrency;
}

function getAnalysisBatchSize(settings = {}, job = null) {
  const strategy = getAnalysisProviderStrategy(settings, job);
  const configured = strategy.batchSize;
  if (!job || !Array.isArray(job.items)) {
    return configured;
  }

  if (job.retryFailedOnly) {
    return Math.max(1, Math.min(strategy.failedRetryBatchSize, configured));
  }

  if (Number.isFinite(Number(job.adaptiveBatchSize)) && Number(job.adaptiveBatchSize) > 0) {
    return clampAdaptiveBatchSize(job.adaptiveBatchSize, {
      configuredBatchSize: configured,
      retryFailedOnly: job.retryFailedOnly,
      minAdaptiveBatchSize: strategy.minAdaptiveBatchSize,
    });
  }

  const remaining = job.items.filter((item) => item.status === "queued" || item.status === "running").length;
  if (remaining <= configured) {
    return configured;
  }

  const targetBatchCount = Math.max(1, Math.floor((strategy.targetMinutes * 60) / strategy.expectedBatchSeconds));
  const neededForTarget = Math.ceil(remaining / targetBatchCount);
  return Math.trunc(clampNumber(Math.max(configured, neededForTarget), 1, strategy.maxBatchSize));
}

function getAnalysisProviderStrategy(settings = {}, job = null) {
  const provider = String(settings.provider || "").toLowerCase();
  const baseUrl = String(settings.baseUrl || "").toLowerCase();
  const model = String(settings.model || "").toLowerCase();
  const profile = normalizeAnalysisProfile(settings.analysisProfile);
  const kimiCodeDirectLike = shouldUseKimiCodeDirectApi(settings);
  const agentLike = !kimiCodeDirectLike && (provider.startsWith("claude") || baseUrl.startsWith("local:claude"));
  const deepseekLike = provider.includes("deepseek") || baseUrl.includes("deepseek") || model.includes("deepseek");
  const kimiDirectLike = provider.includes("kimi") || baseUrl.includes("moonshot") || baseUrl.includes("api.kimi.com");

  const strategy = {
    name: "openai-compatible",
    profile,
    label: `OpenAI-compatible/${getAnalysisProfileLabel(profile)}`,
    agentLike,
    batchSize: ANALYSIS_BATCH_SIZE,
    concurrency: ANALYSIS_CONCURRENCY,
    maxBatchSize: 24,
    expectedBatchSeconds: 45,
    targetMinutes: ANALYSIS_TARGET_MINUTES,
    failedRetryBatchSize: Math.max(1, Math.min(ANALYSIS_FAILED_RETRY_BATCH_SIZE + 1, 6)),
    minAdaptiveBatchSize: Math.max(1, Math.min(ANALYSIS_FAILED_RETRY_BATCH_SIZE + 1, 4)),
    timeoutBaseMs: 70_000,
    timeoutPerParagraphMs: 8_000,
    timeoutMaxMs: 210_000,
  };

  if (deepseekLike) {
    strategy.name = "deepseek";
    strategy.label = `DeepSeek/${getAnalysisProfileLabel(profile)}`;
    strategy.maxBatchSize = 24;
    strategy.expectedBatchSeconds = 34;
    strategy.failedRetryBatchSize = Math.max(1, Math.min(ANALYSIS_FAILED_RETRY_BATCH_SIZE + 1, 6));
    strategy.minAdaptiveBatchSize = Math.max(2, Math.min(strategy.failedRetryBatchSize, 4));
    strategy.timeoutBaseMs = 65_000;
    strategy.timeoutPerParagraphMs = 7_000;
  }

  if (kimiDirectLike && !agentLike) {
    strategy.name = "kimi-direct";
    strategy.label = `Kimi Direct/${getAnalysisProfileLabel(profile)}`;
    strategy.maxBatchSize = 20;
    strategy.expectedBatchSeconds = 42;
    strategy.failedRetryBatchSize = ANALYSIS_FAILED_RETRY_BATCH_SIZE;
    strategy.minAdaptiveBatchSize = Math.max(2, Math.min(strategy.failedRetryBatchSize, 4));
  }

  if (kimiCodeDirectLike) {
    strategy.name = "kimi-code-direct";
    strategy.label = `Kimi Code Direct/${getAnalysisProfileLabel(profile)}`;
    strategy.agentLike = false;
    strategy.batchSize = 4;
    strategy.concurrency = Math.min(Math.max(ANALYSIS_CONCURRENCY, 3), 4);
    strategy.maxBatchSize = 8;
    strategy.expectedBatchSeconds = 46;
    strategy.failedRetryBatchSize = ANALYSIS_FAILED_RETRY_BATCH_SIZE;
    strategy.minAdaptiveBatchSize = Math.max(3, Math.min(strategy.batchSize, 4));
    strategy.timeoutBaseMs = 75_000;
    strategy.timeoutPerParagraphMs = 8_000;
    strategy.timeoutMaxMs = 240_000;
  }

  if (agentLike) {
    strategy.name = "claude-agent";
    strategy.label = `Claude Agent/${getAnalysisProfileLabel(profile)}`;
    strategy.batchSize = CLAUDE_AGENT_ANALYSIS_BATCH_SIZE;
    strategy.concurrency = CLAUDE_AGENT_ANALYSIS_CONCURRENCY;
    strategy.maxBatchSize = 20;
    strategy.expectedBatchSeconds = 75;
    strategy.failedRetryBatchSize = ANALYSIS_FAILED_RETRY_BATCH_SIZE;
    strategy.minAdaptiveBatchSize = Math.max(2, Math.min(strategy.failedRetryBatchSize, 4));
    strategy.timeoutBaseMs = 140_000;
    strategy.timeoutPerParagraphMs = 18_000;
    strategy.timeoutMaxMs = 360_000;
  }

  applyAnalysisProfileToStrategy(strategy);
  if (job?.retryFailedOnly) {
    strategy.concurrency = Math.min(strategy.concurrency, 2);
  }
  return strategy;
}

function applyAnalysisProfileToStrategy(strategy) {
  if (strategy.profile !== "fast") {
    return strategy;
  }

  strategy.batchSize = Math.min(strategy.maxBatchSize, Math.max(strategy.batchSize + 2, Math.ceil(strategy.batchSize * 1.35)));
  strategy.concurrency = Math.min(strategy.name === "claude-agent" ? 3 : 5, strategy.concurrency + 1);
  strategy.expectedBatchSeconds = Math.max(24, Math.round(strategy.expectedBatchSeconds * 0.82));
  strategy.targetMinutes = Math.max(8, Math.min(ANALYSIS_TARGET_MINUTES, 12));
  strategy.failedRetryBatchSize = Math.min(8, strategy.failedRetryBatchSize + 1);
  strategy.timeoutPerParagraphMs = Math.max(5_000, Math.round(strategy.timeoutPerParagraphMs * 0.82));
  return strategy;
}

function getAnalysisStrategySnapshot(settings = {}, job = null) {
  const strategy = getAnalysisProviderStrategy(settings, job);
  const effectiveBatchSize = getAnalysisBatchSize(settings, job);
  const remaining = job?.items
    ? job.items.filter((item) => item.status === "queued" || item.status === "running").length
    : 0;
  const total = job?.items ? job.items.length : 0;
  return {
    name: strategy.name,
    label: strategy.label,
    profile: strategy.profile,
    targetMinutes: strategy.targetMinutes,
    batchSize: strategy.batchSize,
    effectiveBatchSize,
    concurrency: strategy.concurrency,
    maxBatchSize: strategy.maxBatchSize,
    failedRetryBatchSize: strategy.failedRetryBatchSize,
    expectedBatchSeconds: strategy.expectedBatchSeconds,
    remaining,
    total,
    estimatedRemainingSeconds: estimateAnalysisSeconds(remaining, effectiveBatchSize, strategy.concurrency, strategy.expectedBatchSeconds),
    estimatedTotalSeconds: estimateAnalysisSeconds(total, effectiveBatchSize, strategy.concurrency, strategy.expectedBatchSeconds),
  };
}

function estimateAnalysisSeconds(paragraphCount, batchSize, concurrency, expectedBatchSeconds) {
  if (!paragraphCount) {
    return 0;
  }

  const batchCount = Math.ceil(paragraphCount / Math.max(1, Number(batchSize || 1)));
  return Math.max(1, Math.ceil(batchCount / Math.max(1, Number(concurrency || 1)))) *
    Math.max(1, Number(expectedBatchSeconds || 45));
}

function buildAnalysisResourceEstimate(paragraphs = []) {
  return buildAnalysisResourceEstimatePayload(paragraphs);
}

function buildAnalysisBudgetEstimate(paragraphs = [], settings = {}, resourceEstimate = null) {
  const strategy = getAnalysisProviderStrategy(settings);
  const estimateJob = {
    settings,
    retryFailedOnly: false,
    adaptiveBatchSize: null,
    items: paragraphs.map(() => ({ status: "queued" })),
  };
  const effectiveBatchSize = getAnalysisBatchSize(settings, estimateJob);
  const estimatedSeconds = estimateAnalysisSeconds(
    paragraphs.length,
    effectiveBatchSize,
    strategy.concurrency,
    strategy.expectedBatchSeconds,
  );
  return estimateAnalysisBudget({
    paragraphs,
    settings,
    resourceEstimate,
    estimatedSeconds,
  });
}

function buildAnalysisRetryResourceEstimate(items = []) {
  return {
    paragraphs: items.length,
    chars: 0,
    approxTokens: 0,
    pages: 0,
    source: "retry-failed",
  };
}

function normalizeJobResourceEstimate(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return {
    paragraphs: Number(value.paragraphs || 0),
    chars: Number(value.chars || 0),
    approxTokens: Number(value.approxTokens || 0),
    pages: Number(value.pages || 0),
    source: value.source ? String(value.source) : "",
  };
}

function normalizeJobBudgetEstimate(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return {
    paragraphs: Number(value.paragraphs || 0),
    chars: Number(value.chars || 0),
    approxTokens: Number(value.approxTokens || 0),
    pages: Number(value.pages || 0),
    providerClass: String(value.providerClass || ""),
    profile: normalizeAnalysisProfile(value.profile),
    inputTokens: Number(value.inputTokens || 0),
    outputTokens: Number(value.outputTokens || 0),
    totalTokens: Number(value.totalTokens || 0),
    estimatedCostUsd: Number(value.estimatedCostUsd || 0),
    maxTaskBudgetUsd: Number(value.maxTaskBudgetUsd || 0),
    exceedsTaskBudget: Boolean(value.exceedsTaskBudget),
    estimatedSeconds: Number(value.estimatedSeconds || 0),
    rate: value.rate && typeof value.rate === "object"
      ? {
          inputUsdPer1M: Number(value.rate.inputUsdPer1M || 0),
          outputUsdPer1M: Number(value.rate.outputUsdPer1M || 0),
        }
      : null,
    source: value.source ? String(value.source) : "",
    approximate: value.approximate !== false,
  };
}

function enforceAnalysisResourceLimits(estimate) {
  if (isResourceLimitExceeded(estimate.paragraphs, MAX_ANALYSIS_JOB_PARAGRAPHS)) {
    throw createResourceLimitError(
      `这次分析包含 ${estimate.paragraphs} 段，超过上限 ${MAX_ANALYSIS_JOB_PARAGRAPHS} 段。请先隐藏噪声段落、分批补跑，或设置 PAPERLENS_MAX_ANALYSIS_JOB_PARAGRAPHS 调高。`,
      "analysis.paragraphs",
      estimate.paragraphs,
      MAX_ANALYSIS_JOB_PARAGRAPHS,
      "PAPERLENS_MAX_ANALYSIS_JOB_PARAGRAPHS",
    );
  }

  if (isResourceLimitExceeded(estimate.chars, MAX_ANALYSIS_JOB_CHARS)) {
    throw createResourceLimitError(
      `这次分析约 ${formatInteger(estimate.chars)} 字符，超过上限 ${formatInteger(MAX_ANALYSIS_JOB_CHARS)} 字符。请分批补跑，或设置 PAPERLENS_MAX_ANALYSIS_JOB_CHARS 调高。`,
      "analysis.chars",
      estimate.chars,
      MAX_ANALYSIS_JOB_CHARS,
      "PAPERLENS_MAX_ANALYSIS_JOB_CHARS",
    );
  }
}

function enforceAnalysisTaskBudget(estimate) {
  if (!isTaskBudgetExceeded(estimate)) {
    return;
  }

  throw createResourceLimitError(
    `这次分析预计约 ${formatUsd(estimate.estimatedCostUsd)} / ${formatInteger(estimate.totalTokens)} tokens，超过任务预算 ${formatUsd(estimate.maxTaskBudgetUsd)}。请提高 Task Budget USD、切换快速模式、先隐藏噪声段落，或分批补跑。`,
    "analysis.taskBudgetUsd",
    estimate.estimatedCostUsd,
    estimate.maxTaskBudgetUsd,
    "Task Budget USD",
  );
}

function enforcePageResourceLimit({ label, pageCount, limit, envName }) {
  if (!isResourceLimitExceeded(pageCount, limit)) {
    return;
  }

  throw createResourceLimitError(
    `${label}需要处理 ${pageCount} 页，超过上限 ${limit} 页。请拆分 PDF、改为单篇/分批处理，或设置 ${envName} 调高。`,
    `${label}.pages`,
    pageCount,
    limit,
    envName,
  );
}

function getVisualRebuildResourceBlock(budget, nextPageCount) {
  if (isResourceLimitExceeded(budget.papers + 1, MAX_VISUAL_REBUILD_PAPERS)) {
    return {
      type: "visualRebuild.papers",
      message: `批量视觉重建最多处理 ${MAX_VISUAL_REBUILD_PAPERS} 篇论文；剩余论文已跳过。`,
    };
  }

  if (isResourceLimitExceeded(budget.pages + nextPageCount, MAX_VISUAL_REBUILD_PAGES)) {
    return {
      type: "visualRebuild.pages",
      message: `批量视觉重建最多处理 ${MAX_VISUAL_REBUILD_PAGES} 页；剩余论文已跳过。`,
    };
  }

  return null;
}

function getPaperPageCount(paper) {
  return Number(paper?.pageCount || paper?.pageImages?.length || paper?.extractionPages?.length || 0);
}

function createResourceLimitError(message, type, value, limit, envName) {
  const error = badRequest(message);
  error.resourceLimit = {
    type,
    value,
    limit,
    envName,
  };
  return error;
}

function isResourceLimitExceeded(value, limit) {
  return Number(limit || 0) > 0 && Number(value || 0) > Number(limit);
}

function approximateTokenCount(chars) {
  return estimateApproximateTokenCount(chars);
}

function formatInteger(value) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

function formatUsd(value) {
  const number = Math.max(0, Number(value || 0));
  if (number > 0 && number < 0.01) {
    return `$${number.toFixed(4)}`;
  }
  return `$${number.toFixed(2)}`;
}

function getAnalysisProfileLabel(profile) {
  return profile === "fast" ? "快速" : "精读";
}

async function runAnalysisJobBatch(job, items, signal, options = {}) {
  const now = new Date().toISOString();
  for (const item of items) {
    item.status = "running";
    item.startedAt = now;
    item.error = "";
    item.attempts += 1;
  }
  job.currentParagraphId = items[0]?.paragraphId || "";
  job.currentBatchSize = items.length;
  job.updatedAt = now;
  await updatePaperParagraphs(job.paperId, items.map((item) => item.paragraphId), (paragraph) => {
    paragraph.analysisStatus = "running";
    paragraph.analysisError = "";
  });
  await persistJobs();

  try {
    const paper = await loadPaper(job.paperId);
    const loaded = items.map((item) => {
      const paragraph = (paper.paragraphs || []).find((entry) => entry.id === item.paragraphId);
      if (!paragraph || paragraph.kind === "heading") {
        throw new Error(`Paragraph not found: ${item.paragraphId}`);
      }

      return { item, paragraph };
    });
    const readable = loaded.filter(({ paragraph }) => isReadingParagraphForPaper(paper, paragraph));
    const skipped = loaded.filter(({ paragraph }) => !isReadingParagraphForPaper(paper, paragraph));
    if (skipped.length) {
      await markJobItemsSkipped(job, skipped.map(({ item }) => item));
    }

    if (!readable.length) {
      return;
    }

    const paragraphs = readable.map(({ paragraph }) => paragraph);
    const readableItems = readable.map(({ item }) => item);

    const analyzedParagraphs = await analyzeParagraphBatchInPaper(paper, paragraphs, resolveJobSettings(job.settings), { signal });
    const analyzedById = new Map(analyzedParagraphs.map((paragraph) => [paragraph.id, paragraph]));
    await updatePaperParagraphs(job.paperId, readableItems.map((item) => item.paragraphId), (paragraph, targetPaper) => {
      const analyzed = analyzedById.get(paragraph.id);
      if (analyzed) {
        copyParagraphAnalysisFields(paragraph, analyzed);
        rememberParagraphAnalysisInCache(targetPaper, paragraph);
      }
    });
    const completedAt = new Date().toISOString();
    for (const item of readableItems) {
      item.status = "done";
      item.completedAt = completedAt;
      item.error = "";
    }
    job.completed += readableItems.length;
  } catch (error) {
    const affectedItems = items.filter((item) => item.status !== "done");
    if (!affectedItems.length) {
      return;
    }

    if (job.cancelRequested || signal.aborted || error.statusCode === 499) {
      const completedAt = new Date().toISOString();
      for (const item of affectedItems) {
        item.status = "canceled";
        item.error = "";
        item.completedAt = completedAt;
      }
      await updatePaperParagraphs(job.paperId, affectedItems.map((item) => item.paragraphId), (paragraph) => {
        paragraph.analysisStatus = "pending";
        paragraph.analysisError = "";
      });
      return;
    }

    if (affectedItems.length > 1 && isFatalModelConfigurationError(error)) {
      await markJobBatchItemsError(job, affectedItems, error);
      return;
    }

    if (affectedItems.length > 1) {
      const chunks = splitJobItemsForBatchRetry(affectedItems, options.splitDepth || 0);
      const nextBatchSize = chunks[0]?.length || 1;
      const strategy = getAnalysisProviderStrategy(job.settings, job);
      const retryBatchSize = getAnalysisProviderStrategy(job.settings, { ...job, retryFailedOnly: true }).failedRetryBatchSize;
      job.adaptiveBatchSize = nextAdaptiveBatchSizeAfterSplit({
        nextBatchSize,
        currentAdaptiveBatchSize: job.adaptiveBatchSize || nextBatchSize,
        configuredBatchSize: strategy.batchSize,
        retryFailedOnly: job.retryFailedOnly,
        failedRetryBatchSize: retryBatchSize,
        minAdaptiveBatchSize: strategy.minAdaptiveBatchSize,
      });
      for (const item of affectedItems) {
        item.status = "queued";
        item.error = `批量分析失败，已拆分小批量重试：${error.message || "模型请求失败。"}`;
      }
      job.currentParagraphId = "";
      job.currentBatchSize = 0;
      job.updatedAt = new Date().toISOString();
      await updatePaperParagraphs(job.paperId, affectedItems.map((item) => item.paragraphId), (paragraph) => {
        paragraph.analysisStatus = "queued";
        paragraph.analysisError = "";
      });
      await persistJobs();
      for (const chunk of chunks) {
        if (job.cancelRequested || signal.aborted) {
          break;
        }
        await runAnalysisJobBatch(job, chunk, signal, {
          splitDepth: (options.splitDepth || 0) + 1,
        });
      }
      return;
    }

    const item = affectedItems[0];
    if (item.attempts < JOB_ITEM_MAX_ATTEMPTS && isRetryableJobError(error)) {
      item.status = "queued";
      item.error = error.message || "模型请求失败。";
      job.updatedAt = new Date().toISOString();
      await persistJobs();
      await sleep(1500);
      return await runAnalysisJobBatch(job, items, signal);
    }

    item.status = "error";
    item.error = error.message || "模型请求失败。";
    item.completedAt = new Date().toISOString();
    job.failed += 1;
    await updatePaperParagraph(job.paperId, item.paragraphId, (paragraph) => {
      paragraph.analysisStatus = "error";
      paragraph.analysisError = item.error;
    });
  } finally {
    if (items.some((item) => item.paragraphId === job.currentParagraphId)) {
      job.currentParagraphId = "";
    }
    if (job.currentBatchSize === items.length) {
      job.currentBatchSize = 0;
    }
    job.updatedAt = new Date().toISOString();
    await persistJobs();
  }
}

async function markJobBatchItemsError(job, items, error) {
  const completedAt = new Date().toISOString();
  const message = error.message || "模型请求失败。";
  for (const item of items) {
    item.status = "error";
    item.error = message;
    item.completedAt = completedAt;
  }
  job.failed += items.length;
  await updatePaperParagraphs(job.paperId, items.map((item) => item.paragraphId), (paragraph) => {
    paragraph.analysisStatus = "error";
    paragraph.analysisError = message;
  });
}

async function markJobItemSkipped(job, item) {
  await markJobItemsSkipped(job, [item]);
}

async function markJobItemsSkipped(job, items) {
  if (!items.length) {
    return;
  }

  const completedAt = new Date().toISOString();
  for (const item of items) {
    item.status = "done";
    item.error = "";
    item.completedAt = completedAt;
  }
  job.completed += items.length;
  await updatePaperParagraphs(job.paperId, items.map((item) => item.paragraphId), (paragraph) => {
    paragraph.analysisEligible = false;
    paragraph.analysisStatus = "done";
    paragraph.analysisError = "";
  });
}

function splitJobItemsForBatchRetry(items, splitDepth) {
  const targetSize = splitDepth >= MAX_BATCH_SPLIT_DEPTH
    ? 1
    : Math.max(1, Math.ceil(items.length / 2));
  const chunks = [];
  for (let index = 0; index < items.length; index += targetSize) {
    chunks.push(items.slice(index, index + targetSize));
  }

  return chunks;
}

function isRetryableJobError(error) {
  const message = String(error?.message || "");
  return /网络请求失败|fetch failed|超时|temporarily|timeout|ECONN|ENOTFOUND|ETIMEDOUT/i.test(message);
}

function isFatalModelConfigurationError(error) {
  const message = String(error?.message || "");
  return /budget has been exceeded|max budget|insufficient_quota|quota exceeded|invalid api key|unauthorized|forbidden|401|403|余额不足|预算|密钥无效/i.test(message);
}

async function markRemainingJobItemsCanceled(job) {
  if (job.type !== "analysis") {
    for (const item of job.items || []) {
      if (item.status === "queued" || item.status === "running") {
        item.status = "canceled";
        item.completedAt = new Date().toISOString();
      }
    }
    recalculateJobProgress(job);
    await persistJobs();
    return;
  }

  for (const item of job.items) {
    if (item.status === "queued" || item.status === "running") {
      item.status = "canceled";
      item.completedAt = new Date().toISOString();
      await updatePaperParagraph(job.paperId, item.paragraphId, (paragraph) => {
        paragraph.analysisStatus = "pending";
        paragraph.analysisError = "";
      });
    }
  }
}

async function cancelJob(jobId) {
  const job = jobStore.jobs.get(jobId);
  if (!job || !isActiveJobStatus(job.status)) {
    return job;
  }

  job.cancelRequested = true;
  job.status = job.status === "queued" ? "canceled" : "canceling";
  job.updatedAt = new Date().toISOString();
  const controller = jobStore.controllers.get(jobId);
  if (controller) {
    controller.abort();
  } else {
    await markRemainingJobItemsCanceled(job);
    job.completedAt = job.updatedAt;
    if (job.type === "segmentation") {
      await updatePaperSegmentationJobStatus(job.paperId, job, {
        status: "canceled",
        phase: "canceled",
        message: "AI 分段任务已停止。",
        completedAt: job.completedAt,
      }).catch(() => {});
    }
  }
  await persistJobs();
  scheduleJobWorker();
  return job;
}

async function updatePaperParagraph(paperId, paragraphId, update) {
  return withPaperWriteLock(paperId, async () => {
    const paper = await loadPaper(paperId);
    const paragraph = (paper.paragraphs || []).find((entry) => entry.id === paragraphId);
    if (!paragraph) {
      return null;
    }

    update(paragraph, paper);
    paragraph.updatedAt = new Date().toISOString();
    await savePaper(paper);
    return paragraph;
  });
}

async function updatePaperParagraphs(paperId, paragraphIds, update) {
  const wanted = new Set(paragraphIds);
  if (!wanted.size) {
    return [];
  }

  return withPaperWriteLock(paperId, async () => {
    const paper = await loadPaper(paperId);
    const updated = [];
    for (const paragraph of paper.paragraphs || []) {
      if (!wanted.has(paragraph.id)) {
        continue;
      }

      update(paragraph, paper);
      paragraph.updatedAt = new Date().toISOString();
      updated.push(paragraph);
    }

    if (updated.length) {
      await savePaper(paper);
    }

    return updated;
  });
}

async function withPaperWriteLock(paperId, operation) {
  const key = String(paperId);
  const previous = paperWriteLocks.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  paperWriteLocks.set(key, next);
  try {
    return await next;
  } finally {
    if (paperWriteLocks.get(key) === next) {
      paperWriteLocks.delete(key);
    }
  }
}

function getReadingParagraphs(paper) {
  return (paper.paragraphs || []).filter((paragraph) => isReadingParagraphForPaper(paper, paragraph));
}

function getVisiblePaperArtifacts(paper) {
  return Array.isArray(paper?.pageArtifacts)
    ? paper.pageArtifacts.filter(isVisiblePaperArtifact)
    : [];
}

function isVisiblePaperArtifact(artifact) {
  return !artifact?.hidden;
}

function needsParagraphAnalysis(paragraph) {
  return isReadingParagraph(paragraph) &&
    (
      paragraph.analysisStatus === "error" ||
      Boolean(paragraph.analysisError) ||
      !hasCompleteParagraphAnalysis(paragraph)
    );
}

function hasCompleteParagraphAnalysis(paragraph) {
  return Boolean(String(paragraph.translation || "").trim()) &&
    Boolean(String(paragraph.explanation || "").trim());
}

function isReadingParagraphForPaper(paper, paragraph) {
  const section = (paper.sections || []).find((item) => item.id === paragraph.sectionId);
  return isReadingParagraph(paragraph, section);
}

function isReadingParagraph(paragraph, section = null) {
  return paragraph?.kind === "paragraph" &&
    paragraph.analysisEligible !== false &&
    !isLikelyNonReadingParagraphText(paragraph.sourceText || "", {
      ...paragraph,
      sectionTitle: section?.title || paragraph.sectionTitleHint || "",
    });
}

function resetParagraphAnalysis(paragraph) {
  paragraph.translation = "";
  paragraph.explanation = "";
  paragraph.keyTerms = [];
  paragraph.analysisStatus = "pending";
  paragraph.analysisError = "";
  paragraph.analysisCacheHit = false;
  paragraph.analysisCachedAt = "";
}

function ensurePaperAnalysisCache(paper) {
  if (!paper || typeof paper !== "object") {
    return 0;
  }

  normalizePaperAnalysisCache(paper);
  let added = 0;
  for (const paragraph of paper.paragraphs || []) {
    if (rememberParagraphAnalysisInCache(paper, paragraph)) {
      added += 1;
    }
  }
  trimPaperAnalysisCache(paper);
  return added;
}

function normalizePaperAnalysisCache(paper) {
  const cache = paper.analysisCache && typeof paper.analysisCache === "object" ? paper.analysisCache : {};
  const entries = cache.entries && typeof cache.entries === "object" && !Array.isArray(cache.entries)
    ? cache.entries
    : {};
  paper.analysisCache = {
    version: ANALYSIS_CACHE_VERSION,
    entries,
    updatedAt: cache.updatedAt || "",
  };
  return paper.analysisCache;
}

function rememberParagraphAnalysisInCache(paper, paragraph) {
  if (!paper || !paragraph || !hasCompleteParagraphAnalysis(paragraph)) {
    return false;
  }

  const key = getParagraphAnalysisCacheKey(paragraph);
  if (!key) {
    return false;
  }

  const cache = normalizePaperAnalysisCache(paper);
  const existing = cache.entries[key];
  const translation = String(paragraph.translation || "").trim();
  const explanation = String(paragraph.explanation || "").trim();
  const keyTerms = normalizeKeywordList(paragraph.keyTerms).slice(0, 16);
  const payload = {
    key,
    sourceHash: getParagraphSourceHash(paragraph),
    sectionTitleHint: normalizeSectionTitleHint(paragraph.sectionTitleHint || ""),
    relatedArtifactIds: Array.isArray(paragraph.relatedArtifactIds) ? paragraph.relatedArtifactIds.slice(0, 12) : [],
    translation,
    explanation,
    keyTerms,
    updatedAt: new Date().toISOString(),
  };

  if (existing &&
    existing.translation === payload.translation &&
    existing.explanation === payload.explanation &&
    JSON.stringify(existing.keyTerms || []) === JSON.stringify(payload.keyTerms)) {
    return false;
  }

  cache.entries[key] = payload;
  cache.updatedAt = payload.updatedAt;
  trimPaperAnalysisCache(paper);
  return true;
}

function hydrateParagraphAnalysisFromCache(paper, paragraph) {
  if (!paper || !paragraph) {
    return false;
  }

  const cache = normalizePaperAnalysisCache(paper);
  const key = getParagraphAnalysisCacheKey(paragraph);
  const entry = key ? cache.entries[key] : null;
  if (!entry || !entry.translation || !entry.explanation) {
    return false;
  }

  paragraph.translation = entry.translation;
  paragraph.explanation = entry.explanation;
  paragraph.keyTerms = normalizeKeywordList(entry.keyTerms).slice(0, 16);
  paragraph.analysisStatus = "done";
  paragraph.analysisError = "";
  paragraph.analysisCacheHit = true;
  paragraph.analysisCachedAt = entry.updatedAt || new Date().toISOString();
  paragraph.updatedAt = new Date().toISOString();
  return true;
}

function getParagraphAnalysisCacheKey(paragraph) {
  const sourceText = normalizeParagraph(paragraph?.sourceText || "");
  if (!sourceText) {
    return "";
  }

  const sectionTitle = normalizeSectionTitleHint(paragraph.sectionTitleHint || "");
  const artifacts = Array.isArray(paragraph.relatedArtifactIds)
    ? paragraph.relatedArtifactIds.slice(0, 12).join(",")
    : "";
  return createHash("sha1")
    .update([sourceText, sectionTitle, artifacts].join("\n"))
    .digest("hex")
    .slice(0, 24);
}

function getParagraphSourceHash(paragraph) {
  return createHash("sha1")
    .update(normalizeParagraph(paragraph?.sourceText || ""))
    .digest("hex")
    .slice(0, 16);
}

function trimPaperAnalysisCache(paper) {
  const cache = normalizePaperAnalysisCache(paper);
  const entries = Object.entries(cache.entries);
  if (entries.length <= ANALYSIS_CACHE_MAX_ENTRIES) {
    return;
  }

  entries
    .sort(([, a], [, b]) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .slice(ANALYSIS_CACHE_MAX_ENTRIES)
    .forEach(([key]) => {
      delete cache.entries[key];
    });
}

function copyParagraphAnalysisFields(target, source) {
  target.translation = source.translation || "";
  target.explanation = source.explanation || "";
  target.keyTerms = Array.isArray(source.keyTerms) ? source.keyTerms : [];
  target.analysisStatus = source.analysisStatus || "done";
  target.analysisError = source.analysisError || "";
  target.analysisCacheHit = Boolean(source.analysisCacheHit);
  target.analysisCachedAt = source.analysisCachedAt || "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleAnalyze(req, res) {
  const payload = await readJson(req);
  const { paperId, paragraphId, settings } = payload;
  const securedSettings = await secureSettingsForJob(settings || {});
  const signal = getResponseAbortSignal(res);

  if (!paperId || !paragraphId) {
    return json(res, { error: "paperId and paragraphId are required." }, 400);
  }

  const paper = await loadPaper(paperId);
  const paragraph = paper.paragraphs.find((item) => item.id === paragraphId);

  if (!paragraph) {
    return json(res, { error: "Paragraph not found." }, 404);
  }

  if (!isReadingParagraphForPaper(paper, paragraph)) {
    return json(res, { error: "这个条目不是正文段落，不需要分析。" }, 400);
  }

  await analyzeParagraphInPaper(paper, paragraph, securedSettings, { signal });
  await savePaper(paper);
  return json(res, { paragraph, settings: serializeClientSettings(securedSettings) });
}

async function analyzeParagraphInPaper(paper, paragraph, settings, options = {}) {
  const content = await callModel(settings, buildParagraphAnalysisMessages(paper, paragraph, settings), {
    signal: options.signal,
  });
  const parsed = parseModelJson(content);

  paragraph.translation = parsed.translation || "";
  paragraph.explanation = parsed.explanation || content;
  paragraph.keyTerms = Array.isArray(parsed.keyTerms) ? parsed.keyTerms : [];
  paragraph.analysisStatus = "done";
  paragraph.analysisError = "";
  paragraph.updatedAt = new Date().toISOString();
  rememberParagraphAnalysisInCache(paper, paragraph);
  return paragraph;
}

async function analyzeParagraphBatchInPaper(paper, paragraphs, settings, options = {}) {
  const content = await callModel(settings, buildParagraphBatchAnalysisMessages(paper, paragraphs, settings), {
    signal: options.signal,
    maxTokens: Math.min(18000, Math.max(3600, 1800 + paragraphs.length * 1600)),
    timeoutMs: getBatchAnalysisTimeoutMs(paragraphs.length, settings),
  });
  const parsed = parseBatchAnalysisResult(content);
  const results = new Map(parsed.map((item) => [String(item.paragraphId || item.id || ""), item]));
  const missing = [];
  for (const paragraph of paragraphs) {
    const result = results.get(paragraph.id);
    if (!result) {
      missing.push(paragraph.id);
      continue;
    }

    paragraph.translation = result.translation || "";
    paragraph.explanation = result.explanation || "";
    paragraph.keyTerms = normalizeKeywordList(result.keyTerms || result.keywords).slice(0, 16);
    paragraph.analysisStatus = "done";
    paragraph.analysisError = "";
    paragraph.updatedAt = new Date().toISOString();
    rememberParagraphAnalysisInCache(paper, paragraph);
  }

  if (missing.length) {
    throw new Error(`Batch response missed paragraphs: ${missing.join(", ")}`);
  }

  return paragraphs;
}

function getBatchAnalysisTimeoutMs(batchLength, settings = {}) {
  const strategy = getAnalysisProviderStrategy(settings);
  return Math.min(
    strategy.timeoutMaxMs,
    strategy.timeoutBaseMs + Math.max(0, batchLength - 1) * strategy.timeoutPerParagraphMs,
  );
}

function parseBatchAnalysisResult(content) {
  const parsed = parseModelJson(content);
  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (Array.isArray(parsed.items)) {
    return parsed.items;
  }

  if (Array.isArray(parsed.paragraphs)) {
    return parsed.paragraphs;
  }

  if (Array.isArray(parsed.results)) {
    return parsed.results;
  }

  return Object.entries(parsed)
    .filter(([, value]) => value && typeof value === "object")
    .map(([paragraphId, value]) => ({ paragraphId, ...value }));
}

function getAnalysisProfileInstruction(settings = {}) {
  if (normalizeAnalysisProfile(settings.analysisProfile) === "fast") {
    return "快速模式：translation 仍需忠实完整翻译当前原文，保留必要英文术语和 LaTeX；explanation 用 2-3 句中文，约 120-240 个汉字，覆盖含义、作用和关键难点，不能只写一句泛泛总结。";
  }

  return "精读模式：translation 忠实完整翻译当前原文，保留必要英文术语和 LaTeX；explanation 需要 3-5 句中文，约 180-360 个汉字。";
}

function buildParagraphAnalysisMessages(paper, paragraph, settings = {}) {
  const section = (paper.sections || []).find((item) => item.id === paragraph.sectionId);
  const analysisContext = buildParagraphAnalysisContext(paper, paragraph, settings);
  const profileInstruction = getAnalysisProfileInstruction(settings);
  return [
    {
      role: "system",
      content:
        "你是一个严谨的论文精读助手。必须忠于论文原文，不编造。优先分析当前段落；上下文只用于理解术语、承接关系和图表引用，不要把上下文内容误当作当前段落翻译。请只输出合法 JSON，不要使用 Markdown 代码块。涉及公式时请保留 LaTeX，并用 $...$ 或 $$...$$ 包裹。",
    },
    {
      role: "user",
      content: [
        "请分析下面这段论文内容。",
        "",
        `章节: ${section?.title || "未知章节"}`,
        `页码: ${paragraph.pageNumber}`,
        "",
        "阅读上下文:",
        analysisContext || "无额外上下文。",
        "",
        "原文:",
        paragraph.sourceText,
        "",
        profileInstruction,
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
}

function buildParagraphBatchAnalysisMessages(paper, paragraphs, settings = {}) {
  const globalContext = buildPaperProfileContext(paper, settings) || "无。";
  const profileInstruction = getAnalysisProfileInstruction(settings);
  return [
    {
      role: "system",
      content:
        "你是一个严谨的论文精读助手。当前任务是整篇批量精读，不是速读摘要。必须忠于论文原文，不编造。请分别分析批次中的每个 paragraphId；上下文只用于理解术语、承接关系和图表引用，不要把上下文内容误当作当前段落翻译。请只输出合法 JSON，不要使用 Markdown 代码块。涉及公式时保留 LaTeX，并用 $...$ 或 $$...$$ 包裹。",
    },
    {
      role: "user",
      content: [
        "请批量精读下面这些论文段落。",
        profileInstruction,
        "explanation 至少覆盖：这段在说什么、它在论文论证中的作用、关键概念/假设/公式/图表关系、读者容易误解或需要注意的点。简单过渡段可以略短，但不能只写一句泛泛总结。",
        "不要把上下文翻译进结果；上下文只用于消解术语、承接关系和引用。",
        "每个输入 paragraph 必须返回一个同名 paragraphId，不要漏项，不要增加不存在的段落。",
        "",
        "全局上下文:",
        truncateText(globalContext, BATCH_GLOBAL_CONTEXT_LIMIT),
        "",
        "段落列表:",
        ...paragraphs.map((paragraph) => formatBatchAnalysisParagraph(paper, paragraph)),
        "",
        "输出 JSON 格式:",
        "{",
        '  "items": [',
        '    { "paragraphId": "para_xxx", "translation": "忠实中文翻译，保留必要英文术语和 LaTeX", "explanation": "3-5 句中文精读讲解，说明含义、作用、关键难点和上下文关系", "keyTerms": ["术语1", "术语2"] }',
        "  ]",
        "}",
      ].join("\n"),
    },
  ];
}

function formatBatchAnalysisParagraph(paper, paragraph) {
  const section = (paper.sections || []).find((item) => item.id === paragraph.sectionId);
  const pageLabel = paragraph.pageEndNumber && paragraph.pageEndNumber !== paragraph.pageNumber
    ? `${paragraph.pageNumber}-${paragraph.pageEndNumber}`
    : `${paragraph.pageNumber}`;
  const context = truncateText(
    buildFastBatchAnalysisContext(paper, paragraph),
    BATCH_ANALYSIS_CONTEXT_LIMIT,
  );

  return [
    `<paragraph id="${paragraph.id}">`,
    `章节: ${section?.title || "未知章节"}`,
    `页码: ${pageLabel}`,
    "上下文:",
    context || "无额外上下文。",
    "原文:",
    paragraph.sourceText,
    "</paragraph>",
  ].join("\n");
}

function buildFastBatchAnalysisContext(paper, paragraph) {
  const section = (paper.sections || []).find((item) => item.id === paragraph.sectionId);
  const blocks = [];
  if (section) {
    blocks.push([
      `章节: ${section.title || "正文"}`,
      section.summary ? `摘要: ${truncateText(section.summary, 180)}` : "",
      normalizeKeywordList(section.keywords).length
        ? `关键词: ${normalizeKeywordList(section.keywords).slice(0, 6).join("、")}`
        : "",
    ].filter(Boolean).join(" "));
  }

  const nearby = buildFastNearbyContext(paper, paragraph);
  if (nearby) {
    blocks.push(nearby);
  }

  const references = buildFastReferenceContext(paper, paragraph);
  if (references) {
    blocks.push(references);
  }

  const terms = [
    ...normalizeKeywordList(paper.contextProfile?.keywords).slice(0, 4),
    ...normalizeKeywordList(paragraph.contextKeywords).slice(0, 4),
    ...normalizeKeywordList(paragraph.keyTerms).slice(0, 4),
  ];
  const uniqueTerms = [];
  for (const term of terms) {
    pushUnique(uniqueTerms, term);
  }
  if (uniqueTerms.length) {
    blocks.push(`术语: ${uniqueTerms.slice(0, 8).join("、")}`);
  }

  return blocks.join("\n");
}

function buildFastNearbyContext(paper, paragraph) {
  const paragraphs = Array.isArray(paper.paragraphs) ? paper.paragraphs : [];
  const index = paragraphs.findIndex((item) => item.id === paragraph.id);
  if (index === -1) {
    return "";
  }

  const previous = findReadableNeighbor(paragraphs, index, -1);
  const next = findReadableNeighbor(paragraphs, index, 1);
  const lines = [];
  if (previous) {
    lines.push(`前段: ${truncateText(previous.sourceText, 180)}`);
  }
  if (next) {
    lines.push(`后段: ${truncateText(next.sourceText, 140)}`);
  }

  return lines.join("\n");
}

function buildFastReferenceContext(paper, paragraph) {
  const relatedIds = new Set(Array.isArray(paragraph.relatedArtifactIds) ? paragraph.relatedArtifactIds : []);
  const artifacts = getVisiblePaperArtifacts(paper);
  const related = artifacts
    .filter((artifact) => relatedIds.has(artifact.id) || (artifact.label && paragraphCanReferenceArtifact(paragraph, artifact)))
    .slice(0, 2);
  if (!related.length) {
    return "";
  }

  return `相关图表: ${related.map((artifact) =>
    `${artifact.label || getArtifactContextLabel(artifact)} ${truncateText(artifact.text || "", 160)}`)
    .join(" / ")}`;
}

function getArtifactContextLabel(artifact) {
  if (artifact.type === "formula") {
    return artifact.label || "公式";
  }
  if (artifact.type === "code") {
    return "代码";
  }
  return "图表";
}

function buildParagraphAnalysisContext(paper, paragraph, settings = {}) {
  const blocks = [
    buildPaperProfileContext(paper, settings),
    buildSectionWindowContext(paper, paragraph),
    buildNearbyParagraphContext(paper, paragraph),
    buildReferenceWindowContext(paper, paragraph),
    buildRelatedArtifactContext(paper, paragraph),
    buildPriorTermsContext(paper, paragraph),
  ].filter(Boolean);

  return truncateText(blocks.join("\n\n"), ANALYSIS_CONTEXT_TOTAL_LIMIT);
}

function buildPaperProfileContext(paper, settings = {}) {
  const profile = paper.contextProfile || {};
  const structure = paper.structureMap || {};
  const lines = [];
  if (structure.summary) {
    lines.push(`全文结构: ${truncateText(structure.summary, 420)}`);
  }

  if (Array.isArray(structure.sections) && structure.sections.length) {
    lines.push(`章节地图: ${formatStructureSectionsForContext(structure.sections)}`);
  }

  if (profile.summary) {
    lines.push(`全文线索: ${truncateText(profile.summary, 520)}`);
  }

  const keywords = normalizeKeywordList(profile.keywords).slice(0, 16);
  if (keywords.length) {
    lines.push(`全文关键词: ${keywords.join("、")}`);
  }

  if (normalizeAnalysisProfile(settings.analysisProfile) !== "fast" && paper.paperMemory) {
    const memory = formatPaperMemoryForPrompt(paper.paperMemory, [], { limit: 1200 });
    if (memory && memory !== "无。") {
      lines.push(`精读预读记忆:\n${memory}`);
    }
  }

  return lines.length ? lines.join("\n") : "";
}

function formatStructureSectionsForContext(sections) {
  return sections
    .slice(0, 12)
    .map((section) => {
      const page = section.endPage && section.endPage !== section.startPage
        ? `p.${section.startPage}-${section.endPage}`
        : `p.${section.startPage || "?"}`;
      return `${section.title || "未命名章节"} ${page}`;
    })
    .join("；");
}

function buildSectionWindowContext(paper, paragraph) {
  const section = (paper.sections || []).find((item) => item.id === paragraph.sectionId);
  if (!section) {
    return "";
  }

  const paragraphs = Array.isArray(paper.paragraphs) ? paper.paragraphs : [];
  const sectionParagraphs = paragraphs
    .filter((item) => item.sectionId === section.id && item.id !== paragraph.id && isReadingParagraph(item, section))
    .slice(0, 4);
  const opener = sectionParagraphs[0]
    ? formatContextParagraph(sectionParagraphs[0], `章节开头 P${sectionParagraphs[0].order + 1}`)
    : "";
  const keywords = normalizeKeywordList(section.keywords).slice(0, 10);
  const lines = [
    `章节窗口: ${section.title || "正文"}`,
    section.summary ? `章节摘要: ${truncateText(section.summary, SECTION_CONTEXT_TEXT_LIMIT)}` : "",
    keywords.length ? `章节关键词: ${keywords.join("、")}` : "",
    opener,
  ].filter(Boolean);

  return lines.length > 1 ? lines.join("\n") : "";
}

function buildNearbyParagraphContext(paper, paragraph) {
  const paragraphs = Array.isArray(paper.paragraphs) ? paper.paragraphs : [];
  const index = paragraphs.findIndex((item) => item.id === paragraph.id);
  if (index === -1) {
    return "";
  }

  const contextItems = [];
  for (let offset = 3; offset >= 1; offset -= 1) {
    const item = findReadableNeighbor(paragraphs, index, -offset);
    if (item) {
      contextItems.push(formatContextParagraph(item, `前文 P${item.order + 1}`));
    }
  }

  const next = findReadableNeighbor(paragraphs, index, 1);
  if (next) {
    contextItems.push(formatContextParagraph(next, `后文 P${next.order + 1}`));
  }

  if (!contextItems.length) {
    return "";
  }

  return ["邻近段落:", ...contextItems].join("\n");
}

function findReadableNeighbor(paragraphs, index, offset) {
  const direction = offset < 0 ? -1 : 1;
  let remaining = Math.abs(offset);
  for (let cursor = index + direction; cursor >= 0 && cursor < paragraphs.length; cursor += direction) {
    const paragraph = paragraphs[cursor];
    if (!isReadingParagraph(paragraph)) {
      continue;
    }

    remaining -= 1;
    if (remaining === 0) {
      return paragraph;
    }
  }

  return null;
}

function formatContextParagraph(paragraph, label) {
  const pageLabel = paragraph.pageEndNumber && paragraph.pageEndNumber !== paragraph.pageNumber
    ? `p.${paragraph.pageNumber}-${paragraph.pageEndNumber}`
    : `p.${paragraph.pageNumber}`;
  return `${label} (${pageLabel}): ${truncateText(normalizeParagraph(paragraph.sourceText || ""), ANALYSIS_CONTEXT_TEXT_LIMIT)}`;
}

function buildRelatedArtifactContext(paper, paragraph) {
  const relatedIds = new Set(Array.isArray(paragraph.relatedArtifactIds) ? paragraph.relatedArtifactIds : []);
  const artifacts = getVisiblePaperArtifacts(paper);
  const directMatches = artifacts.filter((artifact) => relatedIds.has(artifact.id));
  const inferredMatches = artifacts.filter((artifact) => {
    if (!artifact.label || relatedIds.has(artifact.id)) {
      return false;
    }

    return paragraphCanReferenceArtifact(paragraph, artifact);
  });
  const selected = [...directMatches, ...inferredMatches]
    .filter((artifact, index, all) => all.findIndex((item) => item.id === artifact.id) === index)
    .slice(0, 4);

  if (!selected.length) {
    return "";
  }

  return [
    "相关图表:",
    ...selected.map((artifact) => {
      const pageLabel = artifact.pageNumber ? `p.${artifact.pageNumber}` : "未知页";
      return `${artifact.label || "图表"} (${pageLabel}): ${truncateText(normalizeArtifactText(artifact.text || ""), 700)}`;
    }),
  ].join("\n");
}

function buildReferenceWindowContext(paper, paragraph) {
  const tokens = extractContextReferenceTokens(paragraph.sourceText || "");
  if (!tokens.length || !Array.isArray(paper.paragraphs)) {
    return "";
  }

  const currentOrder = Number(paragraph.order || 0);
  const selected = paper.paragraphs
    .filter((item) => item.id !== paragraph.id && isReadingParagraph(item))
    .filter((item) => tokens.some((token) => paragraphContainsContextToken(item.sourceText || "", token)))
    .sort((a, b) => Math.abs(Number(a.order || 0) - currentOrder) - Math.abs(Number(b.order || 0) - currentOrder))
    .slice(0, 3);

  if (!selected.length) {
    return "";
  }

  return [
    `引用窗口: ${tokens.map((token) => token.label).join("、")}`,
    ...selected.map((item) => formatContextParagraph(item, `相关 P${item.order + 1}`)),
  ].join("\n");
}

function extractContextReferenceTokens(text) {
  const tokens = [];
  const source = String(text || "");
  const patterns = [
    /\b(?:figure|fig\.|table|tab\.?)\s*\d+[a-z]?(?:\s*\([a-z]\))?/gi,
    /\b(?:eq\.?|equation)\s*\(?\d+[a-z]?\)?/gi,
    /\[[0-9,\s-]{1,32}\]/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const label = match[0].replace(/\s+/g, " ").trim();
      const key = normalizeContextReferenceKey(label);
      if (label && !tokens.some((token) => token.key === key)) {
        tokens.push({ key, label });
      }
      if (tokens.length >= 8) {
        return tokens;
      }
    }
  }

  return tokens;
}

function paragraphContainsContextToken(text, token) {
  const source = normalizeContextReferenceKey(text);
  return source.includes(token.key);
}

function normalizeContextReferenceKey(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\bfigure\b/g, "fig")
    .replace(/\btable\b/g, "tab")
    .replace(/\bequation\b/g, "eq")
    .replace(/[\s.()]/g, "");
}

function buildPriorTermsContext(paper, paragraph) {
  const paragraphs = Array.isArray(paper.paragraphs) ? paper.paragraphs : [];
  const terms = normalizeKeywordList(paper.contextProfile?.keywords).slice(0, 6);
  for (const item of paragraphs) {
    if (item.id === paragraph.id) {
      break;
    }

    for (const term of normalizeKeywordList(item.keyTerms)) {
      pushUnique(terms, term);
      if (terms.length >= 12) {
        break;
      }
    }

    if (terms.length >= 12) {
      break;
    }
  }

  return terms.length ? `前文已出现术语: ${terms.join("、")}` : "";
}

function truncateText(text, limit) {
  const clean = String(text || "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (clean.length <= limit) {
    return clean;
  }

  return `${clean.slice(0, Math.max(0, limit - 1)).trim()}...`;
}

function normalizeKeywordList(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value || "")
      .split(/[,，;；、\n]/g);
  const keywords = [];
  for (const item of raw) {
    const clean = String(item || "").replace(/\s+/g, " ").trim();
    if (clean && clean.length <= 80) {
      pushUnique(keywords, clean);
    }
  }

  return keywords;
}

function pushUnique(items, value) {
  const clean = String(value || "").trim();
  if (!clean) {
    return false;
  }

  const key = clean.toLowerCase();
  if (items.some((item) => String(item).toLowerCase() === key)) {
    return false;
  }

  items.push(clean);
  return true;
}

async function handleModelPing(req, res) {
  const payload = await readJson(req);
  const rawSettings = normalizeSettings(payload.settings || {});
  let diagnostics = getSettingsDiagnostics(rawSettings);
  const signal = getResponseAbortSignal(res);

  try {
    const answer = await callModel(rawSettings, [
      {
        role: "system",
        content: "你是 API 连通性测试助手。只用中文简短回答。",
      },
      {
        role: "user",
        content: "请回复：连接成功。",
      },
    ], { maxTokens: 64, signal });

    const settings = await secureSettingsForJob(rawSettings);
    diagnostics = getSettingsDiagnostics(settings);
    return json(res, {
      ok: true,
      answer,
      diagnostics,
      settings: serializeClientSettings(settings),
    });
  } catch (error) {
    return json(res, {
      error: error.message || "模型连接测试失败。",
      diagnostics,
    }, error.statusCode || 500);
  }
}

async function handleModelDiagnostics(req, res) {
  const payload = await readJson(req);
  const report = buildModelDiagnosticReport(payload.settings || {});
  return json(res, {
    ok: true,
    report,
    diagnostics: report.diagnostics,
  });
}

async function handleChat(req, res) {
  const payload = await readJson(req);
  const { paperId, paragraphId, message, settings } = payload;
  const securedSettings = await secureSettingsForJob(settings || {});
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
  if (!isReadingParagraphForPaper(paper, paragraph)) {
    return json(res, { error: "这个条目不是正文段落，不支持提问。" }, 400);
  }

  const section = paper.sections.find((item) => item.id === paragraph.sectionId);
  const nearbyParagraphs = paper.paragraphs
    .slice(Math.max(0, index - 2), Math.min(paper.paragraphs.length, index + 3))
    .filter((item) => isReadingParagraphForPaper(paper, item))
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

  const answer = await callModel(securedSettings, messages, { signal });
  paragraph.chatMessages = paragraph.chatMessages || [];
  paragraph.chatMessages.push({
    id: `msg_${randomUUID().slice(0, 12)}`,
    question: message,
    answer,
    createdAt: new Date().toISOString(),
  });

  await savePaper(paper);
  return json(res, {
    answer,
    paragraph,
    settings: serializeClientSettings(securedSettings),
  });
}

function buildPaperRecord({ id, filename, pdfPath, extraction }) {
  const pages = enhancePagesWithVisualArtifacts(extraction.pages);
  const paragraphs = splitIntoParagraphs(pages);
  const sections = inferSections(paragraphs);
  const title = inferTitleFromPages(pages, paragraphs, filename);
  const pageImages = pages
    .filter((page) => page.imagePath)
    .map((page) => ({
      pageNumber: page.pageNumber,
      imagePath: page.imagePath,
      imageWidth: page.imageWidth || null,
      imageHeight: page.imageHeight || null,
    }));
  const extractionPages = pages.map((page) => ({
    pageNumber: page.pageNumber,
    text: page.text || "",
    blocks: Array.isArray(page.blocks) ? page.blocks : [],
    visualRegions: Array.isArray(page.visualRegions) ? page.visualRegions : [],
    visualStructureVersion: page.visualStructureVersion || null,
    imagePath: page.imagePath || null,
    imageWidth: page.imageWidth || null,
    imageHeight: page.imageHeight || null,
    width: page.width || null,
    height: page.height || null,
  }));
  const pageArtifacts = extractVisualPageArtifacts(pages);

  const paper = {
    id,
    filename,
    title,
    pdfPath,
    pageCount: extraction.pageCount,
    status: "ready",
    segmentationMode: extraction.pages.some((page) => Array.isArray(page.blocks) && page.blocks.length) ? "layout" : "heuristic",
    favorite: false,
    tags: [],
    readingProgress: normalizeReadingProgress({}, { paragraphs }),
    exportHistory: [],
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

function markPaperNeedsOcr(paper) {
  paper.status = "needs_ocr";
  paper.segmentationMode = "ocr-required";
  paper.ocr = buildPaperOcrStatus(paper, {
    status: "required",
    needed: true,
    reason: "no-readable-text",
  });
  paper.updatedAt = new Date().toISOString();
  return paper;
}

function isPaperOcrRequired(paper) {
  return Boolean(paper?.ocr?.needed || paper?.status === "needs_ocr" || paper?.segmentationMode === "ocr-required");
}

function buildPaperOcrStatus(paper, patch = {}) {
  const extractionPages = Array.isArray(paper.extractionPages) ? paper.extractionPages : [];
  const textCharacters = extractionPages.reduce((total, page) =>
    total + String(page.text || "").replace(/\s+/g, "").length, 0);
  const pageImages = Array.isArray(paper.pageImages) ? paper.pageImages : [];
  const readingParagraphs = getReadingParagraphs(paper);
  const status = {
    needed: Boolean(patch.needed),
    status: patch.status || "not_required",
    reason: patch.reason || "",
    detectedAt: patch.detectedAt || new Date().toISOString(),
    pageCount: Number(paper.pageCount || extractionPages.length || 0),
    pageImageCount: pageImages.filter((page) => page.imagePath).length,
    textCharacters,
    readableParagraphCount: readingParagraphs.length,
    recommendation: "请先用 OCRmyPDF/Tesseract 生成可搜索 PDF，再重新上传 OCR 后的 PDF。",
  };

  for (const key of [
    "jobId",
    "language",
    "tool",
    "queuedAt",
    "startedAt",
    "completedAt",
    "outputPdfPath",
    "error",
  ]) {
    if (patch[key] !== undefined) {
      status[key] = patch[key];
    }
  }

  if (status.status === "queued" || status.status === "running") {
    status.recommendation = "PaperLens 正在本机 OCR；完成后会自动重新提取文本和段落。";
  } else if (status.status === "failed") {
    status.recommendation = "本机 OCR 未完成。请检查 OCRmyPDF/Tesseract 是否安装、语言包是否正确，或手动 OCR 后重新上传。";
  } else if (status.status === "done") {
    status.recommendation = "OCR 已完成，PaperLens 已重新提取可阅读文本。";
  }

  return status;
}

function normalizePaperOcrStatus(paper) {
  if (paper?.ocr?.needed || paper?.status === "needs_ocr") {
    return {
      ...(paper.ocr || {}),
      ...buildPaperOcrStatus(paper, {
        needed: true,
        status: paper.ocr?.status || "required",
        reason: paper.ocr?.reason || "no-readable-text",
        detectedAt: paper.ocr?.detectedAt || new Date().toISOString(),
      }),
      needed: true,
    };
  }

  return paper?.ocr || null;
}

function getAssetPathFromPublicPath(publicPath) {
  let relativePath = "";
  try {
    relativePath = decodeURIComponent(String(publicPath || "").replace(/^\/assets\/?/, ""));
  } catch {
    return "";
  }

  if (!relativePath || relativePath.includes("\0") || relativePath.startsWith("/") || relativePath.includes("..")) {
    return "";
  }

  const normalized = path.normalize(path.join(ASSET_DIR, relativePath));
  return normalized.startsWith(`${ASSET_DIR}${path.sep}`) ? normalized : "";
}

function buildArtifactCropSvg(artifact, baseUrl = "") {
  const crop = artifact.crop || {};
  const x = Number(crop.x);
  const y = Number(crop.y);
  const width = Number(crop.width);
  const height = Number(crop.height);
  const pageWidth = Number(crop.pageWidth || artifact.pageWidth);
  const pageHeight = Number(crop.pageHeight || artifact.pageHeight);
  if (![x, y, width, height, pageWidth, pageHeight].every(Number.isFinite) ||
    width <= 0 || height <= 0 || pageWidth <= 0 || pageHeight <= 0 || !artifact.imagePath) {
    return "";
  }

  const imageUrl = toAbsolutePublicUrl(artifact.imagePath, baseUrl);
  const label = normalizeExportLine(artifact.label || artifact.visualType || artifact.type || "PaperLens crop");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${formatSvgNumber(width)}" height="${formatSvgNumber(height)}" viewBox="${formatSvgNumber(x)} ${formatSvgNumber(y)} ${formatSvgNumber(width)} ${formatSvgNumber(height)}" role="img" aria-label="${escapeXmlAttribute(label)}">`,
    `<title>${escapeXmlText(label)}</title>`,
    `<image href="${escapeXmlAttribute(imageUrl)}" x="0" y="0" width="${formatSvgNumber(pageWidth)}" height="${formatSvgNumber(pageHeight)}" preserveAspectRatio="none"/>`,
    "</svg>",
  ].join("\n");
}

function toAbsolutePublicUrl(value, baseUrl = "") {
  const url = String(value || "");
  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  const prefix = String(baseUrl || "").replace(/\/+$/, "");
  return `${prefix}${url.startsWith("/") ? url : `/${url}`}`;
}

function getRequestBaseUrl(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = forwardedProto || (req.socket?.encrypted ? "https" : "http");
  const host = req.headers["x-forwarded-host"] || req.headers.host || `${HOST}:${PORT}`;
  return `${proto}://${String(host).split(",")[0].trim()}`;
}

function formatSvgNumber(value) {
  return Number(value).toFixed(3).replace(/\.?0+$/, "");
}

function normalizeExportLine(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function escapeXmlText(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeXmlAttribute(text) {
  return escapeXmlText(text)
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sanitizeDownloadFilename(text) {
  const clean = String(text || "")
    .replace(/\.pdf$/i, "")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96);
  return clean || "paperlens-notes";
}

function enhancePagesWithVisualStructure(pages) {
  return (pages || []).map((page) => {
    const visualRegions = inferPageVisualRegions(page);
    return {
      ...page,
      visualRegions,
      visualStructureVersion: VISUAL_STRUCTURE_VERSION,
    };
  });
}

function inferPageVisualRegions(page) {
  const blocks = Array.isArray(page.blocks) ? page.blocks : [];
  const regions = [];

  blocks.forEach((block, index) => {
    const type = classifyPageArtifact(block);
    if (!type) {
      return;
    }

    if (type === "caption") {
      const text = normalizeArtifactText(block.text || "");
      const label = extractArtifactLabel(text);
      const visualType = /^table\b/i.test(text) ? "table" : "figure";
      const crop = refineCropWithPagePixels(page, inferCaptionCrop(page, block, label), visualType);
      if (!crop) {
        return;
      }
      const cropQuality = buildCropQuality(crop, visualType);

      regions.push({
        id: `visual_${page.pageNumber}_${index}`,
        source: "caption-anchor",
        visualType,
        label,
        captionBlockIndex: index,
        x: crop.x,
        y: crop.y,
        width: crop.width,
        height: crop.height,
        pageWidth: crop.pageWidth,
        pageHeight: crop.pageHeight,
        pixelRefined: Boolean(crop.pixelRefined),
        cropQuality,
      });
      return;
    }

    if (type === "formula" || type === "code" || type === "figure-text") {
      const visualType = type === "figure-text" ? "figure" : type;
      const crop = refineCropWithPagePixels(page, inferBlockArtifactCrop(page, block, type), visualType);
      if (!crop) {
        return;
      }
      const cropQuality = buildCropQuality(crop, visualType);

      regions.push({
        id: `visual_${page.pageNumber}_${index}`,
        source: "block-cluster",
        visualType,
        label: type === "formula" ? extractFormulaLabel(block.text || "") : "",
        seedBlockIndex: index,
        x: crop.x,
        y: crop.y,
        width: crop.width,
        height: crop.height,
        pageWidth: crop.pageWidth,
        pageHeight: crop.pageHeight,
        pixelRefined: Boolean(crop.pixelRefined),
        cropQuality,
      });
    }
  });

  return dedupeVisualRegions(regions);
}

function dedupeVisualRegions(regions) {
  const result = [];
  for (const region of regions) {
    const duplicate = result.some((item) =>
      item.visualType === region.visualType &&
      item.captionBlockIndex === region.captionBlockIndex &&
      regionOverlapRatio(item, region) > 0.82);
    if (!duplicate) {
      result.push(region);
    }
  }

  return result.slice(0, 40);
}

function splitIntoParagraphs(pages) {
  const paragraphs = [];

  for (const page of pages) {
    const blocks = getReadablePageBlocks(page);

    for (const block of blocks) {
      const raw = typeof block === "string" ? block : block.text;
      const clean = normalizeReadableBlockText(raw);
      if (!clean || (clean.length < 20 && !isLikelyHeading(clean)) || isLikelyNonReadingParagraphText(clean, {
        pageNumber: page.pageNumber,
      }) || isLikelyNonReadingParagraphText(raw, {
        pageNumber: page.pageNumber,
      })) {
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
    previous.continuesToNext = Boolean(paragraph.continuesToNext);
    previous.contextKeywords = [
      ...normalizeKeywordList(previous.contextKeywords),
      ...normalizeKeywordList(paragraph.contextKeywords),
    ].filter((term, index, all) => all.findIndex((item) => item.toLowerCase() === term.toLowerCase()) === index)
      .slice(0, 12);
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
    return shouldMergeSamePageParagraphs(previous, paragraph);
  }

  if (paragraph.pageNumber !== previousEndPage + 1) {
    return false;
  }

  if (previous.sectionTitleHint && paragraph.sectionTitleHint &&
    previous.sectionTitleHint !== paragraph.sectionTitleHint) {
    return false;
  }

  if (isLikelyHeading(paragraph.sourceText) || isLikelySectionOpening(paragraph.sourceText)) {
    return false;
  }

  if (previous.continuesToNext || paragraph.continuesFromPrevious) {
    return true;
  }

  if (shouldMergeSegmentedText(previous.sourceText, paragraph.sourceText, {
    sameSection: true,
    previousContinuesToNext: previous.continuesToNext,
    nextContinuesFromPrevious: paragraph.continuesFromPrevious,
    nextIsHeading: isLikelyHeading(paragraph.sourceText) || isLikelySectionOpening(paragraph.sourceText),
  })) {
    return true;
  }

  return previous.sourceText.endsWith("-") ||
    !endsWithSentence(previous.sourceText) ||
    startsLikeContinuation(paragraph.sourceText);
}

function shouldMergeSamePageParagraphs(previous, paragraph) {
  if (previous.sectionTitleHint && paragraph.sectionTitleHint &&
    previous.sectionTitleHint !== paragraph.sectionTitleHint) {
    return false;
  }

  if (isLikelyHeading(paragraph.sourceText) || isLikelySectionOpening(paragraph.sourceText)) {
    return false;
  }

  if (isLikelyNonReadingParagraphText(previous.sourceText) || isLikelyNonReadingParagraphText(paragraph.sourceText)) {
    return false;
  }

  if (previous.sourceText.endsWith("-") && startsLikeContinuation(paragraph.sourceText)) {
    return true;
  }

  if (paragraph.continuesFromPrevious || previous.continuesToNext) {
    return true;
  }

  if (shouldMergeSegmentedText(previous.sourceText, paragraph.sourceText, {
    sameSection: true,
    previousContinuesToNext: previous.continuesToNext,
    nextContinuesFromPrevious: paragraph.continuesFromPrevious,
    nextIsHeading: isLikelyHeading(paragraph.sourceText) || isLikelySectionOpening(paragraph.sourceText),
  })) {
    return true;
  }

  const previousShortOpen = previous.sourceText.length < 900 && !endsWithSentence(previous.sourceText);
  return previousShortOpen && startsLikeContinuation(paragraph.sourceText);
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
  return startsLikeTextContinuation(text);
}

function isLikelySectionOpening(text) {
  return /^(abstract|introduction|related work|background|method|methods|methodology|experiments|results|discussion|conclusion|references|appendix)\b/i
    .test(String(text || "").trim());
}

function normalizeSectionTitleHint(title) {
  const clean = normalizeParagraph(title)
    .replace(/^\d+(?:\.\d+)*\s+/, "")
    .replace(/[:：]+$/g, "")
    .trim();
  if (!clean || clean.length < 2 || clean.length > 90) {
    return "";
  }

  if (/^(正文|body|unknown|n\/a|null|none)$/i.test(clean)) {
    return "";
  }

  return clean;
}

function normalizeSegmentationRole(role) {
  const clean = String(role || "").trim().toLowerCase();
  if (["abstract", "background", "method", "result", "discussion", "limitation", "conclusion"].includes(clean)) {
    return clean;
  }

  return "";
}

function parseModelBoolean(value) {
  if (value === true || value === false) {
    return value;
  }

  return /^(true|yes|1)$/i.test(String(value || "").trim());
}

function getReadablePageBlocks(page) {
  return getSegmentationReadablePageBlocks(page);
}

function buildRescuedReadableBlocks(block, page) {
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
      if (!text ||
        isLikelyPdfExtractionGarbageText(text) ||
        isLikelyNonReadingParagraphText(text, context) ||
        isLikelyFrontMatterTitleText(text, context) ||
        classifyPageArtifact(rescuedBlock) ||
        isBlockCoveredByVisualStructure(rescuedBlock, page)) {
        return null;
      }
      return rescuedBlock;
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

function isLikelyNonReadingBlock(block, page = null) {
  const rawText = String(block.rawText || block.text || "").replace(/\s+/g, " ").trim();
  if (isLikelyPdfExtractionGarbageText(block.text || rawText)) {
    return true;
  }

  if (classifyPageArtifact(block)) {
    return true;
  }

  if (isBlockCoveredByVisualStructure(block, page)) {
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
  if (isLikelyFrontMatterTitleText(text, context)) {
    return true;
  }

  if (isLikelyNonReadingParagraphText(text, context) || isLikelyNonReadingParagraphText(rawText, context)) {
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

function isBlockCoveredByVisualStructure(block, page) {
  if (!page || !Array.isArray(page.visualRegions) || !page.visualRegions.length) {
    return false;
  }

  const box = pickBlockBox(block);
  if (!box) {
    return false;
  }

  return page.visualRegions.some((region) => {
    if (!["figure", "table", "formula", "code"].includes(region.visualType)) {
      return false;
    }

    const overlapRatio = boxOverlapRatio(box, region);
    const lowConfidenceOversized = region.cropQuality?.oversized && region.cropQuality?.confidence === "low";
    if (overlapRatio < (lowConfidenceOversized ? 0.72 : 0.58)) {
      return false;
    }

    if (region.visualType === "formula") {
      return isFormulaContinuationBlock(block.text || "", block);
    }

    if (region.visualType === "code") {
      return isCodeContinuationBlock(block.text || "", block);
    }

    if (isLikelyVisualCandidateBlock(block, region.visualType === "table")) {
      return true;
    }

    if (overlapRatio < 0.72) {
      return false;
    }

    return isLikelyEmbeddedVisualTextBlock(block.text || "", block, region);
  });
}

function isLikelyEmbeddedVisualTextBlock(text, block = {}, region = {}) {
  const clean = normalizeArtifactText(text);
  if (!clean || isLikelyCaptionText(clean)) {
    return false;
  }

  const lineCount = Number(block.lineCount || 1);
  const averageLineLength = clean.length / Math.max(1, lineCount);
  const sentenceCount = (clean.match(/[.!?。！？]/g) || []).length;
  if (clean.length > 320 || sentenceCount >= 2 || averageLineLength > 82) {
    return false;
  }

  if (/^\([a-z]\)\s*/i.test(clean)) {
    return true;
  }

  if (region.visualType === "table") {
    const numberTokens = (clean.match(/\b\d+(?:[.,]\d+)*%?\b/g) || []).length;
    const tableTokens = /\b(dataset|granularity|method|model|metric|mae|mse|rmse|accuracy|precision|recall|total|average|avg|horizon|baseline|ours)\b|#/i.test(clean);
    return numberTokens >= 2 || (tableTokens && lineCount <= 5 && averageLineLength <= 72);
  }

  const diagramTokens = (clean.match(/\b(?:input|output|query|chunk|task|agent|model|token|layer|encoder|decoder|prompt|summary|code|step|final|manager|worker|score|loss)\b/gi) || []).length;
  const operatorTokens = (clean.match(/[→←↔=+\-*/]|=>|::/g) || []).length;
  const shortLabel = clean.length <= 90 && lineCount <= 3 && sentenceCount === 0;
  return (shortLabel && (diagramTokens >= 1 || operatorTokens >= 1)) ||
    (lineCount >= 2 && averageLineLength <= 46 && diagramTokens >= 2 && sentenceCount <= 1);
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

  if (isLikelyPublicationMetadataText(clean)) {
    return true;
  }

  if (isLikelyPageNumberOrRunningHeaderText(clean)) {
    return true;
  }

  if (isLikelyHeading(clean)) {
    return false;
  }

  if (isReferencesSectionTitle(context.sectionTitle || context.sectionTitleHint)) {
    return true;
  }

  return isLikelyAuthorOrAffiliationText(clean, context) ||
    isLikelyStandaloneLinkText(clean) ||
    isLikelyBibliographyEntry(clean) ||
    isLikelyDiagramOnlyText(clean, context);
}

function isLikelyCaptionText(text) {
  return /^(?:figure|fig\.|table)\s+\d+[a-z]?\s*[:.]/i.test(text);
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

function isLikelyBibliographyEntry(text) {
  return isLikelyBibliographyEntryText(text);
}

function isLikelyDiagramOnlyText(text, context = {}) {
  const lineCount = Number(context.lineCount || 1);
  const averageLineLength = text.length / Math.max(1, lineCount);
  const diagramTokens = (text.match(/\b(?:LLM|Query|Chunk|Task|Final|Summary|Checker|Workflow|GPU|Node|Layer|Input|Output|Encoder|Decoder|Figure)\b/gi) || []).length;
  const sentenceLike = /[.!?。！？][)"'\]]?(\s|$)/.test(text);
  return lineCount >= 4 && averageLineLength < 42 && diagramTokens >= 4 && !sentenceLike;
}

function isReferencesSectionTitle(title) {
  return isReferencesSectionTitleText(title);
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

      const artifactFields = buildPageArtifactFields(page, block, type, index);

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
        ...artifactFields,
      });
    });
  }

  return dedupePageArtifacts(artifacts).filter(isUsefulPageArtifact);
}

function isUsefulPageArtifact(artifact) {
  if (artifact?.type !== "formula") {
    return true;
  }

  return isUsefulFormulaArtifactText(artifact.text || "");
}

function dedupePageArtifacts(artifacts = []) {
  const result = [];
  for (const artifact of artifacts) {
    const existing = result.find((item) => areDuplicatePageArtifacts(item, artifact));
    if (existing) {
      mergePageArtifact(existing, artifact);
      continue;
    }

    result.push(artifact);
  }

  return result;
}

function areDuplicatePageArtifacts(a, b) {
  if (!a || !b || a.type !== b.type || Number(a.pageNumber || 0) !== Number(b.pageNumber || 0)) {
    return false;
  }

  if (a.visualRegionId && b.visualRegionId && a.visualRegionId === b.visualRegionId) {
    return true;
  }

  if (!a.crop || !b.crop) {
    return false;
  }

  return regionOverlapRatio(a.crop, b.crop) >= 0.92;
}

function mergePageArtifact(target, source) {
  target.text = mergeArtifactText(target.text, source.text);
  target.lineCount = Math.max(Number(target.lineCount || 1), Number(source.lineCount || 1));
  target.label = target.label || source.label || "";
  target.cropQuality = chooseBetterCropQuality(target.cropQuality, source.cropQuality);
}

function mergeArtifactText(a, b) {
  const parts = [];
  for (const value of [a, b]) {
    const clean = normalizeArtifactText(value);
    if (!clean || parts.some((item) => item === clean || item.includes(clean) || clean.includes(item))) {
      continue;
    }
    parts.push(clean);
  }

  return parts.join(" ").trim();
}

function chooseBetterCropQuality(a = {}, b = {}) {
  const rank = { high: 3, medium: 2, low: 1, unknown: 0 };
  const aRank = rank[a.confidence || "unknown"] ?? 0;
  const bRank = rank[b.confidence || "unknown"] ?? 0;
  return bRank > aRank ? b : a;
}

function buildPageArtifactFields(page, block, type, blockIndex = -1) {
  if (type === "caption") {
    return buildCaptionArtifactFields(page, block, blockIndex);
  }

  if (type === "formula" || type === "code" || type === "figure-text") {
    return buildBlockArtifactFields(page, block, type, blockIndex);
  }

  return {};
}

function buildCaptionArtifactFields(page, captionBlock, blockIndex = -1) {
  const text = normalizeArtifactText(captionBlock?.text || "");
  const label = extractArtifactLabel(text);
  const visualRegion = findVisualRegionForBlock(page, blockIndex, "caption-anchor");
  const visualType = /^table\b/i.test(text) ? "table" : "figure";
  const crop = visualRegionToCrop(visualRegion) ||
    refineCropWithPagePixels(page, inferCaptionCrop(page, captionBlock, label), visualType);

  return {
    label,
    visualType,
    visualRegionId: visualRegion?.id || "",
    visualSource: visualRegion?.source || "",
    cropVersion: ARTIFACT_CROP_VERSION,
    cropQuality: visualRegion?.cropQuality || buildCropQuality(crop, visualType),
    imagePath: page.imagePath || null,
    imageWidth: page.imageWidth || null,
    imageHeight: page.imageHeight || null,
    pageWidth: page.width || null,
    pageHeight: page.height || null,
    crop,
  };
}

function buildBlockArtifactFields(page, block, type, blockIndex = -1) {
  const text = normalizeArtifactText(block?.text || "");
  const visualRegion = findVisualRegionForBlock(page, blockIndex, "block-cluster");
  const crop = visualRegionToCrop(visualRegion) ||
    refineCropWithPagePixels(page, inferBlockArtifactCrop(page, block, type), type === "figure-text" ? "figure" : type);

  return {
    label: type === "formula" ? extractFormulaLabel(text) : "",
    visualType: type,
    visualRegionId: visualRegion?.id || "",
    visualSource: visualRegion?.source || "",
    cropVersion: ARTIFACT_CROP_VERSION,
    cropQuality: visualRegion?.cropQuality || buildCropQuality(crop, type === "figure-text" ? "figure" : type),
    imagePath: page.imagePath || null,
    imageWidth: page.imageWidth || null,
    imageHeight: page.imageHeight || null,
    pageWidth: page.width || null,
    pageHeight: page.height || null,
    crop,
  };
}

function findVisualRegionForBlock(page, blockIndex, source) {
  if (!Array.isArray(page.visualRegions) || blockIndex < 0) {
    return null;
  }

  const key = source === "caption-anchor" ? "captionBlockIndex" : "seedBlockIndex";
  return page.visualRegions.find((region) => region.source === source && Number(region[key]) === blockIndex) || null;
}

function visualRegionToCrop(region) {
  if (!region) {
    return null;
  }

  const crop = normalizeCrop({
    x: Number(region.x),
    y: Number(region.y),
    width: Number(region.width),
    height: Number(region.height),
    pageWidth: Number(region.pageWidth),
    pageHeight: Number(region.pageHeight),
  });
  return {
    ...crop,
    pixelRefined: Boolean(region.pixelRefined),
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

function extractFormulaLabel(text) {
  const match = String(text || "").match(/(?:^|\s)\((\d+[a-z]?)\)\s*$/i);
  return match ? `Equation ${match[1]}` : "";
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
    const maxHeight = pageHeight * 0.34;
    if (bottom - y > maxHeight) {
      bottom = Math.min(bottom, y + maxHeight);
    }
  } else {
    bottom = Math.max(0, captionY - pageHeight * 0.006);
    y = findPreviousTextBoundary(page, captionBlock, horizontal) ||
      Math.max(0, captionY - pageHeight * 0.26);
    if (captionY - y < minHeight) {
      y = Math.max(0, captionY - pageHeight * 0.22);
    }
    const maxHeight = horizontal.width > pageWidth * 0.7 ? pageHeight * 0.42 : pageHeight * 0.32;
    if (bottom - y > maxHeight) {
      y = Math.max(0, bottom - maxHeight);
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

function inferBlockArtifactCrop(page, seedBlock, type) {
  const pageWidth = Number(page.width || 0);
  const pageHeight = Number(page.height || 0);
  const seedBox = pickBlockBox(seedBlock);
  if (!pageWidth || !pageHeight || !seedBox) {
    return null;
  }

  const blocks = getClusteredArtifactBlocks(page, seedBlock, type);
  const bounds = getBlockBounds(blocks.length ? blocks : [seedBlock]);
  if (!bounds) {
    return null;
  }

  const paddingX = type === "code" ? pageWidth * 0.014 : pageWidth * 0.02;
  const paddingY = type === "code" ? pageHeight * 0.012 : pageHeight * 0.014;
  return normalizeCrop({
    x: bounds.x - paddingX,
    y: bounds.y - paddingY,
    width: bounds.width + paddingX * 2,
    height: bounds.height + paddingY * 2,
    pageWidth,
    pageHeight,
  });
}

function getClusteredArtifactBlocks(page, seedBlock, type) {
  const blocks = Array.isArray(page.blocks) ? page.blocks : [];
  const seedBox = pickBlockBox(seedBlock);
  const pageHeight = Number(page.height || 0) || 792;
  if (!seedBox) {
    return [seedBlock].filter(Boolean);
  }

  const maxGap = type === "formula" ? pageHeight * 0.028 : pageHeight * 0.04;
  const seedHorizontal = {
    x: seedBox.x - Math.max(seedBox.width * 0.08, 12),
    width: seedBox.width + Math.max(seedBox.width * 0.16, 24),
  };

  const cluster = [seedBlock];
  let bounds = seedBox;
  let changed = true;
  while (changed) {
    changed = false;
    for (const block of blocks) {
      if (cluster.includes(block) || !isCompatibleArtifactClusterBlock(block, type)) {
        continue;
      }

      const box = pickBlockBox(block);
      if (!box || !overlapsHorizontal(block, seedHorizontal, type === "formula" ? 0.08 : 0.24)) {
        continue;
      }

      if (getVerticalGap(bounds, box) > maxGap) {
        continue;
      }

      cluster.push(block);
      bounds = mergeBoxes(bounds, box);
      changed = true;
    }
  }

  return cluster;
}

function isCompatibleArtifactClusterBlock(block, type) {
  const text = normalizeArtifactText(block?.text || "");
  if (!text) {
    return false;
  }

  const blockType = classifyPageArtifact(block);
  if (blockType === type) {
    return true;
  }
  if (blockType) {
    return false;
  }

  if (type === "formula") {
    return isEquationNumberBlock(text) || isFormulaContinuationBlock(text, block);
  }

  if (type === "code") {
    return isCodeContinuationBlock(text, block);
  }

  return false;
}

function isEquationNumberBlock(text) {
  return /^\(?\d+[a-z]?\)?$/i.test(String(text || "").trim());
}

function isFormulaContinuationBlock(text, block = {}) {
  const lineCount = Number(block.lineCount || 1);
  const mathTokens = (text.match(/[=≤≥≠≈∑∏∫√∞→←↔±×÷∂λμσγαβθΩΔ]|\b(log|exp|min|max)\b/gi) || []).length;
  return lineCount <= 3 && text.length <= 180 && mathTokens >= 1 && !/[.!?。！？].{8,}/.test(text);
}

function isCodeContinuationBlock(text, block = {}) {
  const lineCount = Number(block.lineCount || 1);
  const codeSymbols = (text.match(/[{}\[\]();=<>]|=>|::/g) || []).length;
  const codeWords = (text.match(/\b(return|await|async|for|while|if|else|try|catch|throw|yield|print|self|this)\b/gi) || []).length;
  return text.length <= 1400 && (lineCount >= 2 || codeSymbols >= 3 || codeWords >= 2);
}

function getVerticalGap(a, b) {
  const aBottom = a.y + a.height;
  const bBottom = b.y + b.height;
  if (b.y > aBottom) {
    return b.y - aBottom;
  }
  if (a.y > bBottom) {
    return a.y - bBottom;
  }
  return 0;
}

function mergeBoxes(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

function boxOverlapRatio(a, b) {
  const left = Math.max(Number(a.x || 0), Number(b.x || 0));
  const top = Math.max(Number(a.y || 0), Number(b.y || 0));
  const right = Math.min(Number(a.x || 0) + Number(a.width || 0), Number(b.x || 0) + Number(b.width || 0));
  const bottom = Math.min(Number(a.y || 0) + Number(a.height || 0), Number(b.y || 0) + Number(b.height || 0));
  const overlap = Math.max(0, right - left) * Math.max(0, bottom - top);
  const area = Math.max(1, Number(a.width || 0) * Number(a.height || 0));
  return overlap / area;
}

function regionOverlapRatio(a, b) {
  const overlapA = boxOverlapRatio(a, b);
  const overlapB = boxOverlapRatio(b, a);
  return Math.min(overlapA, overlapB);
}

function inferVisualHorizontalBounds(page, captionBlock, pageWidth) {
  const blocks = Array.isArray(page.blocks) ? page.blocks : [];
  const content = getContentBounds(blocks, pageWidth);
  const captionColumn = Number(captionBlock.column || 0);
  const captionBox = pickBlockBox(captionBlock);

  if (captionColumn === 1 || captionColumn === 2) {
    const columnBlocks = blocks.filter((block) => Number(block.column || 0) === captionColumn);
    const columnBounds = getContentBounds(columnBlocks, pageWidth);
    return expandHorizontalBounds(columnBounds, pageWidth, pageWidth * 0.015);
  }

  if (captionBox) {
    const captionCenter = captionBox.x + captionBox.width / 2;
    const contentCenter = content.x + content.width / 2;
    const looksSingleColumnCaption = captionBox.width < content.width * 0.58 ||
      (captionBox.width < content.width * 0.68 && Number(captionBlock.lineCount || 1) <= 3);
    if (looksSingleColumnCaption) {
      const inferredColumn = captionCenter < contentCenter ? 1 : 2;
      const columnBlocks = getLikelyColumnBlocks(blocks, content, inferredColumn);
      const columnBounds = getContentBounds(columnBlocks, pageWidth);
      return expandHorizontalBounds(columnBounds, pageWidth, pageWidth * 0.015);
    }
  }

  return expandHorizontalBounds(content, pageWidth, pageWidth * 0.02);
}

function getLikelyColumnBlocks(blocks, content, column) {
  const midpoint = content.x + content.width / 2;
  const explicit = blocks.filter((block) => Number(block.column || 0) === column);
  if (explicit.length >= 3) {
    return explicit;
  }

  const inferred = blocks.filter((block) => {
    const box = pickBlockBox(block);
    if (!box) {
      return false;
    }

    const center = box.x + box.width / 2;
    return column === 1 ? center < midpoint : center >= midpoint;
  });

  return inferred.length ? inferred : blocks;
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

function refineCropWithPagePixels(page, crop, visualType = "") {
  if (!crop || !page?.imagePath) {
    return crop;
  }

  const normalized = normalizeCrop(crop);
  const pageWidth = Number(normalized.pageWidth || page.width || 0);
  const pageHeight = Number(normalized.pageHeight || page.height || 0);
  if (!pageWidth || !pageHeight) {
    return normalized;
  }

  const pixels = getPagePixelData(page);
  if (!pixels) {
    return normalized;
  }

  const scaleX = pixels.width / pageWidth;
  const scaleY = pixels.height / pageHeight;
  const left = clampInteger(Math.floor(normalized.x * scaleX), 0, pixels.width - 1);
  const top = clampInteger(Math.floor(normalized.y * scaleY), 0, pixels.height - 1);
  const right = clampInteger(Math.ceil((normalized.x + normalized.width) * scaleX), left + 1, pixels.width);
  const bottom = clampInteger(Math.ceil((normalized.y + normalized.height) * scaleY), top + 1, pixels.height);

  let minX = right;
  let minY = bottom;
  let maxX = left;
  let maxY = top;
  let inkPixels = 0;
  for (let y = top; y < bottom; y += 1) {
    const rowOffset = y * pixels.rowBytes;
    for (let x = left; x < right; x += 1) {
      const offset = rowOffset + x * pixels.channels;
      if (!isInkPixel(pixels, offset)) {
        continue;
      }

      inkPixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (inkPixels < getMinimumInkPixels(visualType)) {
    return normalized;
  }

  const padding = getPixelRefinementPadding(visualType);
  const refinedLeft = clampInteger(minX - padding.x, left, right - 1);
  const refinedTop = clampInteger(minY - padding.y, top, bottom - 1);
  const refinedRight = clampInteger(maxX + 1 + padding.x, refinedLeft + 1, right);
  const refinedBottom = clampInteger(maxY + 1 + padding.y, refinedTop + 1, bottom);
  const refined = normalizeCrop({
    x: refinedLeft / scaleX,
    y: refinedTop / scaleY,
    width: (refinedRight - refinedLeft) / scaleX,
    height: (refinedBottom - refinedTop) / scaleY,
    pageWidth,
    pageHeight,
  });

  if (!shouldAcceptPixelRefinement(normalized, refined, visualType, inkPixels)) {
    return normalized;
  }

  return {
    ...refined,
    pixelRefined: true,
  };
}

function getPagePixelData(page) {
  const filePath = getAssetPathFromPublicPath(page?.imagePath);
  if (!filePath) {
    return null;
  }

  if (pagePixelCache.has(filePath)) {
    return pagePixelCache.get(filePath);
  }

  let pixels = null;
  try {
    pixels = decodePng(readFileSync(filePath));
  } catch {
    pixels = null;
  }

  if (pagePixelCache.size > 24) {
    pagePixelCache.clear();
  }
  pagePixelCache.set(filePath, pixels);
  return pixels;
}

function decodePng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33 ||
    buffer.readUInt32BE(0) !== 0x89504e47 || buffer.readUInt32BE(4) !== 0x0d0a1a0a) {
    return null;
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let palette = null;
  let transparency = null;
  const idatChunks = [];

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) {
      return null;
    }

    if (type === "IHDR") {
      width = buffer.readUInt32BE(dataStart);
      height = buffer.readUInt32BE(dataStart + 4);
      bitDepth = buffer[dataStart + 8];
      colorType = buffer[dataStart + 9];
    } else if (type === "PLTE") {
      palette = buffer.subarray(dataStart, dataEnd);
    } else if (type === "tRNS") {
      transparency = buffer.subarray(dataStart, dataEnd);
    } else if (type === "IDAT") {
      idatChunks.push(buffer.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      break;
    }

    offset = dataEnd + 4;
  }

  const channels = getPngChannelCount(colorType);
  if (!width || !height || bitDepth !== 8 || !channels || !idatChunks.length) {
    return null;
  }

  const rowBytes = width * channels;
  const raw = inflateSync(Buffer.concat(idatChunks));
  const data = new Uint8Array(height * rowBytes);
  let rawOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset];
    rawOffset += 1;
    const rowStart = y * rowBytes;
    const prevRowStart = y > 0 ? rowStart - rowBytes : -1;
    for (let x = 0; x < rowBytes; x += 1) {
      const rawValue = raw[rawOffset + x];
      const left = x >= channels ? data[rowStart + x - channels] : 0;
      const up = prevRowStart >= 0 ? data[prevRowStart + x] : 0;
      const upLeft = prevRowStart >= 0 && x >= channels ? data[prevRowStart + x - channels] : 0;
      data[rowStart + x] = unfilterPngByte(filter, rawValue, left, up, upLeft);
    }
    rawOffset += rowBytes;
  }

  return {
    width,
    height,
    colorType,
    channels,
    rowBytes,
    data,
    palette,
    transparency,
  };
}

function getPngChannelCount(colorType) {
  if (colorType === 0 || colorType === 3) {
    return 1;
  }
  if (colorType === 2) {
    return 3;
  }
  if (colorType === 4) {
    return 2;
  }
  if (colorType === 6) {
    return 4;
  }
  return 0;
}

function unfilterPngByte(filter, value, left, up, upLeft) {
  if (filter === 0) {
    return value;
  }
  if (filter === 1) {
    return (value + left) & 0xff;
  }
  if (filter === 2) {
    return (value + up) & 0xff;
  }
  if (filter === 3) {
    return (value + Math.floor((left + up) / 2)) & 0xff;
  }
  if (filter === 4) {
    return (value + paethPredictor(left, up, upLeft)) & 0xff;
  }
  return value;
}

function paethPredictor(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const distanceLeft = Math.abs(estimate - left);
  const distanceUp = Math.abs(estimate - up);
  const distanceUpLeft = Math.abs(estimate - upLeft);
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) {
    return left;
  }
  return distanceUp <= distanceUpLeft ? up : upLeft;
}

function isInkPixel(pixels, offset) {
  let red = 255;
  let green = 255;
  let blue = 255;
  let alpha = 255;

  if (pixels.colorType === 0) {
    red = green = blue = pixels.data[offset];
  } else if (pixels.colorType === 2) {
    red = pixels.data[offset];
    green = pixels.data[offset + 1];
    blue = pixels.data[offset + 2];
  } else if (pixels.colorType === 3) {
    const paletteIndex = pixels.data[offset];
    const paletteOffset = paletteIndex * 3;
    if (!pixels.palette || paletteOffset + 2 >= pixels.palette.length) {
      return false;
    }
    red = pixels.palette[paletteOffset];
    green = pixels.palette[paletteOffset + 1];
    blue = pixels.palette[paletteOffset + 2];
    alpha = pixels.transparency?.[paletteIndex] ?? 255;
  } else if (pixels.colorType === 4) {
    red = green = blue = pixels.data[offset];
    alpha = pixels.data[offset + 1];
  } else if (pixels.colorType === 6) {
    red = pixels.data[offset];
    green = pixels.data[offset + 1];
    blue = pixels.data[offset + 2];
    alpha = pixels.data[offset + 3];
  }

  if (alpha < 16) {
    return false;
  }

  const maxChannel = Math.max(red, green, blue);
  const minChannel = Math.min(red, green, blue);
  return maxChannel < 246 || maxChannel - minChannel > 18;
}

function getMinimumInkPixels(visualType) {
  if (visualType === "formula") {
    return 12;
  }
  if (visualType === "code") {
    return 28;
  }
  return 48;
}

function getPixelRefinementPadding(visualType) {
  if (visualType === "formula") {
    return { x: 8, y: 6 };
  }
  if (visualType === "code") {
    return { x: 10, y: 8 };
  }
  if (visualType === "table") {
    return { x: 14, y: 12 };
  }
  return { x: 12, y: 10 };
}

function shouldAcceptPixelRefinement(original, refined, visualType, inkPixels) {
  const area = Math.max(1, original.width * original.height);
  const refinedArea = Math.max(1, refined.width * refined.height);
  const widthRatio = refined.width / Math.max(1, original.width);
  const heightRatio = refined.height / Math.max(1, original.height);
  const inkDensity = inkPixels / area;

  if (refined.width < 4 || refined.height < 4) {
    return false;
  }
  if (visualType === "formula") {
    return widthRatio >= 0.04 && heightRatio >= 0.035 && inkDensity >= 0.0002;
  }
  if (visualType === "code") {
    return widthRatio >= 0.08 && heightRatio >= 0.05 && inkDensity >= 0.00035;
  }
  if (visualType === "table") {
    return widthRatio >= 0.18 && heightRatio >= 0.08 && refinedArea >= area * 0.015;
  }
  return widthRatio >= 0.12 && heightRatio >= 0.08 && refinedArea >= area * 0.012;
}

function clampInteger(value, min, max) {
  return Math.trunc(clampNumber(value, min, max));
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

function readIntegerEnv(name, defaultValue, min, max) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) {
    return defaultValue;
  }

  return Math.trunc(clampNumber(value, min, max));
}

async function buildHealthPayload(req = null) {
  await syncJobsFromDisk();
  const versionStatus = await getServiceVersionStatus();
  const queueStatus = getJobQueueStatus();
  const uptimeSeconds = Math.round(process.uptime());
  const startedAt = new Date(SERVICE_STARTED_AT_MS).toISOString();
  return {
    ok: true,
    name: "PaperLens",
    version: PACKAGE_VERSION,
    serviceSchemaVersion: SERVICE_SCHEMA_VERSION,
    pdfEngine: PDF_ENGINE,
    uptimeSeconds,
    startedAt,
    runtime: {
      pid: process.pid,
      nodeVersion: process.version,
      host: HOST,
      port: PORT,
      rootDir: __dirname,
      pdfEngine: PDF_ENGINE,
      startedAt,
      uptimeSeconds,
    },
    queue: queueStatus,
    security: buildAuthStatus(req),
    persistence: buildPersistenceStatus(),
    resourceLimits: getResourceLimitsStatus(),
    ...versionStatus,
  };
}

function buildPersistenceStatus() {
  return {
    storage: "json",
    atomicWrites: true,
    backupEnabled: JSON_BACKUP_RETENTION > 0,
    backupDir: DATA_BACKUP_DIR,
    backupRetention: JSON_BACKUP_RETENTION,
    backupMinIntervalSeconds: Math.round(JSON_BACKUP_MIN_INTERVAL_MS / 1000),
    recovery: "newest-valid-backup",
    secretsBackedUp: Boolean(SECRET_ENCRYPTION_KEY && JSON_BACKUP_RETENTION > 0),
  };
}

function getResourceLimitsStatus() {
  return {
    analysis: {
      maxParagraphs: MAX_ANALYSIS_JOB_PARAGRAPHS,
      maxChars: MAX_ANALYSIS_JOB_CHARS,
      maxApproxTokens: approximateTokenCount(MAX_ANALYSIS_JOB_CHARS),
    },
    segmentation: {
      maxPages: MAX_AI_SEGMENTATION_PAGES,
    },
    ocr: {
      maxPages: MAX_OCR_JOB_PAGES,
    },
    visualRebuild: {
      maxPapers: MAX_VISUAL_REBUILD_PAPERS,
      maxPages: MAX_VISUAL_REBUILD_PAGES,
    },
  };
}

async function getServiceVersionStatus() {
  const serverSourceMtimeMs = await getFileMtimeMs(__filename);
  const staticAssetMtimeMs = await getMaxFileMtimeMs(SERVICE_STATIC_ASSET_PATHS);
  const needsRestart = serverSourceMtimeMs > SERVICE_STARTED_AT_MS + 1000;
  return {
    serverSourceMtimeMs,
    staticAssetMtimeMs,
    serviceBuildId: `${PACKAGE_VERSION}:${Math.round(serverSourceMtimeMs)}`,
    needsRestart,
    restartReason: needsRestart
      ? "server.js 已在服务启动后更新，请重启 PaperLens 后端。"
      : "",
    source: {
      serverSourceMtimeMs,
      staticAssetMtimeMs,
      serviceBuildId: `${PACKAGE_VERSION}:${Math.round(serverSourceMtimeMs)}`,
      needsRestart,
      restartReason: needsRestart
        ? "server.js 已在服务启动后更新，请重启 PaperLens 后端。"
        : "",
    },
  };
}

function getJobQueueStatus() {
  const jobs = [...jobStore.jobs.values()];
  const activeJobs = jobs.filter((job) => isActiveJobStatus(job.status));
  const queuedJobs = jobs.filter((job) => job.status === "queued");
  const runningJobs = jobs.filter((job) => job.status === "running");
  const cancelingJobs = jobs.filter((job) => job.status === "canceling");
  const activeJob = jobStore.activeJobId
    ? jobStore.jobs.get(jobStore.activeJobId)
    : runningJobs[0] || cancelingJobs[0] || queuedJobs[0] || null;
  const latestJob = jobs
    .slice()
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))[0] || null;

  return {
    schemaVersion: 1,
    workerScheduled: jobStore.workerScheduled,
    activeJobId: jobStore.activeJobId || "",
    activeJob: activeJob ? serializeJobSummary(activeJob) : null,
    activeJobs: activeJobs.length,
    queuedJobs: queuedJobs.length,
    runningJobs: runningJobs.length,
    cancelingJobs: cancelingJobs.length,
    savedJobs: jobs.length,
    activeItems: countJobItems(activeJobs),
    lastUpdatedAt: latestJob?.updatedAt || latestJob?.createdAt || "",
  };
}

function countJobItems(jobs) {
  const counts = {
    total: 0,
    queued: 0,
    running: 0,
    done: 0,
    error: 0,
    canceled: 0,
  };

  for (const job of jobs) {
    for (const item of job.items || []) {
      counts.total += 1;
      if (Object.hasOwn(counts, item.status)) {
        counts[item.status] += 1;
      }
    }
  }

  return counts;
}

async function getFileMtimeMs(filePath) {
  try {
    return (await stat(filePath)).mtimeMs;
  } catch {
    return 0;
  }
}

async function getMaxFileMtimeMs(filePaths) {
  const mtimes = await Promise.all(filePaths.map((filePath) => getFileMtimeMs(filePath)));
  return Math.max(0, ...mtimes);
}

function classifyPageArtifact(block) {
  const text = normalizeArtifactText(block?.text || "");
  if (!text) {
    return "";
  }

  if (isLikelyCaptionBlockText(text)) {
    return "caption";
  }

  if (isLikelyCodeBlock(text, block)) {
    return "code";
  }

  if (isLikelyFormulaBlock(text, block)) {
    return "formula";
  }

  if (isLikelyFigureTextBlock(text, block)) {
    return "figure-text";
  }

  if (isLikelyTableBodyBlockText(text, block)) {
    return "figure-text";
  }

  return "";
}

function isLikelyFormulaBlock(text, block = {}) {
  return isLikelyFormulaBlockText(text, block);
}

function isLikelyCodeBlock(text, block = {}) {
  return isLikelyCodeBlockText(text, block);
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
  return extractSegmentationTextBlocks(text);
}

function normalizeParagraph(text) {
  return String(text || "")
    .replace(/^(?:Figure|Fig\.|Table)\s+\d+[a-z]?\s*:[^.!?。！？]*(?:[.!?。！？]|$)/i, " ")
    .replace(/\s+(?:Figure|Fig\.|Table)\s+\d+[a-z]?\s*:[^.!?。！？]*(?:[.!?。！？]|$)/gi, " ")
    .replace(/[ \t]*\n[ \t]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeReadableBlockText(text) {
  return normalizeSegmentationReadableBlockText(text);
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
  let currentSectionTitle = "";

  for (const paragraph of paragraphs) {
    const hintedTitle = normalizeSectionTitleHint(paragraph.sectionTitleHint || "");
    if (paragraph.kind === "heading" || isLikelyHeading(paragraph.sourceText)) {
      currentSectionId = `section_${sections.length}`;
      currentSectionTitle = normalizeSectionTitleHint(paragraph.sourceText);
      sections.push({
        id: currentSectionId,
        title: paragraph.sourceText,
        level: 1,
        order: sections.length,
        summary: "",
      });
    } else if (hintedTitle && hintedTitle !== currentSectionTitle) {
      currentSectionId = `section_${sections.length}`;
      currentSectionTitle = hintedTitle;
      sections.push({
        id: currentSectionId,
        title: hintedTitle,
        level: 1,
        order: sections.length,
        summary: "",
        source: "ai-segmentation",
      });
    }

    paragraph.sectionId = currentSectionId;
  }

  return sections;
}

function enrichSectionsWithContext(sections, paragraphs, chunkSummaries = []) {
  for (const section of sections) {
    const sectionParagraphs = paragraphs.filter((paragraph) =>
      paragraph.sectionId === section.id && isReadingParagraph(paragraph, section));
    const pageStart = Math.min(...sectionParagraphs.map((paragraph) => Number(paragraph.pageNumber || 0)).filter(Boolean));
    const pageEnd = Math.max(...sectionParagraphs.map((paragraph) => Number(paragraph.pageEndNumber || paragraph.pageNumber || 0)).filter(Boolean));
    const keywords = [];
    for (const paragraph of sectionParagraphs) {
      const paragraphKeywords = [
        ...normalizeKeywordList(paragraph.contextKeywords),
        ...normalizeKeywordList(paragraph.keyTerms),
      ];
      for (const keyword of paragraphKeywords) {
        pushUnique(keywords, keyword);
      }
      if (keywords.length >= 14) {
        break;
      }
    }

    const overlappingSummaries = chunkSummaries
      .filter((summary) => summaryOverlapsPages(summary.pages, pageStart, pageEnd))
      .map((summary) => summary.summary)
      .filter(Boolean);

    section.pageStart = Number.isFinite(pageStart) ? pageStart : null;
    section.pageEnd = Number.isFinite(pageEnd) ? pageEnd : null;
    section.keywords = keywords.slice(0, 12);
    section.summary = truncateText(
      overlappingSummaries[0] || buildHeuristicSectionSummary(sectionParagraphs),
      SECTION_CONTEXT_TEXT_LIMIT,
    );
  }
}

function summaryOverlapsPages(pageRangeLabel, pageStart, pageEnd) {
  if (!Number.isFinite(pageStart) || !Number.isFinite(pageEnd)) {
    return false;
  }

  const match = String(pageRangeLabel || "").match(/p\.(\d+)(?:-(\d+))?/);
  if (!match) {
    return false;
  }

  const start = Number(match[1]);
  const end = Number(match[2] || match[1]);
  return start <= pageEnd && end >= pageStart;
}

function buildHeuristicSectionSummary(paragraphs) {
  const first = paragraphs.find((paragraph) =>
    paragraph.sourceText && paragraph.sourceText.length > 40 && isReadingParagraph(paragraph));
  if (!first) {
    return "";
  }

  return `开头内容: ${truncateText(first.sourceText, 420)}`;
}

function buildPaperContextProfile(paragraphs, sections, chunkSummaries = [], structureMap = null, paperMemory = null) {
  const sectionById = new Map((sections || []).map((section) => [section.id, section]));
  const readingParagraphs = paragraphs.filter((paragraph) =>
    isReadingParagraph(paragraph, sectionById.get(paragraph.sectionId)));
  const keywords = [];
  for (const keyword of normalizeKeywordList(paperMemory?.keyTerms)) {
    pushUnique(keywords, keyword);
  }
  for (const summary of chunkSummaries) {
    for (const keyword of normalizeKeywordList(summary.keywords)) {
      pushUnique(keywords, keyword);
    }
  }

  for (const section of sections) {
    for (const keyword of normalizeKeywordList(section.keywords)) {
      pushUnique(keywords, keyword);
    }
  }

  const summaryText = [
    paperMemory?.summary || "",
    paperMemory?.mainThread || "",
    structureMap?.summary || "",
    ...chunkSummaries.map((summary) => summary.summary),
  ]
    .filter(Boolean)
    .slice(0, 6)
    .join(" ");

  return {
    version: 1,
    summary: truncateText(summaryText || buildHeuristicSectionSummary(readingParagraphs), 900),
    keywords: keywords.slice(0, 24),
    structureVersion: structureMap?.version || null,
    updatedAt: new Date().toISOString(),
  };
}

function inferTitle(paragraphs, filename) {
  const firstLongText = paragraphs
    .slice(0, 5)
    .filter((item) => item.kind === "heading" || !isLikelyNonReadingParagraphText(item.sourceText || "", item))
    .map((item) => item.sourceText)
    .find((text) => text.length >= 20 && text.length <= 180);

  return firstLongText || filename.replace(/\.pdf$/i, "");
}

function inferTitleFromPages(pages, paragraphs, filename) {
  const firstPage = (pages || []).find((page) => Number(page?.pageNumber || 0) === 1) || pages?.[0];
  const blocks = Array.isArray(firstPage?.blocks) ? firstPage.blocks : [];
  const titleBlock = blocks
    .map((block) => ({
      ...block,
      text: normalizeReadableBlockText(block?.text || ""),
      pageNumber: firstPage?.pageNumber || 1,
    }))
    .find((block) => isLikelyFrontMatterTitleText(block.text, block));

  return titleBlock?.text || inferTitle(paragraphs, filename);
}

async function buildPaperStructureMapWithAi(paper, pages, settings, options = {}) {
  if (isClaudeAgentSettings(settings) && !CLAUDE_SEGMENTATION_STRUCTURE_SCAN) {
    return {
      ...buildHeuristicPaperStructureMap(paper, pages),
      fallbackReason: "claude-agent-structure-scan-skipped",
    };
  }

  const pageOutline = buildStructureScanInput(pages, {
    totalLimit: isClaudeAgentSettings(settings)
      ? CLAUDE_SEGMENTATION_STRUCTURE_INPUT_LIMIT
      : SEGMENTATION_STRUCTURE_INPUT_LIMIT,
  });
  if (!pageOutline) {
    return buildHeuristicPaperStructureMap(paper, pages);
  }

  const messages = [
    {
      role: "system",
      content: [
        "你是论文 PDF 全文结构预扫描助手。你的任务不是分段，而是先给后续分段提供全局地图。",
        "必须只依据页面文本判断，不要翻译正文，不要补写论文内容。",
        "请识别正文起点、References 起点、章节边界，以及作者/单位/版权/DOI/URL/页眉页脚/图表区域等非正文线索。",
        "只输出合法 JSON，不要使用 Markdown 代码块。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `论文文件: ${paper.filename || paper.title || "未知论文"}`,
        "",
        "请根据下面按页抽取的文本，输出全文结构地图。",
        "输出格式必须是：",
        "{",
        '  "paperTitle": "论文标题",',
        '  "summary": "一句中文概括全文结构和主题，不超过 120 字",',
        '  "bodyStartPage": 1,',
        '  "referencesStartPage": 12,',
        '  "keywords": ["术语1", "术语2"],',
        '  "sections": [',
        '    { "title": "Abstract", "startPage": 1, "endPage": 1 },',
        '    { "title": "Introduction", "startPage": 1, "endPage": 2 }',
        "  ],",
        '  "segmentationPlan": [',
        '    { "id": "planned_section_1", "title": "Abstract", "startPage": 1, "endPage": 1, "role": "abstract", "boundaryHint": "摘要正文，不含作者单位" },',
        '    { "id": "planned_section_2", "title": "Introduction", "startPage": 1, "endPage": 2, "role": "background", "boundaryHint": "从 Introduction 标题开始，到下一章节标题前结束" }',
        "  ],",
        '  "nonBodyZones": [',
        '    { "type": "authors", "label": "作者和单位", "startPage": 1, "endPage": 1, "description": "标题下方作者、邮箱和单位区域" },',
        '    { "type": "references", "label": "参考文献", "startPage": 12, "endPage": 14, "description": "References 之后的参考文献列表" }',
        "  ]",
        "}",
        "",
        "注意：sections 和 segmentationPlan 只列正文阅读结构，不要把作者、版权、DOI、图注、表格、参考文献条目列为章节。",
        "segmentationPlan 是后续局部分段必须遵守的全文章节计划；id 必须稳定、简短、唯一。",
        "",
        "页面文本:",
        pageOutline,
      ].join("\n"),
    },
  ];

  try {
    const content = await callModel(settings, messages, {
      signal: options.signal,
      maxTokens: 3200,
      timeoutMs: SEGMENTATION_STRUCTURE_TIMEOUT_MS,
    });
    const parsed = parseModelJson(content);
    return normalizePaperStructureMap(parsed, paper, pages);
  } catch (error) {
    if (options.signal?.aborted || error.statusCode === 499 || !isRecoverableSegmentationPlanError(error)) {
      throw error;
    }

    return {
      ...buildHeuristicPaperStructureMap(paper, pages),
      fallbackReason: error.message || "structure-map-failed",
    };
  }
}

function buildStructureScanInput(pages, options = {}) {
  const readablePages = (pages || []).filter((page) => page && Number.isFinite(Number(page.pageNumber)));
  if (!readablePages.length) {
    return "";
  }

  const totalLimit = Math.max(4000, Number(options.totalLimit || SEGMENTATION_STRUCTURE_INPUT_LIMIT));
  const perPageLimit = Math.max(
    240,
    Math.min(SEGMENTATION_STRUCTURE_PAGE_LIMIT, Math.floor(totalLimit / readablePages.length) - 48),
  );
  const lines = [];
  let totalLength = 0;
  for (const page of readablePages) {
    const pageText = buildStructurePageOutline(page, perPageLimit);
    if (!pageText) {
      continue;
    }

    const entry = [
      `--- Page ${page.pageNumber} ---`,
      truncateText(pageText, perPageLimit),
    ].join("\n");
    if (totalLength + entry.length > totalLimit) {
      break;
    }

    lines.push(entry);
    totalLength += entry.length;
  }

  return lines.join("\n\n");
}

function isRecoverableSegmentationPlanError(error) {
  const message = String(error?.message || "");
  return /超时|timeout|timed out|没有返回可解析|JSON|Unexpected|parse|格式/i.test(message);
}

function buildStructurePageOutline(page, limit = SEGMENTATION_STRUCTURE_PAGE_LIMIT) {
  const blocks = Array.isArray(page.blocks) ? page.blocks : [];
  if (blocks.length) {
    const normalizedBlocks = blocks
      .map((block, index) => ({
        index,
        text: normalizeArtifactText(block.text || ""),
      }))
      .filter((block) => block.text);
    const selected = normalizedBlocks.filter((block) =>
      block.index < 4 ||
      block.index >= normalizedBlocks.length - 3 ||
      isLikelyStructureOutlineText(block.text));
    const outlineBlocks = selected.length ? selected : normalizedBlocks.slice(0, 6);
    return truncateText(outlineBlocks
      .map((block) => `[B${block.index + 1}] ${truncateText(block.text, 280)}`)
      .join("\n"), limit);
  }

  return truncateText(normalizeArtifactText(page.text || ""), limit);
}

function isLikelyStructureOutlineText(text) {
  const clean = normalizeParagraph(text);
  if (!clean) {
    return false;
  }

  if (isLikelyHeading(clean)) {
    return true;
  }

  return /abstract|introduction|background|method|experiment|result|discussion|conclusion|appendix|reference|bibliography|acknowledg/i
    .test(clean);
}

function normalizePaperStructureMap(parsed, paper, pages) {
  const data = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  const pageNumbers = (pages || []).map((page) => Number(page.pageNumber)).filter(Number.isFinite);
  const firstPage = pageNumbers.length ? Math.min(...pageNumbers) : 1;
  const lastPage = pageNumbers.length ? Math.max(...pageNumbers) : firstPage;
  const sections = normalizeStructureSections(data.sections, firstPage, lastPage);
  const referencesStartPage = normalizePageNumber(
    data.referencesStartPage || data.referencesPage || data.bibliographyStartPage,
    firstPage,
    lastPage,
    null,
  );
  const nonBodyZones = normalizeStructureZones(data.nonBodyZones || data.nonBodyRanges || [], firstPage, lastPage);
  if (referencesStartPage && !nonBodyZones.some((zone) => zone.type === "references")) {
    nonBodyZones.push({
      type: "references",
      label: "参考文献",
      startPage: referencesStartPage,
      endPage: lastPage,
      description: "References/Bibliography 之后的参考文献区域",
    });
  }
  const segmentationPlan = normalizeSegmentationPlan(
    data.segmentationPlan || data.sectionPlan || data.paragraphPlan,
    sections,
    firstPage,
    lastPage,
  );

  return {
    version: 1,
    paperTitle: normalizeParagraph(data.paperTitle || data.title || paper.title || paper.filename || ""),
    summary: truncateText(normalizeParagraph(data.summary || ""), 240),
    bodyStartPage: normalizePageNumber(data.bodyStartPage, firstPage, lastPage, firstPage),
    referencesStartPage,
    keywords: normalizeKeywordList(data.keywords || data.keyTerms).slice(0, 18),
    sections,
    segmentationPlan,
    segmentationPlanVersion: SEGMENTATION_PLAN_VERSION,
    nonBodyZones,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeStructureSections(sections, firstPage, lastPage) {
  if (!Array.isArray(sections)) {
    return [];
  }

  return sections
    .map((section) => {
      const title = normalizeSectionTitleHint(section.title || section.sectionTitle || section.name || "");
      if (!title || isReferencesSectionTitle(title)) {
        return null;
      }

      const startPage = normalizePageNumber(section.startPage || section.pageNumber, firstPage, lastPage, firstPage);
      const endPage = normalizePageNumber(section.endPage || section.pageEndNumber, firstPage, lastPage, startPage);
      return {
        title,
        startPage,
        endPage: Math.max(startPage, endPage),
      };
    })
    .filter(Boolean)
    .filter((section, index, all) =>
      all.findIndex((item) => item.title.toLowerCase() === section.title.toLowerCase() &&
        item.startPage === section.startPage) === index)
    .slice(0, 32);
}

function normalizeSegmentationPlan(plan, sections, firstPage, lastPage) {
  const sourcePlan = Array.isArray(plan) && plan.length
    ? plan
    : buildSegmentationPlanFromSections(sections, firstPage, lastPage);
  const normalized = [];

  for (const [index, entry] of sourcePlan.entries()) {
    const matchedSection = findMatchingStructureSection(entry, sections);
    const title = normalizeSectionTitleHint(
      entry.title || entry.sectionTitle || entry.name || matchedSection?.title || "",
    );
    if (!title || isReferencesSectionTitle(title)) {
      continue;
    }

    const startPage = normalizePageNumber(
      entry.startPage || entry.pageNumber || matchedSection?.startPage,
      firstPage,
      lastPage,
      matchedSection?.startPage || firstPage,
    );
    const endPage = normalizePageNumber(
      entry.endPage || entry.pageEndNumber || matchedSection?.endPage,
      firstPage,
      lastPage,
      matchedSection?.endPage || startPage,
    );
    const fallbackId = `planned_section_${normalized.length + 1}`;
    const id = normalizeSegmentationPlanId(entry.id || entry.planId || fallbackId, fallbackId);

    normalized.push({
      id,
      title,
      startPage,
      endPage: Math.max(startPage, endPage),
      role: normalizeSegmentationRole(entry.role || entry.kind || inferSegmentationRoleFromTitle(title)),
      boundaryHint: truncateText(normalizeParagraph(entry.boundaryHint || entry.description || entry.note || ""), 180),
      order: normalized.length,
    });
  }

  const deduped = [];
  for (const section of normalized) {
    const duplicate = deduped.some((item) =>
      item.title.toLowerCase() === section.title.toLowerCase() && item.startPage === section.startPage);
    if (!duplicate) {
      const repeatedId = deduped.some((item) => item.id === section.id);
      deduped.push({
        ...section,
        id: repeatedId
          ? `planned_section_${deduped.length + 1}`
          : normalizeSegmentationPlanId(section.id, `planned_section_${deduped.length + 1}`),
        order: deduped.length,
      });
    }
  }

  return deduped.length ? deduped.slice(0, 32) : buildSegmentationPlanFromSections([], firstPage, lastPage);
}

function buildSegmentationPlanFromSections(sections, firstPage, lastPage) {
  const validSections = Array.isArray(sections) ? sections.filter((section) => section?.title) : [];
  if (!validSections.length) {
    return [{
      id: "planned_section_1",
      title: "正文",
      startPage: firstPage,
      endPage: lastPage,
      role: "",
      boundaryHint: "按论文正文自然段阅读，不含作者、链接、图表和参考文献。",
    }];
  }

  return validSections.map((section, index) => ({
    id: `planned_section_${index + 1}`,
    title: section.title,
    startPage: section.startPage || firstPage,
    endPage: section.endPage || section.startPage || lastPage,
    role: inferSegmentationRoleFromTitle(section.title),
    boundaryHint: "",
  }));
}

function findMatchingStructureSection(entry, sections) {
  if (!entry || !Array.isArray(sections) || !sections.length) {
    return null;
  }

  const title = normalizeSectionTitleHint(entry.title || entry.sectionTitle || entry.name || "");
  if (title) {
    const matchedByTitle = sections.find((section) =>
      section.title.toLowerCase() === title.toLowerCase());
    if (matchedByTitle) {
      return matchedByTitle;
    }
  }

  const pageNumber = Number(entry.startPage || entry.pageNumber || 0);
  if (Number.isFinite(pageNumber) && pageNumber > 0) {
    return sections.find((section) =>
      pageNumber >= Number(section.startPage || 0) &&
      pageNumber <= Number(section.endPage || section.startPage || 0)) || null;
  }

  return null;
}

function normalizeSegmentationPlanId(value, fallback = "") {
  const clean = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  if (!clean || /^\d/.test(clean)) {
    return fallback;
  }
  return clean;
}

function inferSegmentationRoleFromTitle(title) {
  const clean = String(title || "").toLowerCase();
  if (/abstract|摘要/.test(clean)) {
    return "abstract";
  }
  if (/introduction|background|related work|motivation|背景|引言|相关/.test(clean)) {
    return "background";
  }
  if (/method|approach|design|architecture|system|algorithm|方法|设计|架构|系统/.test(clean)) {
    return "method";
  }
  if (/experiment|evaluation|result|analysis|实验|评估|结果|分析/.test(clean)) {
    return "result";
  }
  if (/discussion|limitation|讨论|局限/.test(clean)) {
    return "discussion";
  }
  if (/conclusion|future|总结|结论|未来/.test(clean)) {
    return "conclusion";
  }
  return "";
}

function normalizeStructureZones(zones, firstPage, lastPage) {
  if (!Array.isArray(zones)) {
    return [];
  }

  return zones
    .map((zone) => {
      const type = normalizeStructureZoneType(zone.type || zone.kind || zone.label);
      const startPage = normalizePageNumber(zone.startPage || zone.pageNumber, firstPage, lastPage, firstPage);
      const endPage = normalizePageNumber(zone.endPage || zone.pageEndNumber, firstPage, lastPage, startPage);
      return {
        type,
        label: normalizeParagraph(zone.label || type || "非正文区域"),
        startPage,
        endPage: Math.max(startPage, endPage),
        description: truncateText(normalizeParagraph(zone.description || zone.note || ""), 160),
      };
    })
    .filter((zone) => zone.type)
    .slice(0, 32);
}

function normalizeStructureZoneType(value) {
  const clean = String(value || "").trim().toLowerCase();
  if (/author|affiliation|email|作者|单位|邮箱/.test(clean)) {
    return "authors";
  }
  if (/reference|bibliography|参考/.test(clean)) {
    return "references";
  }
  if (/copyright|doi|metadata|conference|license|版权|元数据/.test(clean)) {
    return "metadata";
  }
  if (/header|footer|页眉|页脚/.test(clean)) {
    return "header-footer";
  }
  if (/figure|table|caption|图|表/.test(clean)) {
    return "figure-table";
  }
  return clean ? "other" : "";
}

function normalizePageNumber(value, firstPage, lastPage, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }

  return Math.trunc(clampNumber(number, firstPage, lastPage));
}

function buildHeuristicPaperStructureMap(paper, pages) {
  const pageNumbers = (pages || []).map((page) => Number(page.pageNumber)).filter(Number.isFinite);
  const firstPage = pageNumbers.length ? Math.min(...pageNumbers) : 1;
  const lastPage = pageNumbers.length ? Math.max(...pageNumbers) : firstPage;
  const referencesStartPage = inferReferencesStartPageFromPages(pages, firstPage, lastPage);
  const bodyEndPage = referencesStartPage
    ? Math.max(firstPage, referencesStartPage - 1)
    : lastPage;
  const nonBodyZones = referencesStartPage
    ? [{
        type: "references",
        label: "参考文献",
        startPage: referencesStartPage,
        endPage: lastPage,
        description: "本地版面扫描识别到 References/Bibliography 起点。",
      }]
    : [];
  const sections = inferHeuristicStructureSectionsFromPages(pages, {
    firstPage,
    lastPage,
    referencesStartPage,
    bodyEndPage,
  });
  return {
    version: 1,
    paperTitle: paper.title || paper.filename || "",
    summary: "",
    bodyStartPage: firstPage,
    referencesStartPage,
    keywords: [],
    sections,
    segmentationPlan: buildSegmentationPlanFromSections(sections, firstPage, bodyEndPage),
    segmentationPlanVersion: SEGMENTATION_PLAN_VERSION,
    nonBodyZones,
    updatedAt: new Date().toISOString(),
  };
}

function inferReferencesStartPageFromPages(pages, firstPage, lastPage) {
  for (const page of pages || []) {
    const pageNumber = normalizePageNumber(page?.pageNumber, firstPage, lastPage, null);
    if (!pageNumber) {
      continue;
    }

    const blocks = Array.isArray(page.blocks) ? page.blocks : [];
    if (blocks.some((block) => isReferencesHeadingBlock(block))) {
      return pageNumber;
    }

    const text = String(page.text || "");
    if (text.split(/\n+/).some((line) => isReferencesSectionTitle(line))) {
      return pageNumber;
    }
  }

  return null;
}

function isReferencesHeadingBlock(block) {
  return isLikelyReferencesHeadingBlock(block);
}

function shouldUseLocalFirstSegmentation(settings = {}) {
  return isClaudeAgentSettings(settings) && !CLAUDE_AGENT_AI_SEGMENTATION;
}

function shouldUsePaperMemoryForSegmentation(settings = {}) {
  return normalizeAnalysisProfile(settings.analysisProfile) !== "fast";
}

async function buildPaperMemoryWithAi(paper, pages, structureMap, settings, options = {}) {
  await options.onProgress?.({ phase: "memory-start" });
  const chunks = chunkPagesForPaperMemory(pages, settings);
  const chunkNotes = [];
  let usedFallback = false;
  for (const [index, chunk] of chunks.entries()) {
    await options.onProgress?.({
      phase: "memory-chunk-start",
      chunkIndex: index,
      totalChunks: chunks.length,
      pageRange: getPageRangeLabel(chunk),
    });
    try {
      chunkNotes.push(await buildPaperMemoryChunkWithAi(paper, chunk, structureMap, settings, {
        signal: options.signal,
        chunkIndex: index,
        totalChunks: chunks.length,
      }));
    } catch (error) {
      if (options.signal?.aborted || error.statusCode === 499 || isFatalModelConfigurationError(error)) {
        throw error;
      }
      usedFallback = true;
      chunkNotes.push({
        ...buildHeuristicPaperMemory(paper, chunk, structureMap),
        source: "heuristic",
        chunkSummaries: [`${getPageRangeLabel(chunk)} 预读失败，使用本地 block/链接/视觉材料兜底：${truncateText(error.message || "unknown", 120)}`],
      });
    }
    await options.onProgress?.({
      phase: "memory-chunk-done",
      chunkIndex: index,
      totalChunks: chunks.length,
      pageRange: getPageRangeLabel(chunk),
    });
  }

  const merged = buildHeuristicPaperMemory(paper, pages, structureMap, chunkNotes);
  let memory = merged;
  try {
    memory = await synthesizePaperMemoryWithAi(paper, structureMap, merged, settings, {
      signal: options.signal,
      usedFallback,
    });
  } catch (error) {
    if (options.signal?.aborted || error.statusCode === 499 || isFatalModelConfigurationError(error)) {
      throw error;
    }
    memory = {
      ...merged,
      source: usedFallback ? "ai+heuristic-fallback" : "ai-merge-fallback",
      segmentationGuidance: [
        ...(Array.isArray(merged.segmentationGuidance) ? merged.segmentationGuidance : []),
        `Paper Memory 合成失败，使用预读 chunk 合并结果：${truncateText(error.message || "unknown", 140)}`,
      ],
    };
  }
  await options.onProgress?.({ phase: "memory-done" });
  return normalizePaperMemory(memory, paper, structureMap);
}

async function buildPaperMemoryChunkWithAi(paper, pages, structureMap, settings, options = {}) {
  const pageRange = getPageRangeLabel(pages);
  const pageText = buildPaperMemoryScanInput(pages, {
    totalLimit: Math.min(PAPER_MEMORY_INPUT_LIMIT, isClaudeAgentSettings(settings) ? 14_000 : 26_000),
    perPageLimit: isClaudeAgentSettings(settings) ? 3200 : 5200,
  });
  if (!pageText) {
    return buildHeuristicPaperMemory(paper, pages, structureMap);
  }

  const messages = [
    {
      role: "system",
      content: [
        "你是论文精读预读助手。你的任务不是分段、不是翻译，而是先通读 PDF block，建立后续精读分段要用的 Paper Memory。",
        "必须保留对理解论文有用但不适合直接当正文段落的内容：关键公式、图表、代码块、数据集/代码仓库/项目链接、重要脚注或备注。",
        "作者、版权、页眉页脚、参考文献可以标为非正文提示，但不要把关键 URL、公式或图表信息直接丢掉。",
        "只输出合法 JSON，不要使用 Markdown 代码块。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `论文: ${paper.title || paper.filename || "未知论文"}`,
        `当前预读窗口: ${options.chunkIndex + 1 || 1}/${options.totalChunks || 1}，页码 ${pageRange}`,
        "",
        "全文结构地图:",
        formatPaperStructureMapForPrompt(structureMap, pages),
        "",
        "请预读下面原始 PDF blocks。注意 [B...] 里包含 type/坐标/链接提示；这些元信息帮助判断内容性质，不要照抄进摘要。",
        "输出格式必须是：",
        "{",
        '  "summary": "本窗口内容摘要，中文，不超过 160 字",',
        '  "mainThread": "本窗口在论文主线中的作用，不超过 160 字",',
        '  "contributions": ["贡献或主张"],',
        '  "keyTerms": ["术语"],',
        '  "importantFormulas": [{ "label": "Equation 1", "pageNumber": 2, "text": "公式原文", "purpose": "这个公式的作用" }],',
        '  "importantVisuals": [{ "label": "Figure 1", "pageNumber": 2, "type": "figure/table/code", "description": "图表或代码说明" }],',
        '  "resources": [{ "type": "code/dataset/project/paper/url", "url": "https://...", "pageNumber": 1, "label": "资源名", "whyImportant": "为什么重要" }],',
        '  "nonReadingGuidance": ["作者/版权/References/页眉页脚等不要当正文段落的线索"],',
        '  "segmentationGuidance": ["后续分段时应该保留/合并/跳过的判断建议"]',
        "}",
        "",
        "原始 PDF blocks:",
        pageText,
      ].join("\n"),
    },
  ];

  const content = await callModel(settings, messages, {
    maxTokens: 5000,
    signal: options.signal,
    timeoutMs: PAPER_MEMORY_CHUNK_TIMEOUT_MS,
  });
  const parsed = parseModelJson(content);
  return normalizePaperMemory({
    ...parsed,
    source: "ai",
    chunkSummaries: [`${pageRange}: ${truncateText(parsed.summary || "", 180)}`],
  }, paper, structureMap);
}

async function synthesizePaperMemoryWithAi(paper, structureMap, mergedMemory, settings, options = {}) {
  const memoryText = formatPaperMemoryForPrompt(mergedMemory, [], { limit: 5200 });
  const messages = [
    {
      role: "system",
      content: [
        "你是论文精读总规划助手。请把各窗口预读结果合成为全局 Paper Memory，用于后续分段和逐段讲解。",
        "必须保留关键公式、图表、代码、数据集/代码仓库/项目链接；它们可以不进入正文段落，但不能从记忆中消失。",
        "只输出合法 JSON，不要使用 Markdown 代码块。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `论文: ${paper.title || paper.filename || "未知论文"}`,
        options.usedFallback ? "注意：部分窗口使用了本地启发式兜底，请综合判断。" : "",
        "",
        "结构地图:",
        formatPaperStructureMapForPrompt(structureMap, []),
        "",
        "预读合并草稿:",
        memoryText,
        "",
        "请输出全局 Paper Memory，格式为：",
        "{",
        '  "summary": "整篇论文主题和结构摘要，中文，不超过 240 字",',
        '  "mainThread": "论文方法/论证主线，中文，不超过 240 字",',
        '  "contributions": ["关键贡献"],',
        '  "keyTerms": ["关键术语"],',
        '  "importantFormulas": [{ "label": "Equation 1", "pageNumber": 2, "text": "公式原文", "purpose": "作用" }],',
        '  "importantVisuals": [{ "label": "Figure 1", "pageNumber": 2, "type": "figure/table/code", "description": "作用" }],',
        '  "resources": [{ "type": "code/dataset/project/paper/url", "url": "https://...", "pageNumber": 1, "label": "资源名", "whyImportant": "为什么重要" }],',
        '  "nonReadingGuidance": ["不要进入正文段落但要记住的区域或内容类型"],',
        '  "segmentationGuidance": ["后续分段时的全局原则"]',
        "}",
      ].filter(Boolean).join("\n"),
    },
  ];

  const content = await callModel(settings, messages, {
    maxTokens: 5000,
    signal: options.signal,
    timeoutMs: PAPER_MEMORY_SYNTHESIS_TIMEOUT_MS,
  });
  return normalizePaperMemory({
    ...parseModelJson(content),
    source: "ai",
    chunkSummaries: mergedMemory.chunkSummaries || [],
  }, paper, structureMap);
}

function chunkPagesForPaperMemory(pages, settings = {}) {
  const options = isClaudeAgentSettings(settings)
    ? { maxPages: 1, maxChars: 5200 }
    : { maxPages: 3, maxChars: 12_000 };
  return chunkPagesForSegmentation(pages, options);
}

function segmentPaperLocally(paper, reason = "local-layout") {
  const pages = Array.isArray(paper.extractionPages) ? paper.extractionPages : [];
  const structureMap = {
    ...buildHeuristicPaperStructureMap(paper, pages),
    fallbackReason: reason,
  };
  const initialParagraphs = splitIntoParagraphs(pages);
  const validation = validateAndRepairSegmentedParagraphs(initialParagraphs, structureMap, {
    pageMetrics: buildSegmentationPageMetrics(pages),
  });
  const validationSummary = {
    ...validation.summary,
    warnings: [...new Set([...(validation.summary.warnings || []), reason])],
    updatedAt: new Date().toISOString(),
  };
  const paragraphs = validation.paragraphs;
  const segmentationQualityAudit = {
    ...(validationSummary.qualityAudit || createSegmentationAuditStats(initialParagraphs.length)),
    updatedAt: validationSummary.updatedAt,
  };
  const directSections = inferSections(paragraphs);
  const sections = directSections.length > 1
    ? directSections
    : inferSectionsFromSegmentationPlan(paragraphs, structureMap);
  enrichSectionsWithContext(sections, paragraphs, []);
  const segmented = {
    ...paper,
    title: inferTitleFromPages(pages, paragraphs, paper.filename),
    status: "ready",
    segmentationMode: pages.some((page) => Array.isArray(page.blocks) && page.blocks.length) ? "layout" : "heuristic",
    structureMap,
    segmentationPlan: structureMap.segmentationPlan || [],
    segmentationValidation: validationSummary,
    segmentationQualityAudit,
    segmentationStages: {
      version: 1,
      plan: {
        source: "heuristic",
        version: structureMap.segmentationPlanVersion || SEGMENTATION_PLAN_VERSION,
        sections: getSegmentationPlan(structureMap).length,
      },
      localSegmentation: {
        source: "local-layout",
        reason,
        pages: pages.length,
        items: paragraphs.length,
      },
      fallback: {
        strategy: "local-layout",
        reason,
      },
      validation: validationSummary,
      qualityAudit: segmentationQualityAudit,
    },
    sections,
    paragraphs,
    contextProfile: buildPaperContextProfile(paragraphs, sections, [], structureMap),
    segmentationJob: {
      status: "done",
      phase: "local",
      message: "已使用本地视觉分段。",
      updatedAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };

  attachParagraphArtifactLinks(segmented);
  return segmented;
}

async function segmentPaperWithAi(paper, settings, options = {}) {
  const pages = paper.extractionPages || [];
  await options.onProgress?.({ phase: "structure-start" });
  const structureMap = await buildPaperStructureMapWithAi(paper, pages, settings, { signal: options.signal });
  const chunkOptions = getSegmentationChunkOptions(settings);
  const chunks = chunkPagesForSegmentation(pages, chunkOptions);
  await options.onProgress?.({
    phase: "structure-done",
    totalChunks: chunks.length,
  });
  const paperMemory = shouldUsePaperMemoryForSegmentation(settings)
    ? await buildPaperMemoryWithAi(paper, pages, structureMap, settings, {
      signal: options.signal,
      onProgress: options.onProgress,
    })
    : null;
  const items = [];
  const chunkSummaries = [];
  const fallbackChunks = [];
  const windowState = createSegmentationWindowState();
  let forceLocalFallback = false;

  for (const [index, chunk] of chunks.entries()) {
    await options.onProgress?.({
      phase: "chunk-start",
      chunkIndex: index,
      totalChunks: chunks.length,
      pageRange: getPageRangeLabel(chunk),
    });
    const result = await segmentPageChunkResiliently(paper, chunk, settings, {
      signal: options.signal,
      chunkIndex: index,
      totalChunks: chunks.length,
      windowContext: buildSegmentationWindowContext(windowState),
      structureMap,
      paperMemory,
      chunkOptions,
      forceLocalFallback,
    });
    const chunkItems = result.items.map((item) => ({
      ...item,
      chunkIndex: index,
    }));
    items.push(...chunkItems);
    updateSegmentationWindowState(windowState, chunkItems, result, chunk);
    chunkSummaries.push({
      pages: getPageRangeLabel(chunk),
      summary: normalizeParagraph(result.chunkSummary || ""),
      keywords: normalizeKeywordList(result.keywords).slice(0, 12),
      activeSectionTitle: windowState.activeSectionTitle,
      fallback: Boolean(result.fallback),
      fallbackReason: result.fallbackReason || "",
    });
    if (result.fallback) {
      fallbackChunks.push({
        index,
        pages: getPageRangeLabel(chunk),
        reason: truncateText(result.fallbackReason || "fallback", 180),
      });
      if (isClaudeAgentSettings(settings) && isClaudeSegmentationTimeoutFallback(result.fallbackReason)) {
        forceLocalFallback = true;
      }
    }
    await options.onProgress?.({
      phase: "chunk-done",
      chunkIndex: index,
      totalChunks: chunks.length,
      pageRange: getPageRangeLabel(chunk),
      itemCount: chunkItems.length,
    });
  }

  await options.onProgress?.({ phase: "validation", totalChunks: chunks.length });
  const validation = validateAndRepairSegmentedParagraphs(
    buildParagraphsFromSegmentItems(items, structureMap),
    structureMap,
    { pageMetrics: buildSegmentationPageMetrics(pages) },
  );
  const paragraphs = validation.paragraphs;
  const readingCount = paragraphs.filter((paragraph) => isReadingParagraph(paragraph)).length;

  if (readingCount < 3) {
    throw new Error("AI 分段结果太少，已保留基础分段。");
  }

  const segmentationQualityAudit = {
    ...validation.summary.qualityAudit,
    updatedAt: validation.summary.updatedAt,
  };
  const sections = inferSectionsFromSegmentationPlan(paragraphs, structureMap);
  enrichSectionsWithContext(sections, paragraphs, chunkSummaries);
  const segmented = {
    ...paper,
    title: inferTitle(paragraphs, paper.filename),
    status: "ready",
    segmentationMode: "ai",
    structureMap,
    paperMemory,
    segmentationPlan: structureMap.segmentationPlan || [],
    segmentationValidation: validation.summary,
    segmentationQualityAudit,
    segmentationStages: {
      version: 1,
      plan: {
        source: "structure-map",
        version: structureMap.segmentationPlanVersion || SEGMENTATION_PLAN_VERSION,
        sections: getSegmentationPlan(structureMap).length,
      },
      paperMemory: {
        source: paperMemory?.source || "",
        keyTerms: Array.isArray(paperMemory?.keyTerms) ? paperMemory.keyTerms.length : 0,
        formulas: Array.isArray(paperMemory?.importantFormulas) ? paperMemory.importantFormulas.length : 0,
        visuals: Array.isArray(paperMemory?.importantVisuals) ? paperMemory.importantVisuals.length : 0,
        resources: Array.isArray(paperMemory?.resources) ? paperMemory.resources.length : 0,
      },
      localSegmentation: {
        chunks: chunks.length,
        items: items.length,
        fallbackChunks: fallbackChunks.length,
      },
      fallback: fallbackChunks.length ? {
        chunks: fallbackChunks,
        strategy: "local-layout",
      } : null,
      validation: validation.summary,
      qualityAudit: segmentationQualityAudit,
    },
    sections,
    paragraphs,
    contextProfile: buildPaperContextProfile(paragraphs, sections, chunkSummaries, structureMap, paperMemory),
    updatedAt: new Date().toISOString(),
  };

  attachParagraphArtifactLinks(segmented);
  return segmented;
}

function getSegmentationChunkOptions(settings = {}) {
  if (isClaudeAgentSettings(settings)) {
    return {
      maxPages: CLAUDE_SEGMENTATION_CHUNK_MAX_PAGES,
      maxChars: CLAUDE_SEGMENTATION_CHUNK_MAX_CHARS,
    };
  }

  return {
    maxPages: 3,
    maxChars: 8500,
  };
}

function chunkPagesForSegmentation(pages, options = {}) {
  const chunks = [];
  let current = [];
  let currentChars = 0;
  const maxChars = Number(options.maxChars || 8500);
  const maxPages = Number(options.maxPages || 3);

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

async function segmentPageChunkResiliently(paper, pages, settings, options = {}) {
  if (options.forceLocalFallback) {
    return buildLocalSegmentationChunkResult(pages, options.structureMap, {
      message: "previous-claude-timeout",
    });
  }

  try {
    return await segmentPageChunkWithAi(paper, pages, settings, options);
  } catch (error) {
    if (options.signal?.aborted || error.statusCode === 499 || isFatalModelConfigurationError(error)) {
      throw error;
    }

    if (!isRecoverableSegmentationChunkError(error)) {
      throw error;
    }

    if (pages.length > 1) {
      const nestedItems = [];
      const summaries = [];
      const keywords = [];
      let usedFallback = false;
      const reasons = [];

      for (const [offset, page] of pages.entries()) {
        const result = await segmentPageChunkResiliently(paper, [page], settings, {
          ...options,
          chunkIndex: `${options.chunkIndex ?? 0}.${offset}`,
        });
        nestedItems.push(...result.items);
        if (result.chunkSummary) {
          summaries.push(result.chunkSummary);
        }
        for (const keyword of normalizeKeywordList(result.keywords)) {
          pushUnique(keywords, keyword);
        }
        if (result.fallback) {
          usedFallback = true;
          reasons.push(result.fallbackReason || "fallback");
        }
      }

      return {
        chunkSummary: summaries.length ? truncateText(summaries.join(" / "), 160) : "",
        keywords: keywords.slice(0, 16),
        items: nestedItems,
        fallback: usedFallback,
        fallbackReason: usedFallback ? truncateText(reasons.filter(Boolean).join("; "), 220) : "",
      };
    }

    return buildLocalSegmentationChunkResult(pages, options.structureMap, error);
  }
}

function isRecoverableSegmentationChunkError(error) {
  const message = String(error?.message || "");
  return /超时|timeout|timed out|没有返回可解析|JSON|Unexpected|parse|格式|fetch failed|ECONN|ETIMEDOUT/i.test(message);
}

function isClaudeSegmentationTimeoutFallback(reason = "") {
  return /claude|超时|timeout|timed out|previous-claude-timeout/i.test(String(reason || ""));
}

function buildLocalSegmentationChunkResult(pages, structureMap = null, error = null) {
  const items = [];
  const keywords = [];
  for (const page of pages || []) {
    const pageItems = buildLocalSegmentItemsForPage(page, structureMap);
    items.push(...pageItems);
    for (const item of pageItems) {
      for (const keyword of normalizeKeywordList(item.keywords)) {
        pushUnique(keywords, keyword);
      }
    }
  }

  const reason = error?.message ? `local-fallback:${truncateText(error.message, 180)}` : "local-fallback";
  return {
    chunkSummary: `${getPageRangeLabel(pages)} 使用本地版面分段兜底。`,
    keywords: keywords.slice(0, 16),
    items,
    fallback: true,
    fallbackReason: reason,
  };
}

function buildLocalSegmentItemsForPage(page, structureMap = null) {
  const blocks = getReadablePageBlocks(page);
  const items = [];
  for (const block of blocks) {
    const rawSourceText = String(typeof block === "string" ? block : block.text || "");
    const sourceText = normalizeParagraph(rawSourceText);
    if (!sourceText || (sourceText.length < 20 && !isLikelyHeading(sourceText))) {
      continue;
    }

    const item = {
      kind: isLikelyHeading(sourceText) ? "heading" : "paragraph",
      pageNumber: Number(page.pageNumber || 1),
      pageEndNumber: Number(page.pageNumber || 1),
      sectionTitle: "",
      continuesFromPrevious: false,
      continuesToNext: false,
      keywords: [],
      role: "",
      plannedSectionId: "",
      rawSourceText,
      sourceText,
    };
    const plannedSection = resolveSegmentationPlanSection(item, structureMap);
    if (plannedSection) {
      item.sectionTitle = normalizeSectionTitleHint(plannedSection.title || "");
      item.plannedSectionId = plannedSection.id || "";
      item.role = normalizeSegmentationRole(plannedSection.role || "");
    }
    if (item.kind !== "heading" && (
      isNonReadingByStructureMap(item, structureMap) ||
      isLikelyNonReadingParagraphText(rawSourceText, item) ||
      isLikelyNonReadingParagraphText(sourceText, item)
    )) {
      continue;
    }
    items.push(item);
  }

  return items;
}

function createSegmentationWindowState() {
  return {
    activeSectionTitle: "",
    previousTailItems: [],
    summaries: [],
    keywords: [],
  };
}

function buildSegmentationWindowContext(state) {
  const lines = [];
  if (state.activeSectionTitle) {
    lines.push(`当前章节线索: ${state.activeSectionTitle}`);
  }

  if (state.summaries.length) {
    lines.push(`前序窗口摘要: ${state.summaries.slice(-2).join(" / ")}`);
  }

  if (state.keywords.length) {
    lines.push(`前序关键词: ${state.keywords.slice(0, 14).join("、")}`);
  }

  if (state.previousTailItems.length) {
    lines.push("前序尾段:");
    for (const [index, item] of state.previousTailItems.entries()) {
      lines.push(`T${index + 1}: ${truncateText(item.sourceText, SEGMENTATION_ITEM_TEXT_LIMIT)}`);
    }
  }

  return lines.length ? truncateText(lines.join("\n"), SEGMENTATION_CONTEXT_TEXT_LIMIT) : "无。";
}

function updateSegmentationWindowState(state, items, result, pages) {
  const headings = items
    .filter((item) => item.kind === "heading" || item.sectionTitle)
    .map((item) => normalizeSectionTitleHint(item.sectionTitle || item.sourceText))
    .filter(Boolean);
  if (headings.length) {
    state.activeSectionTitle = headings.at(-1);
  }

  if (result.chunkSummary) {
    state.summaries.push(`${getPageRangeLabel(pages)}: ${truncateText(result.chunkSummary, 220)}`);
    state.summaries = state.summaries.slice(-4);
  }

  for (const keyword of normalizeKeywordList(result.keywords)) {
    pushUnique(state.keywords, keyword);
  }
  state.keywords = state.keywords.slice(0, 24);

  state.previousTailItems = items
    .filter((item) => item.kind !== "heading" && item.sourceText && !isLikelyNonReadingParagraphText(item.sourceText, item))
    .slice(-3);
}

function getPageRangeLabel(pages) {
  const numbers = pages.map((page) => Number(page.pageNumber)).filter(Number.isFinite);
  if (!numbers.length) {
    return "未知页";
  }

  const first = numbers[0];
  const last = numbers.at(-1);
  return first === last ? `p.${first}` : `p.${first}-${last}`;
}

async function segmentPageChunkWithAi(paper, pages, settings, options = {}) {
  const pageText = pages
    .map((page) => [
      `--- Page ${page.pageNumber} ---`,
      getSegmentationPageText(page).slice(0, 12_000),
    ].join("\n"))
    .join("\n\n");
  const pageRange = getPageRangeLabel(pages);
  const windowContext = options.windowContext || "无。";
  const structureContext = formatPaperStructureMapForPrompt(options.structureMap, pages);
  const paperMemoryContext = formatPaperMemoryForPrompt(options.paperMemory, pages, {
    limit: SEGMENTATION_CONTEXT_TEXT_LIMIT,
  });

  const messages = [
    {
      role: "system",
      content: [
        "你是论文 PDF 分段助手。你的任务是把 PDF 抽取出来的页面文本切成适合精读的语义段落。",
        "必须忠于原文，不翻译，不总结，不新增内容。",
        "必须优先遵守全文结构地图；如果结构地图指出某页进入 References 或某区域是作者/版权/链接/页眉页脚，不要把这些内容输出成正文段落。",
        "必须参考 Paper Memory；其中的公式、图表、代码和重要 URL 是后续讲解材料，可以省略为正文段落，但不要在分段判断中误认为无价值垃圾。",
        "合并同一自然段内的换行和断词，保留标题、编号、公式引用和术语。",
        "页面文本中的 [B...] 是块编号、页码、坐标和行数元信息，只用于判断顺序/栏位/跨页续接；sourceText 不要包含这些块标记。",
        "不要把上一窗口上下文重复输出成当前段落；它只用于判断跨页续接、章节脉络和术语一致性。",
        "只输出正文阅读需要的章节标题和自然段。作者列表、邮箱、单位、会议版权、ACM Reference、DOI/URL 脚注、页眉页脚、参考文献条目都必须省略。",
        "不要把图注、表格单元格、图片里的文字、公式块、代码块单独切成正文段落；正文里提到的 Figure/Table/Eq 引用要保留。",
        "如果一段只有链接、图片链接、数据集链接、脚注编号或联系信息，直接省略，不要输出为 paragraph。",
        "跨页或跨栏的同一自然段要合并成一个 paragraph，并正确设置 continuesFromPrevious / continuesToNext。",
        "只输出合法 JSON，不要使用 Markdown 代码块。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `论文: ${paper.title || paper.filename}`,
        `当前窗口: ${options.chunkIndex + 1 || 1}/${options.totalChunks || 1}，页码 ${pageRange}`,
        "",
        "全文结构地图:",
        structureContext,
        "",
        "Paper Memory:",
        paperMemoryContext,
        "",
        "上一窗口上下文:",
        windowContext,
        "",
        "请把下面页面文本切分为语义段落。",
        "每个 heading/paragraph 都要尽量绑定全文分段计划里的 plannedSectionId；如果当前内容不属于任何计划章节，省略该项。",
        "输出格式必须是：",
        "{",
        '  "chunkSummary": "当前窗口的极简脉络摘要，中文，不超过 120 字",',
        '  "keywords": ["术语1", "术语2"],',
        '  "items": [',
        '    { "kind": "heading", "plannedSectionId": "planned_section_2", "pageNumber": 1, "pageEndNumber": 1, "sectionTitle": "章节标题", "sourceText": "章节标题" },',
        '    { "kind": "paragraph", "plannedSectionId": "planned_section_2", "pageNumber": 1, "pageEndNumber": 1, "sectionTitle": "所属章节", "continuesFromPrevious": false, "continuesToNext": false, "keywords": ["术语"], "sourceText": "自然段原文" }',
        "  ]",
        "}",
        "",
        "页面文本:",
        pageText,
      ].join("\n"),
    },
  ];

  const content = await callModel(settings, messages, {
    maxTokens: 6000,
    signal: options.signal,
    timeoutMs: isClaudeAgentSettings(settings) ? CLAUDE_SEGMENTATION_CHUNK_TIMEOUT_MS : SEGMENTATION_CHUNK_TIMEOUT_MS,
  });
  const parsed = parseModelJson(content);
  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];

  return {
    chunkSummary: normalizeParagraph(parsed.chunkSummary || parsed.summary || ""),
    keywords: normalizeKeywordList(parsed.keywords || parsed.keyTerms).slice(0, 16),
    items: rawItems
      .map((item) => {
        const rawSourceText = stripSegmentationBlockMarkers(item.sourceText || item.text || "");
        return {
          kind: String(item.kind || "").toLowerCase() === "heading" ? "heading" : "paragraph",
          pageNumber: Number(item.pageNumber || pages[0]?.pageNumber || 1),
          pageEndNumber: Number(item.pageEndNumber || item.endPageNumber || item.pageNumber || pages[0]?.pageNumber || 1),
          sectionTitle: normalizeSectionTitleHint(item.sectionTitle || item.section || ""),
          continuesFromPrevious: parseModelBoolean(item.continuesFromPrevious),
          continuesToNext: parseModelBoolean(item.continuesToNext),
          keywords: normalizeKeywordList(item.keywords || item.keyTerms).slice(0, 10),
          role: normalizeSegmentationRole(item.role || ""),
          plannedSectionId: normalizeSegmentationPlanId(item.plannedSectionId || item.planId || ""),
          rawSourceText,
          sourceText: normalizeParagraph(rawSourceText),
        };
      })
      .filter((item) => item.sourceText && (item.kind === "heading" || (
        !isNonReadingByStructureMap(item, options.structureMap) &&
        !isLikelyNonReadingParagraphText(item.rawSourceText, item) &&
        !isLikelyNonReadingParagraphText(item.sourceText, item)
      ))),
  };
}

function formatPaperStructureMapForPrompt(structureMap, pages) {
  if (!structureMap || !structureMap.version) {
    return "无。";
  }

  const { firstPage, lastPage } = getPageRangeBounds(pages);
  const scopedToPages = Array.isArray(pages) && pages.length > 0;
  const sections = (structureMap.sections || [])
    .filter((section) => !scopedToPages || rangesOverlap(section.startPage, section.endPage || section.startPage, firstPage, lastPage))
    .slice(0, 10);
  const plan = getSegmentationPlan(structureMap)
    .filter((section) => !scopedToPages || rangesOverlap(section.startPage, section.endPage || section.startPage, firstPage, lastPage))
    .slice(0, 10);
  const zones = (structureMap.nonBodyZones || [])
    .filter((zone) => !scopedToPages || rangesOverlap(zone.startPage, zone.endPage || zone.startPage, firstPage, lastPage))
    .slice(0, 10);
  const lines = [
    structureMap.paperTitle ? `标题: ${structureMap.paperTitle}` : "",
    structureMap.summary ? `结构摘要: ${structureMap.summary}` : "",
    structureMap.bodyStartPage ? `正文起始页: p.${structureMap.bodyStartPage}` : "",
    structureMap.referencesStartPage ? `References 起始页: p.${structureMap.referencesStartPage}` : "",
    sections.length
      ? `当前窗口相关章节: ${sections.map((section) => `${section.title} ${formatPageRange(section.startPage, section.endPage)}`).join("；")}`
      : "",
    plan.length
      ? `当前窗口分段计划: ${plan.map((section) =>
        `${section.id}=${section.title} ${formatPageRange(section.startPage, section.endPage)}${section.role ? ` role:${section.role}` : ""}${section.boundaryHint ? ` hint:${section.boundaryHint}` : ""}`)
        .join("；")}`
      : "",
    zones.length
      ? `当前窗口非正文区域: ${zones.map((zone) => `${zone.label || zone.type} ${formatPageRange(zone.startPage, zone.endPage)} ${zone.description || ""}`.trim()).join("；")}`
      : "",
  ].filter(Boolean);

  return lines.length ? truncateText(lines.join("\n"), SEGMENTATION_CONTEXT_TEXT_LIMIT) : "无。";
}

function getPageRangeBounds(pages) {
  const numbers = (pages || []).map((page) => Number(page.pageNumber)).filter(Number.isFinite);
  if (!numbers.length) {
    return { firstPage: 1, lastPage: 1 };
  }

  return {
    firstPage: Math.min(...numbers),
    lastPage: Math.max(...numbers),
  };
}

function rangesOverlap(startA, endA, startB, endB) {
  if (![startA, endA, startB, endB].every(Number.isFinite)) {
    return false;
  }

  return startA <= endB && endA >= startB;
}

function formatPageRange(startPage, endPage) {
  return endPage && endPage !== startPage ? `p.${startPage}-${endPage}` : `p.${startPage || "?"}`;
}

function isNonReadingByStructureMap(item, structureMap) {
  if (!structureMap || !structureMap.version) {
    return false;
  }

  const pageNumber = Number(item.pageNumber || 0);
  if (!Number.isFinite(pageNumber) || pageNumber <= 0) {
    return false;
  }

  if (structureMap.referencesStartPage && pageNumber >= Number(structureMap.referencesStartPage)) {
    return true;
  }

  return (structureMap.nonBodyZones || []).some((zone) =>
    zone.type === "references" &&
    pageNumber >= Number(zone.startPage || 0) &&
    pageNumber <= Number(zone.endPage || zone.startPage || 0));
}

function getSegmentationPlan(structureMap) {
  return Array.isArray(structureMap?.segmentationPlan) ? structureMap.segmentationPlan : [];
}

function resolveSegmentationPlanSection(item, structureMap) {
  const plan = getSegmentationPlan(structureMap);
  if (!plan.length) {
    return null;
  }

  const plannedSectionId = normalizeSegmentationPlanId(item?.plannedSectionId || "");
  if (plannedSectionId) {
    const matchedById = plan.find((section) => section.id === plannedSectionId);
    if (matchedById) {
      return matchedById;
    }
  }

  const sectionTitle = normalizeSectionTitleHint(item?.sectionTitle || item?.sectionTitleHint || "");
  if (sectionTitle) {
    const matchedByTitle = plan.find((section) =>
      section.title.toLowerCase() === sectionTitle.toLowerCase());
    if (matchedByTitle) {
      return matchedByTitle;
    }
  }

  const pageNumber = Number(item?.pageNumber || 0);
  const pageEndNumber = Number(item?.pageEndNumber || pageNumber);
  if (Number.isFinite(pageNumber) && pageNumber > 0) {
    const overlapping = plan.filter((section) =>
      rangesOverlap(
        Number(section.startPage || 0),
        Number(section.endPage || section.startPage || 0),
        pageNumber,
        Number.isFinite(pageEndNumber) && pageEndNumber > 0 ? pageEndNumber : pageNumber,
      ));
    if (overlapping.length === 1) {
      return overlapping[0];
    }
    if (overlapping.length > 1 && sectionTitle) {
      return overlapping.find((section) =>
        section.title.toLowerCase().includes(sectionTitle.toLowerCase()) ||
        sectionTitle.toLowerCase().includes(section.title.toLowerCase())) || overlapping[0];
    }

    const previous = [...plan]
      .reverse()
      .find((section) => Number(section.startPage || 0) <= pageNumber);
    return previous || plan[0];
  }

  return plan[0] || null;
}

function getSegmentationPageText(page) {
  return buildSegmentationPageInputText(page);
}

function formatSegmentationPageBlock(page, block, index) {
  const text = typeof block === "string" ? block : block.text;
  const clean = normalizeParagraph(text);
  if (typeof block === "string") {
    return `[B${index + 1}] ${clean}`;
  }

  const pageWidth = Number(page?.width || 0);
  const pageHeight = Number(page?.height || 0);
  const box = pickBlockBox(block);
  const meta = [`B${index + 1}`, `p=${page?.pageNumber || "?"}`];
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

  return `[${meta.join(" ")}] ${clean}`;
}

function formatSegmentationRatio(value, total) {
  return (Number(value || 0) / Math.max(1, Number(total || 1))).toFixed(2);
}

function stripSegmentationBlockMarkers(text) {
  return String(text || "")
    .replace(/\[B\d+(?:\s+[^\]]*)?]\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildParagraphsFromSegmentItems(items, structureMap = null) {
  const paragraphs = [];
  const seen = new Set();

  for (const item of items) {
    const rawClean = normalizeParagraph(stripSegmentationBlockMarkers(item.sourceText));
    const clean = normalizeParagraph(stripPublicationMetadataFragments(rawClean));
    if (!clean || (clean.length < 20 && item.kind !== "heading" && !isLikelyHeading(clean)) ||
      (item.kind !== "heading" && (
        isNonReadingByStructureMap(item, structureMap) ||
        isLikelyNonReadingParagraphText(stripPublicationMetadataFragments(item.rawSourceText || rawClean) || clean, item) ||
        isLikelyNonReadingParagraphText(clean, item)
      ))) {
      continue;
    }

    const dedupeKey = `${item.pageNumber}:${clean.slice(0, 160)}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    const order = paragraphs.length;
    const kind = item.kind === "heading" || isLikelyHeading(clean) ? "heading" : "paragraph";
    const plannedSection = resolveSegmentationPlanSection(item, structureMap);
    const sectionTitleHint = normalizeSectionTitleHint(item.sectionTitle || plannedSection?.title || "");
    const paragraph = {
      id: `para_${order}_${randomUUID().slice(0, 8)}`,
      kind,
      order,
      pageNumber: Number.isFinite(item.pageNumber) && item.pageNumber > 0 ? item.pageNumber : 1,
      pageEndNumber: Number.isFinite(item.pageEndNumber) && item.pageEndNumber > 0
        ? item.pageEndNumber
        : Number.isFinite(item.pageNumber) && item.pageNumber > 0 ? item.pageNumber : 1,
      sectionId: "section_0",
      sectionTitleHint,
      plannedSectionId: plannedSection?.id || "",
      segmentationRole: normalizeSegmentationRole(item.role || plannedSection?.role || ""),
      contextKeywords: normalizeKeywordList(item.keywords).slice(0, 10),
      continuesFromPrevious: Boolean(item.continuesFromPrevious),
      continuesToNext: Boolean(item.continuesToNext),
      sourceText: clean,
      translation: "",
      explanation: "",
      keyTerms: [],
      relatedArtifactIds: [],
      chatMessages: [],
      analysisStatus: "pending",
      analysisError: "",
    };

    appendParagraph(paragraphs, paragraph);
  }

  paragraphs.forEach((paragraph, index) => {
    paragraph.order = index;
  });

  return paragraphs;
}

function validateAndRepairSegmentedParagraphs(paragraphs, structureMap = null, options = {}) {
  return repairSegmentedParagraphs(paragraphs, structureMap, options);
}

function buildSegmentationPageMetrics(pages = []) {
  return (Array.isArray(pages) ? pages : [])
    .map((page) => ({
      pageNumber: Number(page?.pageNumber || 0),
      pageWidth: Number(page?.width || page?.pageWidth || 0),
      pageHeight: Number(page?.height || page?.pageHeight || 0),
    }))
    .filter((page) => page.pageNumber > 0 && (page.pageWidth > 0 || page.pageHeight > 0));
}

function createSegmentationAuditStats(inputParagraphs = 0) {
  return {
    version: SEGMENTATION_AUDIT_VERSION,
    inputParagraphs,
    outputParagraphs: 0,
    removedNoise: 0,
    markedIneligible: 0,
    reasons: {},
  };
}

function recordSegmentationAuditReason(stats, reasons = [], action = "marked") {
  if (!stats) {
    return;
  }

  const normalizedReasons = normalizeSegmentationNoiseReasons(reasons);
  if (action === "removed") {
    stats.removedNoise += 1;
  } else if (action === "marked") {
    stats.markedIneligible += 1;
  }

  for (const reason of normalizedReasons.length ? normalizedReasons : ["unknown-noise"]) {
    stats.reasons[reason] = Number(stats.reasons[reason] || 0) + 1;
  }
}

function auditPaperSegmentationQuality(paper) {
  if (!paper || paper.segmentationMode !== "ai" || !Array.isArray(paper.paragraphs)) {
    return false;
  }

  const audit = auditSegmentedParagraphsForNoise(paper.paragraphs, paper.structureMap || null);
  const current = paper.segmentationQualityAudit || {};
  const unchanged = areSegmentationAuditSummariesEqual(current, audit.summary) && !audit.changed;
  if (unchanged) {
    return false;
  }

  const updatedSummary = {
    ...audit.summary,
    updatedAt: new Date().toISOString(),
  };
  paper.segmentationQualityAudit = updatedSummary;
  paper.segmentationValidation = {
    ...(paper.segmentationValidation || {}),
    qualityAudit: updatedSummary,
  };
  paper.segmentationStages = {
    ...(paper.segmentationStages || {}),
    qualityAudit: updatedSummary,
  };
  return true;
}

function auditSegmentedParagraphsForNoise(paragraphs, structureMap = null) {
  const repeatedTextIndex = buildRepeatedSegmentationTextIndex(paragraphs || []);
  const summary = createSegmentationAuditStats(Array.isArray(paragraphs) ? paragraphs.length : 0);
  summary.outputParagraphs = Array.isArray(paragraphs) ? paragraphs.length : 0;
  let changed = false;

  for (const paragraph of paragraphs || []) {
    if (!paragraph || paragraph.kind === "heading") {
      continue;
    }

    if (paragraph.manualSegmentationOverride === "reading") {
      if (paragraph.segmentationNoise || paragraph.analysisEligible === false) {
        delete paragraph.segmentationNoise;
        paragraph.analysisEligible = true;
        changed = true;
      }
      continue;
    }

    if (paragraph.manualSegmentationOverride === "noise") {
      recordSegmentationAuditReason(summary, ["manual"], "marked");
      continue;
    }

    const originalClean = normalizeParagraph(paragraph.sourceText || "");
    const strippedClean = normalizeParagraph(stripPublicationMetadataFragments(originalClean));
    if (strippedClean && strippedClean !== originalClean) {
      paragraph.sourceText = strippedClean;
      resetParagraphAnalysis(paragraph);
      changed = true;
      recordSegmentationAuditReason(summary, ["publication-metadata"], "removed");
    }

    const audit = auditSegmentedParagraphNoise(paragraph, structureMap, repeatedTextIndex);
    if (audit.action !== "skip-analysis" && audit.action !== "drop") {
      if (paragraph.segmentationNoise) {
        delete paragraph.segmentationNoise;
        changed = true;
      }
      continue;
    }

    recordSegmentationAuditReason(summary, audit.reasons, "marked");
    if (applySegmentationNoiseMark(paragraph, audit)) {
      changed = true;
    }
  }

  return { changed, summary };
}

function auditSegmentedParagraphNoise(paragraph, structureMap = null, repeatedTextIndex = new Map()) {
  return auditSegmentedNoise(paragraph, structureMap, repeatedTextIndex);
}

function applySegmentationNoiseMark(paragraph, audit) {
  const nextNoise = {
    version: SEGMENTATION_AUDIT_VERSION,
    action: "skip-analysis",
    confidence: audit.confidence || "medium",
    reasons: normalizeSegmentationNoiseReasons(audit.reasons),
  };
  const previousNoise = paragraph.segmentationNoise || {};
  const changed = paragraph.analysisEligible !== false ||
    paragraph.analysisStatus !== "done" ||
    paragraph.analysisError ||
    !areObjectsShallowEqual(previousNoise, nextNoise);

  paragraph.analysisEligible = false;
  paragraph.analysisStatus = "done";
  paragraph.analysisError = "";
  paragraph.segmentationNoise = nextNoise;
  return changed;
}

function normalizeSegmentationNoiseReasons(reasons = []) {
  return [...new Set((Array.isArray(reasons) ? reasons : [reasons])
    .map((reason) => String(reason || "").trim().toLowerCase())
    .filter(Boolean))]
    .sort();
}

function buildRepeatedSegmentationTextIndex(paragraphs = []) {
  const index = new Map();
  for (const paragraph of paragraphs) {
    if (!paragraph || paragraph.kind === "heading") {
      continue;
    }

    const clean = normalizeParagraph(paragraph.sourceText || "");
    const key = normalizeRepeatedSegmentationTextKey(clean);
    if (!key) {
      continue;
    }

    const entry = index.get(key) || {
      count: 0,
      pages: new Set(),
      text: clean,
    };
    entry.count += 1;
    entry.pages.add(normalizePositivePageNumber(paragraph.pageNumber, 0));
    index.set(key, entry);
  }

  return index;
}

function normalizeRepeatedSegmentationTextKey(text) {
  const clean = normalizeParagraph(text);
  if (!clean || clean.length < 6 || clean.length > 160 || isLikelyHeading(clean)) {
    return "";
  }

  return clean
    .toLowerCase()
    .replace(/\b\d+\b/g, "#")
    .replace(/[^\p{L}\p{N}#]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isRepeatedHeaderFooterText(text, repeatedTextIndex = new Map()) {
  const key = normalizeRepeatedSegmentationTextKey(text);
  if (!key) {
    return false;
  }

  const entry = repeatedTextIndex.get(key);
  if (!entry || entry.pages.size < 2) {
    return false;
  }

  const clean = normalizeParagraph(text);
  const sentenceLike = /[.!?。！？][)"'\]]?(\s|$)/.test(clean);
  return clean.length <= 96 ||
    isLikelyPublicationMetadataText(clean) ||
    isLikelyPageNumberOrRunningHeader(clean) ||
    (!sentenceLike && entry.pages.size >= 3);
}

function isLikelyPageNumberOrRunningHeader(text) {
  return isLikelyPageNumberOrRunningHeaderText(text);
}

function isLikelyArtifactOnlyLinkText(text) {
  const clean = normalizeParagraph(text);
  if (!clean || clean.length > 320) {
    return false;
  }

  if (/\b(?:figure|fig\.|table|appendix|supplementary|github|code|dataset|artifact|artifact\s+available)\b/i.test(clean) &&
    /(?:https?:\/\/|www\.|doi\.org|arxiv\.org|github\.com|huggingface\.co)/i.test(clean)) {
    const words = clean.replace(/(?:https?:\/\/|www\.)\S+/gi, " ").trim().split(/\s+/).filter(Boolean);
    return words.length <= 22;
  }

  return false;
}

function areSegmentationAuditSummariesEqual(existing, next) {
  const normalize = (summary) => {
    const { updatedAt, ...rest } = summary || {};
    return JSON.stringify(rest);
  };
  return normalize(existing) === JSON.stringify(next || {});
}

function areObjectsShallowEqual(a, b) {
  return JSON.stringify(a || {}) === JSON.stringify(b || {});
}

function normalizePositivePageNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return Number(fallback) || 1;
  }
  return Math.trunc(number);
}

function inferSectionsFromSegmentationPlan(paragraphs, structureMap = null) {
  if (!getSegmentationPlan(structureMap).length) {
    return inferSections(paragraphs);
  }

  const sections = [];
  const sectionsByKey = new Map();
  for (const paragraph of paragraphs) {
    if (paragraph.kind !== "heading" && paragraph.analysisEligible === false) {
      continue;
    }

    const plannedSection = resolveSegmentationPlanSection(paragraph, structureMap);
    const hintedTitle = normalizeSectionTitleHint(
      paragraph.sectionTitleHint || (paragraph.kind === "heading" ? paragraph.sourceText : ""),
    );
    const title = plannedSection?.title || hintedTitle || "正文";
    const key = plannedSection?.id || `adhoc_${title.toLowerCase()}`;
    let section = sectionsByKey.get(key);
    if (!section) {
      section = {
        id: `section_${sections.length}`,
        title,
        level: 1,
        order: sections.length,
        summary: "",
        source: plannedSection ? "segmentation-plan" : "ai-segmentation",
        plannedSectionId: plannedSection?.id || "",
      };
      sectionsByKey.set(key, section);
      sections.push(section);
    }

    paragraph.sectionId = section.id;
    paragraph.sectionTitleHint = title === "正文" ? paragraph.sectionTitleHint || "" : title;
    paragraph.plannedSectionId = plannedSection?.id || paragraph.plannedSectionId || "";
  }

  return sections.length ? sections : inferSections(paragraphs);
}

function attachParagraphArtifactLinks(paper) {
  const artifacts = Array.isArray(paper.pageArtifacts)
    ? paper.pageArtifacts.filter((artifact) => isVisiblePaperArtifact(artifact) && artifact.type === "caption" && artifact.label)
    : [];

  if (!Array.isArray(paper.paragraphs)) {
    return paper;
  }

  for (const paragraph of paper.paragraphs) {
    if (!artifacts.length || !isReadingParagraphForPaper(paper, paragraph)) {
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

function isClaudeAgentSettings(settings = {}) {
  const cleanSettings = resolveSettingsForModel(settings);
  const baseUrl = String(cleanSettings.baseUrl || "");
  const provider = String(cleanSettings.provider || "");
  return baseUrl === "local:claude-kimi" ||
    baseUrl === "local:claude-config" ||
    provider.startsWith("claude");
}

function shouldUseKimiCodeDirectApi(settings = {}) {
  const cleanSettings = resolveSettingsForModel(settings);
  return cleanSettings.baseUrl === "local:claude-kimi" && !KIMI_CODE_USE_CLAUDE_CLI;
}

async function callModel(settings, messages, options = {}) {
  const cleanSettings = resolveSettingsForModel(settings);
  if (cleanSettings.baseUrl === "local:claude-kimi") {
    if (shouldUseKimiCodeDirectApi(cleanSettings)) {
      return callKimiCodeAnthropicDirect(cleanSettings, messages, options);
    }

    return callClaudeAgent(cleanSettings, messages, {
      usePageKimiKey: true,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }

  if (cleanSettings.baseUrl === "local:claude-config") {
    return callClaudeAgent(cleanSettings, messages, {
      usePageKimiKey: false,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
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
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 90_000);
  const providerRequest = buildOpenAiCompatibleProviderRequest(cleanSettings, messages, {
    endpoint,
    maxTokens: options.maxTokens,
    signal: controller.signal,
  });

  try {
    let response;
    try {
      response = await requestModelEndpoint(endpoint, providerRequest.requestOptions);
    } catch (error) {
      if (error.name === "AbortError") {
        throw options.signal?.aborted
          ? requestCanceledError()
          : new Error("模型请求超时，请稍后重试。");
      }

      throw new Error(formatModelNetworkError(error, cleanSettings));
    }

    const text = response.text;
    if (!response.ok) {
      throw new Error(formatModelError(response.status, text));
    }

    const data = JSON.parse(text);
    const content = extractChatCompletionTextContent(data);
    if (!content) {
      throw new Error("Model response did not include message content.");
    }

    return content.trim();
  } finally {
    options.signal?.removeEventListener("abort", abortFromExternalSignal);
    clearTimeout(timeout);
  }
}

async function callKimiCodeAnthropicDirect(settings, messages, options = {}) {
  const controller = new AbortController();
  const abortFromExternalSignal = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener("abort", abortFromExternalSignal, { once: true });
    }
  }
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 90_000);

  try {
    const requestBody = buildKimiCodeAnthropicRequestBody(settings, messages, {
      maxTokens: options.maxTokens || KIMI_CODE_DIRECT_MAX_TOKENS,
    });
    let response;
    try {
      response = await requestModelEndpoint(KIMI_CODE_ANTHROPIC_ENDPOINT, {
        apiKey: settings.apiKey,
        body: requestBody,
        proxyUrl: settings.proxyUrl,
        signal: controller.signal,
        headers: buildKimiCodeAnthropicHeaders(settings.apiKey),
      });
    } catch (error) {
      if (error.name === "AbortError") {
        throw options.signal?.aborted
          ? requestCanceledError()
          : new Error("Kimi Code 直连请求超时，请稍后重试。");
      }

      throw new Error(formatModelNetworkError(error, {
        ...settings,
        endpoint: KIMI_CODE_ANTHROPIC_ENDPOINT,
      }));
    }

    const text = response.text;
    if (!response.ok) {
      throw new Error(formatModelError(response.status, text));
    }

    const data = JSON.parse(text);
    const content = extractAnthropicTextContent(data);
    if (!content) {
      throw new Error("Kimi Code response did not include message content.");
    }

    return content.trim();
  } finally {
    options.signal?.removeEventListener("abort", abortFromExternalSignal);
    clearTimeout(timeout);
  }
}

function formatModelNetworkError(error, settings) {
  const endpoint = settings.endpoint || getChatCompletionsEndpoint(settings.baseUrl);
  const proxyUrl = getEffectiveProxyUrl(settings.proxyUrl, endpoint);
  const proxyHint = proxyUrl
    ? `已通过 PaperLens 代理传输尝试连接：${redactProxyUrl(proxyUrl)}。请确认代理地址、端口和 Docker/宿主机地址是否正确。`
    : "如果你的网络需要代理，请在网页 Proxy URL 或 .env 的 PAPERLENS_PROXY_URL 中填写代理地址。";

  return `模型网络请求失败：${error.message || "fetch failed"}。${proxyHint}`;
}

async function requestModelEndpoint(endpoint, options = {}) {
  const proxyUrl = getEffectiveProxyUrl(options.proxyUrl, endpoint);
  const headers = {
    "content-type": "application/json",
    "authorization": `Bearer ${options.apiKey}`,
    ...(options.headers || {}),
  };
  const body = JSON.stringify(options.body || {});

  if (!proxyUrl) {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: options.signal,
      headers,
      body,
    });
    return {
      ok: response.ok,
      status: response.status,
      text: await response.text(),
      viaProxy: false,
    };
  }

  return await requestViaProxy(endpoint, {
    method: "POST",
    headers,
    body,
    proxyUrl,
    signal: options.signal,
  });
}

async function requestViaProxy(endpoint, options = {}) {
  const proxy = new URL(options.proxyUrl);
  const protocol = proxy.protocol.toLowerCase();
  if (protocol === "http:" || protocol === "https:") {
    return await requestViaHttpProxy(endpoint, options, proxy);
  }

  if (protocol === "socks:" || protocol === "socks5:" || protocol === "socks5h:") {
    return await requestViaSocksProxy(endpoint, options, proxy);
  }

  throw new Error(`不支持的代理协议：${proxy.protocol}`);
}

async function requestViaHttpProxy(endpoint, options, proxy) {
  const target = new URL(endpoint);
  if (target.protocol === "http:") {
    return await requestHttp({
      module: proxy.protocol === "https:" ? https : http,
      requestOptions: {
        protocol: proxy.protocol,
        hostname: proxy.hostname,
        port: proxy.port || (proxy.protocol === "https:" ? 443 : 80),
        method: options.method || "POST",
        path: target.href,
        headers: {
          ...options.headers,
          host: target.host,
          ...getProxyAuthorizationHeader(proxy),
        },
      },
      body: options.body,
      signal: options.signal,
      viaProxy: true,
    });
  }

  const socket = await createHttpProxyTunnel(target, proxy, options.signal);
  return await requestHttpOverSocket(target, options, socket, { tls: true });
}

function createHttpProxyTunnel(target, proxy, signal) {
  return new Promise((resolve, reject) => {
    const requestModule = proxy.protocol === "https:" ? https : http;
    const request = requestModule.request({
      protocol: proxy.protocol,
      hostname: proxy.hostname,
      port: proxy.port || (proxy.protocol === "https:" ? 443 : 80),
      method: "CONNECT",
      path: `${target.hostname}:${target.port || 443}`,
      headers: getProxyAuthorizationHeader(proxy),
    });

    const cleanup = () => {
      signal?.removeEventListener("abort", abort);
      request.removeAllListeners();
    };
    const abort = () => {
      request.destroy(createAbortError("代理连接已取消。"));
    };
    if (signal) {
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
    }

    request.once("connect", (response, socket) => {
      cleanup();
      if (response.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`HTTP 代理 CONNECT 失败：${response.statusCode}`));
        return;
      }
      resolve(socket);
    });
    request.once("error", (error) => {
      cleanup();
      reject(error);
    });
    request.end();
  });
}

async function requestViaSocksProxy(endpoint, options, proxy) {
  const target = new URL(endpoint);
  const socket = await createSocks5Tunnel(target, proxy, options.signal);
  return await requestHttpOverSocket(target, options, socket, { tls: target.protocol === "https:" });
}

async function requestHttpOverSocket(target, options, socket, transport = {}) {
  let connection = socket;
  if (transport.tls) {
    connection = tls.connect({
      socket,
      servername: target.hostname,
    });
    await onceConnect(connection, options.signal);
  }

  return await requestHttp({
    module: target.protocol === "https:" ? https : http,
    requestOptions: {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      method: options.method || "POST",
      path: `${target.pathname}${target.search}`,
      headers: {
        ...options.headers,
        host: target.host,
      },
      createConnection: () => connection,
      agent: false,
    },
    body: options.body,
    signal: options.signal,
    viaProxy: true,
  });
}

function requestHttp({ module, requestOptions, body = "", signal, viaProxy = false }) {
  return new Promise((resolve, reject) => {
    const request = module.request({
      ...requestOptions,
      headers: {
        ...requestOptions.headers,
        "content-length": Buffer.byteLength(body),
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        cleanup();
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode || 0,
          text: Buffer.concat(chunks).toString("utf8"),
          viaProxy,
        });
      });
    });

    const cleanup = () => {
      signal?.removeEventListener("abort", abort);
      request.removeAllListeners("error");
    };
    const abort = () => request.destroy(createAbortError("模型请求已取消。"));
    if (signal) {
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
    }
    request.once("error", (error) => {
      cleanup();
      reject(error);
    });
    request.end(body);
  });
}

function createSocks5Tunnel(target, proxy, signal) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({
      host: proxy.hostname,
      port: Number(proxy.port || 1080),
    });
    const chunks = [];
    let stage = "greeting";

    const cleanup = () => {
      signal?.removeEventListener("abort", abort);
      socket.removeAllListeners("data");
      socket.removeAllListeners("error");
      socket.removeAllListeners("connect");
    };
    const fail = (error) => {
      cleanup();
      socket.destroy();
      reject(error);
    };
    const abort = () => fail(createAbortError("SOCKS5 代理连接已取消。"));
    if (signal) {
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
    }

    socket.once("connect", () => {
      const methods = proxy.username ? [0x00, 0x02] : [0x00];
      socket.write(Buffer.from([0x05, methods.length, ...methods]));
    });
    socket.on("data", (chunk) => {
      chunks.push(chunk);
      const buffer = Buffer.concat(chunks);
      try {
        if (stage === "greeting" && buffer.length >= 2) {
          chunks.length = 0;
          if (buffer[0] !== 0x05 || buffer[1] === 0xff) {
            throw new Error("SOCKS5 代理不接受当前认证方式。");
          }
          if (buffer[1] === 0x02) {
            stage = "auth";
            const username = Buffer.from(decodeURIComponent(proxy.username || ""));
            const password = Buffer.from(decodeURIComponent(proxy.password || ""));
            socket.write(Buffer.from([0x01, username.length, ...username, password.length, ...password]));
          } else {
            stage = "connect";
            socket.write(buildSocks5ConnectRequest(target));
          }
        } else if (stage === "auth" && buffer.length >= 2) {
          chunks.length = 0;
          if (buffer[1] !== 0x00) {
            throw new Error("SOCKS5 代理用户名或密码认证失败。");
          }
          stage = "connect";
          socket.write(buildSocks5ConnectRequest(target));
        } else if (stage === "connect" && buffer.length >= 5) {
          const expectedLength = getSocks5ResponseLength(buffer);
          if (buffer.length < expectedLength) {
            return;
          }
          if (buffer[1] !== 0x00) {
            throw new Error(`SOCKS5 CONNECT 失败：0x${buffer[1].toString(16).padStart(2, "0")}`);
          }
          cleanup();
          resolve(socket);
        }
      } catch (error) {
        fail(error);
      }
    });
    socket.once("error", fail);
  });
}

function buildSocks5ConnectRequest(target) {
  const port = Number(target.port || (target.protocol === "https:" ? 443 : 80));
  const portBytes = Buffer.from([(port >> 8) & 0xff, port & 0xff]);
  const hostname = target.hostname;
  const ipVersion = net.isIP(hostname);
  if (ipVersion === 4) {
    return Buffer.concat([
      Buffer.from([0x05, 0x01, 0x00, 0x01]),
      Buffer.from(hostname.split(".").map((part) => Number(part))),
      portBytes,
    ]);
  }
  const hostBytes = Buffer.from(hostname);
  return Buffer.concat([
    Buffer.from([0x05, 0x01, 0x00, 0x03, hostBytes.length]),
    hostBytes,
    portBytes,
  ]);
}

function getSocks5ResponseLength(buffer) {
  const atyp = buffer[3];
  if (atyp === 0x01) {
    return 10;
  }
  if (atyp === 0x04) {
    return 22;
  }
  if (atyp === 0x03) {
    return 5 + Number(buffer[4] || 0) + 2;
  }
  return 5;
}

function onceConnect(socket, signal) {
  return new Promise((resolve, reject) => {
    if (socket.readyState === "open") {
      resolve();
      return;
    }
    const cleanup = () => {
      signal?.removeEventListener("abort", abort);
      socket.removeListener("secureConnect", onConnect);
      socket.removeListener("connect", onConnect);
      socket.removeListener("error", onError);
    };
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const abort = () => {
      cleanup();
      socket.destroy();
      reject(createAbortError("代理 TLS 连接已取消。"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    socket.once("secureConnect", onConnect);
    socket.once("connect", onConnect);
    socket.once("error", onError);
  });
}

function getProxyAuthorizationHeader(proxy) {
  if (!proxy.username) {
    return {};
  }

  const username = decodeURIComponent(proxy.username || "");
  const password = decodeURIComponent(proxy.password || "");
  return {
    "proxy-authorization": `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
  };
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
  const safePrompt = sanitizeClaudeCliArgument(prompt);
  const safeSystemPrompt = sanitizeClaudeCliArgument(systemPrompt);

  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      safePrompt,
      "--bare",
      "--no-session-persistence",
      "--tools",
      "",
      "--model",
      settings.model || "kimi-for-coding",
      "--output-format",
      "json",
      "--system-prompt",
      safeSystemPrompt,
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
    }, options.timeoutMs || 180_000);
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

function sanitizeClaudeCliArgument(value) {
  return String(value || "").replace(/\0/g, "");
}

function buildCommandPath() {
  const parts = [
    ...(process.env.PATH || "").split(path.delimiter),
    ...EXTRA_BIN_DIRS,
  ].filter(Boolean);

  return [...new Set(parts)].join(path.delimiter);
}

function resolveClaudeCommand(commandPath) {
  return getClaudeCommandDiagnostics(commandPath).command;
}

function getClaudeCommandDiagnostics(commandPath) {
  if (process.env.PAPERLENS_CLAUDE_CLI) {
    const command = process.env.PAPERLENS_CLAUDE_CLI;
    const verified = path.isAbsolute(command) ? existsSync(command) : false;
    return {
      command,
      source: "env",
      available: !path.isAbsolute(command) || verified,
      verified,
    };
  }

  for (const directory of commandPath.split(path.delimiter)) {
    const candidate = path.join(directory, "claude");
    if (existsSync(candidate)) {
      return {
        command: candidate,
        source: "path",
        available: true,
        verified: true,
      };
    }
  }

  return {
    command: "claude",
    source: "missing",
    available: false,
    verified: false,
  };
}

function isRunningInDocker() {
  return existsSync("/.dockerenv") ||
    process.env.PAPERLENS_RUNTIME === "docker" ||
    process.env.container === "docker";
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

function getEffectiveProxyUrl(proxyUrl = "", endpoint = "") {
  const target = endpoint ? new URL(endpoint) : null;
  if (target && shouldBypassProxy(target)) {
    return "";
  }

  const directProxy = normalizeOptionalProxyUrl(proxyUrl);
  if (directProxy) {
    return directProxy;
  }

  const paperlensProxy = normalizeOptionalProxyUrl(process.env.PAPERLENS_PROXY_URL);
  if (paperlensProxy) {
    return paperlensProxy;
  }

  const protocol = target?.protocol || "https:";
  const protocolProxy = protocol === "http:"
    ? process.env.HTTP_PROXY || process.env.http_proxy
    : process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  const envProxy = normalizeOptionalProxyUrl(protocolProxy || process.env.ALL_PROXY || process.env.all_proxy);
  return envProxy || "";
}

function normalizeOptionalProxyUrl(proxyUrl = "") {
  const clean = String(proxyUrl || "").trim();
  if (!clean) {
    return "";
  }

  try {
    return normalizeProxyUrl(clean);
  } catch {
    return clean;
  }
}

function shouldBypassProxy(target) {
  const noProxy = String(process.env.NO_PROXY || process.env.no_proxy || "").trim();
  if (!noProxy) {
    return false;
  }

  const host = target.hostname.toLowerCase();
  const port = target.port || (target.protocol === "https:" ? "443" : "80");
  for (const rawRule of noProxy.split(",")) {
    const rule = rawRule.trim().toLowerCase();
    if (!rule) {
      continue;
    }
    if (rule === "*") {
      return true;
    }
    if (rule.includes(":")) {
      const [ruleHost, rulePort] = rule.split(":");
      if (rulePort && rulePort !== port) {
        continue;
      }
      if (hostMatchesNoProxyRule(host, ruleHost)) {
        return true;
      }
    } else if (hostMatchesNoProxyRule(host, rule)) {
      return true;
    }
  }

  return false;
}

function hostMatchesNoProxyRule(host, rule) {
  if (!rule) {
    return false;
  }

  const cleanRule = rule.startsWith(".") ? rule.slice(1) : rule;
  return host === cleanRule || host.endsWith(`.${cleanRule}`);
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

function readPackageVersion() {
  try {
    const pkg = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8"));
    return String(pkg.version || "0.0.0");
  } catch {
    return "0.0.0";
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

function normalizeSettings(settings = {}) {
  const provider = String(settings.provider || "").trim();
  const apiKey = String(settings.apiKey || "").trim();
  const apiKeyRef = String(settings.apiKeyRef || "").trim();
  const model = normalizeModelName(String(settings.model || "").trim());
  const baseUrl = resolveBaseUrlForProvider(provider, String(settings.baseUrl || "https://api.openai.com/v1").trim());
  const agentBudgetUsd = Number(settings.agentBudgetUsd || 500);
  const taskBudgetUsd = normalizeTaskBudgetUsd(settings.taskBudgetUsd);
  const analysisProfile = normalizeAnalysisProfile(settings.analysisProfile);
  const normalizedApiKey = normalizeApiKey(apiKey);
  const proxyUrl = normalizeProxyUrl(String(settings.proxyUrl || ""));

  if (!normalizedApiKey && !apiKeyRef && baseUrl !== "local:claude-config") {
    throw badRequest("API Key is required.");
  }

  if (normalizedApiKey && baseUrl === "local:claude-kimi" && !normalizedApiKey.startsWith("sk-kimi-")) {
    throw badRequest("Kimi Code Key 格式不对：Kimi Code Direct 需要输入以 sk-kimi- 开头的完整 Key。请不要复制控制台列表里的脱敏显示值。");
  }

  if (!model) {
    throw badRequest("Model name is required.");
  }

  return {
    provider,
    apiKey: normalizedApiKey,
    apiKeyRef,
    model,
    baseUrl,
    agentBudgetUsd,
    taskBudgetUsd,
    proxyUrl,
    analysisProfile,
  };
}

function normalizeAnalysisProfile(profile) {
  return profile === "fast" ? "fast" : "quality";
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
  const apiKeyRef = String(settings.apiKeyRef || "").trim();
  const savedKey = apiKeyRef ? secretStore.keys.get(apiKeyRef) : null;
  const apiKey = normalizeApiKey(String(settings.apiKey || ""));
  let proxyUrl = "";
  try {
    proxyUrl = normalizeProxyUrl(String(settings.proxyUrl || ""));
  } catch {
    proxyUrl = String(settings.proxyUrl || "").trim();
  }
  const keyPrefix = apiKey ? getApiKeyPrefix(apiKey) : savedKey?.keyPrefix || "missing";
  const keyLength = apiKey ? apiKey.length : savedKey?.keyLength || 0;
  const usesKimiCodeDirect = baseUrl === "local:claude-kimi" && !KIMI_CODE_USE_CLAUDE_CLI;
  const isClaudeProvider = baseUrl === "local:claude-config" || (baseUrl === "local:claude-kimi" && !usesKimiCodeDirect);
  const commandPath = isClaudeProvider ? buildCommandPath() : "";
  const claudeCommand = isClaudeProvider
    ? getClaudeCommandDiagnostics(commandPath)
    : { command: "", source: "none", available: false };
  const endpoint = baseUrl === "local:claude-kimi"
    ? KIMI_CODE_ANTHROPIC_ENDPOINT
    : baseUrl === "local:claude-config"
      ? ""
      : getChatCompletionsEndpoint(baseUrl);
  const proxyTransport = getProxyTransportDiagnostics(proxyUrl, endpoint, isClaudeProvider);
  const proxyPresent = proxyTransport.present;

  return {
    provider,
    endpoint: baseUrl === "local:claude-kimi"
      ? usesKimiCodeDirect
        ? KIMI_CODE_ANTHROPIC_ENDPOINT
        : "local claude CLI + page Kimi key -> https://api.kimi.com/coding/"
      : baseUrl === "local:claude-config"
        ? "local claude CLI configured auth"
      : endpoint,
    model,
    keyPresent: Boolean(apiKey || savedKey),
    keyRef: savedKey?.id || "",
    keySaved: Boolean(savedKey && !apiKey),
    keyPrefix,
    keyLength,
    keyFormatOk: baseUrl !== "local:claude-kimi" || keyPrefix === "sk-kimi",
    claudeCommand: claudeCommand.command,
    claudeCommandSource: claudeCommand.source,
    claudeAvailable: claudeCommand.available,
    claudeVerified: claudeCommand.verified,
    proxyPresent,
    proxySource: getProxySource(proxyUrl),
    proxyAppliedToAgent: proxyTransport.applied,
    proxyTransport,
    runtime: {
      isDocker: isRunningInDocker(),
      host: HOST,
      port: PORT,
    },
  };
}

function buildModelDiagnosticReport(settings = {}) {
  const provider = String(settings.provider || "").trim() || "custom";
  const rawBaseUrl = String(settings.baseUrl || "https://api.openai.com/v1").trim();
  const baseUrl = resolveBaseUrlForProvider(provider, rawBaseUrl);
  const apiKey = normalizeApiKey(String(settings.apiKey || ""));
  const apiKeyRef = String(settings.apiKeyRef || "").trim();
  const savedKey = apiKeyRef ? secretStore.keys.get(apiKeyRef) : null;
  const diagnostics = getSettingsDiagnostics(settings);
  const usesKimiCodeDirect = baseUrl === "local:claude-kimi" && !KIMI_CODE_USE_CLAUDE_CLI;
  const isClaudeProvider = baseUrl === "local:claude-config" || (baseUrl === "local:claude-kimi" && !usesKimiCodeDirect);
  const commandPath = isClaudeProvider ? buildCommandPath() : process.env.PATH || "";
  const keyRefMatches = savedKey
    ? savedKey.provider === provider && savedKey.baseUrl === baseUrl
    : false;
  return buildModelDiagnosticReportPayload(settings, {
    packageVersion: PACKAGE_VERSION,
    serviceSchemaVersion: SERVICE_SCHEMA_VERSION,
    serviceStartedAt: new Date(SERVICE_STARTED_AT_MS).toISOString(),
    runtime: {
      isDocker: isRunningInDocker(),
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      host: HOST,
      port: PORT,
      cwd: __dirname,
    },
    homeDir: process.env.HOME || "",
    diagnostics,
    savedKey,
    keyRefMatches,
    commandPath,
    env: process.env,
    usesKimiCodeDirect,
    kimiCodeAnthropicEndpoint: KIMI_CODE_ANTHROPIC_ENDPOINT,
  });
}

function getProxyTransportDiagnostics(proxyUrl, endpoint, isClaudeProvider) {
  const effectiveProxyUrl = endpoint ? getEffectiveProxyUrl(proxyUrl, endpoint) : normalizeOptionalProxyUrl(proxyUrl || process.env.PAPERLENS_PROXY_URL);
  const source = getProxySource(proxyUrl);
  let protocol = "";
  try {
    protocol = effectiveProxyUrl ? new URL(effectiveProxyUrl).protocol.replace(/:$/, "").toLowerCase() : "";
  } catch {
    protocol = "invalid";
  }
  const supported = !effectiveProxyUrl || ["http", "https", "socks", "socks5", "socks5h"].includes(protocol);
  const mode = isClaudeProvider
    ? "cli-env"
    : effectiveProxyUrl
      ? protocol.startsWith("socks") ? "socks5-tunnel" : "http-connect"
      : "direct";
  return {
    present: Boolean(effectiveProxyUrl || hasProxyEnv(proxyUrl)),
    applied: isClaudeProvider ? Boolean(effectiveProxyUrl || hasProxyEnv(proxyUrl)) : Boolean(effectiveProxyUrl && supported),
    supported,
    source,
    protocol: protocol || "",
    mode,
    effectiveProxy: redactProxyUrl(effectiveProxyUrl),
    noProxyBypassed: Boolean(endpoint && !effectiveProxyUrl && hasProxyEnv(proxyUrl) && shouldBypassProxy(new URL(endpoint))),
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

async function readJsonFileWithRecovery(filePath, options = {}) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      if (options.optional) {
        return null;
      }
      throw error;
    }

    const backup = await readNewestValidJsonBackup(filePath);
    if (!backup) {
      throw error;
    }

    console.warn(`Recovered ${path.basename(filePath)} from backup ${path.basename(backup.path)} after JSON read failed: ${error.message}`);
    if (options.restore !== false) {
      await writeJsonFileAtomic(filePath, backup.payload, {
        backup: false,
        mode: options.mode,
      });
    }
    return backup.payload;
  }
}

async function writeJsonFileAtomic(filePath, payload, options = {}) {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });

  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(tmpPath, JSON.stringify(payload, null, 2), options.mode ? { mode: options.mode } : undefined);
    await rename(tmpPath, filePath);
  } catch (error) {
    await unlink(tmpPath).catch(() => {});
    throw error;
  }
  await backupJsonFileAfterWrite(filePath, payload, options).catch((error) => {
    console.warn(`Could not create JSON backup for ${path.basename(filePath)}: ${error.message}`);
  });
}

async function backupJsonFileAfterWrite(filePath, payload, options = {}) {
  if (options.backup === false || JSON_BACKUP_RETENTION <= 0) {
    return;
  }

  const backupDir = getJsonBackupDir(filePath);
  const backups = await listJsonBackups(filePath);
  const newest = backups[0];
  if (newest && Date.now() - newest.mtimeMs < JSON_BACKUP_MIN_INTERVAL_MS) {
    return;
  }

  await mkdir(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `${path.basename(filePath, ".json")}-${formatBackupTimestamp(new Date())}.json`);
  await writeFile(backupPath, JSON.stringify(payload, null, 2), options.mode ? { mode: options.mode } : undefined);
  await pruneJsonBackups(filePath);
}

async function readNewestValidJsonBackup(filePath) {
  const backups = await listJsonBackups(filePath);
  for (const backup of backups) {
    try {
      return {
        path: backup.path,
        payload: JSON.parse(await readFile(backup.path, "utf8")),
      };
    } catch {
      // Try the next newest backup.
    }
  }

  return null;
}

async function pruneJsonBackups(filePath) {
  const backups = await listJsonBackups(filePath);
  for (const backup of backups.slice(JSON_BACKUP_RETENTION)) {
    await unlink(backup.path).catch(() => {});
  }
}

async function listJsonBackups(filePath) {
  const backupDir = getJsonBackupDir(filePath);
  const entries = await readdir(backupDir).catch(() => []);
  const backups = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) {
      continue;
    }

    const backupPath = path.join(backupDir, entry);
    const fileStat = await stat(backupPath).catch(() => null);
    if (!fileStat?.isFile()) {
      continue;
    }

    backups.push({
      path: backupPath,
      mtimeMs: fileStat.mtimeMs,
    });
  }

  return backups.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function getJsonBackupDir(filePath) {
  return path.join(DATA_BACKUP_DIR, sanitizeBackupKey(path.basename(filePath, ".json")));
}

function sanitizeBackupKey(value) {
  return String(value || "json")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "json";
}

function formatBackupTimestamp(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function loadPaper(paperId) {
  const paperPath = getPaperPath(paperId);
  const paper = await readJsonFileWithRecovery(paperPath);
  const upgradedArtifacts = upgradePaperArtifacts(paper);
  const upgradedContext = upgradePaperContextProfile(paper);
  if (upgradedArtifacts || upgradedContext) {
    await savePaper(paper);
  }
  enrichPaperParagraphLocations(paper);
  return paper;
}

function upgradePaperContextProfile(paper) {
  if (!Array.isArray(paper.paragraphs) || !paper.paragraphs.length) {
    return false;
  }

  let changed = false;
  if (!Array.isArray(paper.sections) || !paper.sections.length) {
    paper.sections = inferSections(paper.paragraphs);
    changed = true;
  }

  const needsSectionContext = paper.sections.some((section) =>
    !section.summary || !Array.isArray(section.keywords));
  if (needsSectionContext) {
    enrichSectionsWithContext(paper.sections, paper.paragraphs, []);
    changed = true;
  }

  if (!paper.contextProfile || paper.contextProfile.version !== 1) {
    paper.contextProfile = buildPaperContextProfile(paper.paragraphs, paper.sections, []);
    changed = true;
  }

  return changed;
}

function upgradePaperArtifacts(paper) {
  return rebuildPaperVisualArtifacts(paper).changed;
}

function rebuildPaperVisualArtifacts(paper, options = {}) {
  const force = Boolean(options.force);
  const artifacts = Array.isArray(paper.pageArtifacts) ? paper.pageArtifacts : [];
  const manualArtifactOverrides = collectManualArtifactOverrides(artifacts);
  const extractionPages = Array.isArray(paper.extractionPages) ? paper.extractionPages : [];
  const previousArtifactCount = artifacts.length;
  const needsVisualStructure = extractionPages.some((page) =>
    page.visualStructureVersion !== VISUAL_STRUCTURE_VERSION || !Array.isArray(page.visualRegions));
  const hasExtractableArtifacts = extractionPages.some((page) =>
    Array.isArray(page.blocks) && page.blocks.some((block) => classifyPageArtifact(block)));
  const needsUpgrade = !artifacts.length
    ? hasExtractableArtifacts
    : artifacts.some((artifact) =>
      ["caption", "formula", "code", "figure-text"].includes(artifact.type) &&
        (artifact.cropVersion !== ARTIFACT_CROP_VERSION || !artifact.crop || !artifact.cropQuality));
  const emptyStats = buildVisualRebuildStats(paper, [], previousArtifactCount);

  if (!Array.isArray(paper.extractionPages) || !paper.extractionPages.length) {
    return { changed: false, reason: "missing-extraction-pages", stats: emptyStats };
  }

  if (!force && !needsUpgrade && !needsVisualStructure) {
    return { changed: false, reason: "already-current", stats: emptyStats };
  }

  const pages = enhancePagesWithVisualArtifacts(paper.extractionPages.map((page) => {
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
  }));

  paper.extractionPages = pages.map((page) => ({
    pageNumber: page.pageNumber,
    text: page.text || "",
    blocks: Array.isArray(page.blocks) ? page.blocks : [],
    visualRegions: Array.isArray(page.visualRegions) ? page.visualRegions : [],
    visualStructureVersion: page.visualStructureVersion || null,
    width: page.width || null,
    height: page.height || null,
  }));
  paper.pageArtifacts = applyManualArtifactOverrides(extractVisualPageArtifacts(pages), manualArtifactOverrides);
  attachParagraphArtifactLinks(paper);
  const stats = buildVisualRebuildStats(paper, pages, previousArtifactCount);
  return { changed: true, reason: force ? "forced" : "upgraded", stats };
}

function formatVisualRebuildMessage(stats = {}) {
  return [
    `已重建 ${stats.pages || 0} 页视觉结构`,
    `图表/公式/代码 ${stats.artifacts || 0} 个`,
    `像素收紧 ${stats.pixelRefined || 0} 个`,
    `低置信 ${stats.lowConfidence || 0} 个`,
  ].join(" · ");
}

function formatVisualRebuildAllMessage(summary = {}) {
  return [
    `已维护 ${summary.rebuilt || 0}/${summary.papers || 0} 篇论文`,
    `页面 ${summary.pages || 0}`,
    `图表/公式/代码 ${summary.artifacts || 0} 个`,
    `失败 ${summary.failed || 0}`,
    summary.resourceLimited ? `资源保护跳过 ${summary.resourceLimited}` : "",
  ].filter(Boolean).join(" · ");
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
  await writeJsonFileAtomic(getPaperPath(paper.id), paper);
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

function json(res, payload, status = 200, headers = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(payload));
}
