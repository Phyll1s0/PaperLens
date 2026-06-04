import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  buildCropQuality,
  normalizeVisualCrop,
} from "./visual-crop-quality.js";

export const VISUAL_ANALYSIS_PROVIDER_VERSION = 1;

const VISUAL_TYPES = new Set(["figure", "table", "formula", "code"]);

export function normalizeVisualAnalysisProvider(value) {
  const clean = String(value || "heuristic").trim().toLowerCase();
  if (["heuristic", "none", "off"].includes(clean)) {
    return "heuristic";
  }
  if (["json", "model-json", "layout-json", "file"].includes(clean)) {
    return "json";
  }
  if (["command", "cmd", "script", "external"].includes(clean)) {
    return "command";
  }
  return "heuristic";
}

export function loadVisualAnalysisProvider(options = {}) {
  const provider = normalizeVisualAnalysisProvider(options.provider);
  if (provider === "command") {
    return loadCommandVisualAnalysisProvider(options);
  }

  if (provider !== "json") {
    return {
      version: VISUAL_ANALYSIS_PROVIDER_VERSION,
      provider: "heuristic",
      enabled: false,
      source: "heuristic",
      pages: new Map(),
      diagnostics: {
        status: "off",
        message: "Using built-in heuristic visual structure.",
      },
    };
  }

  const jsonPath = String(options.jsonPath || options.path || "").trim();
  if (!jsonPath) {
    return buildProviderError("json", "", "PAPERLENS_VISUAL_PROVIDER_PATH is required when PAPERLENS_VISUAL_PROVIDER=json.");
  }

  const resolvedPath = path.resolve(jsonPath);
  try {
    const payload = JSON.parse(readFileSync(resolvedPath, "utf8"));
    const pages = normalizeProviderPayload(payload);
    return {
      version: VISUAL_ANALYSIS_PROVIDER_VERSION,
      provider: "json",
      enabled: true,
      source: "model-json",
      path: resolvedPath,
      pages,
      diagnostics: {
        status: "ok",
        message: `Loaded visual model regions from ${resolvedPath}.`,
        pages: pages.size,
        regions: [...pages.values()].reduce((total, regions) => total + regions.length, 0),
      },
    };
  } catch (error) {
    return buildProviderError("json", resolvedPath, error.message);
  }
}

export function getVisualModelRegionsForPage(page = {}, providerRuntime = null) {
  if (!providerRuntime?.enabled || !providerRuntime.pages) {
    return [];
  }

  const pageNumber = Number(page.pageNumber || 0);
  if (providerRuntime.provider === "command") {
    return getCommandProviderRegionsForPage(page, providerRuntime);
  }

  const candidates = providerRuntime.pages.get(pageNumber) || [];
  return candidates
    .map((candidate, index) => normalizeProviderRegionForPage(candidate, page, providerRuntime, index))
    .filter(Boolean);
}

export function getVisualAnalysisProviderStatus(providerRuntime = null) {
  if (!providerRuntime) {
    return {
      version: VISUAL_ANALYSIS_PROVIDER_VERSION,
      provider: "heuristic",
      enabled: false,
      status: "off",
      message: "Using built-in heuristic visual structure.",
    };
  }

  return {
    version: providerRuntime.version || VISUAL_ANALYSIS_PROVIDER_VERSION,
    provider: providerRuntime.provider || "heuristic",
    enabled: Boolean(providerRuntime.enabled),
    source: providerRuntime.source || "",
    path: providerRuntime.path || "",
    command: providerRuntime.provider === "command" ? providerRuntime.command || "" : "",
    args: providerRuntime.provider === "command" ? providerRuntime.args || [] : [],
    timeoutMs: providerRuntime.provider === "command" ? providerRuntime.timeoutMs || null : null,
    ...(providerRuntime.diagnostics || {}),
  };
}

function buildProviderError(provider, providerPath, message) {
  return {
    version: VISUAL_ANALYSIS_PROVIDER_VERSION,
    provider,
    enabled: false,
    source: provider === "command" ? "model-command" : "model-json",
    path: providerPath,
    pages: new Map(),
    diagnostics: {
      status: "error",
      message,
      pages: 0,
      regions: 0,
    },
  };
}

function loadCommandVisualAnalysisProvider(options = {}) {
  try {
    const cwd = path.resolve(String(options.cwd || process.cwd()));
    const command = normalizeCommandPath(options.command || options.path, cwd);
    if (!command) {
      return buildProviderError("command", "", "PAPERLENS_VISUAL_PROVIDER_COMMAND is required when PAPERLENS_VISUAL_PROVIDER=command.");
    }

    const args = normalizeCommandArgs(options.commandArgs || options.args);
    const timeoutMs = clampInteger(options.timeoutMs, 5000, 500, 60000);
    const maxBuffer = clampInteger(options.maxBufferBytes, 2 * 1024 * 1024, 64 * 1024, 16 * 1024 * 1024);
    return {
      version: VISUAL_ANALYSIS_PROVIDER_VERSION,
      provider: "command",
      enabled: true,
      source: "model-command",
      path: command,
      command,
      args,
      cwd,
      timeoutMs,
      maxBuffer,
      pages: new Map(),
      diagnostics: {
        status: "ok",
        message: "Command visual provider is configured. It runs once per page during visual rebuild.",
        pages: 0,
        regions: 0,
        durationMs: 0,
        errors: 0,
        timeoutMs,
      },
    };
  } catch (error) {
    return buildProviderError("command", String(options.command || options.path || ""), error.message);
  }
}

function getCommandProviderRegionsForPage(page = {}, providerRuntime) {
  const pageNumber = Number(page.pageNumber || 0);
  if (!pageNumber) {
    return [];
  }
  if (providerRuntime.pages.has(pageNumber)) {
    return providerRuntime.pages.get(pageNumber)
      .map((candidate, index) => normalizeProviderRegionForPage(candidate, page, providerRuntime, index))
      .filter(Boolean);
  }

  const startedAt = Date.now();
  try {
    const input = JSON.stringify({
      version: VISUAL_ANALYSIS_PROVIDER_VERSION,
      page: serializePageForCommandProvider(page),
    });
    const result = spawnSync(providerRuntime.command, providerRuntime.args, {
      input,
      cwd: providerRuntime.cwd,
      encoding: "utf8",
      timeout: providerRuntime.timeoutMs,
      maxBuffer: providerRuntime.maxBuffer,
      shell: false,
      windowsHide: true,
    });
    const durationMs = Date.now() - startedAt;
    providerRuntime.diagnostics.durationMs = Number(providerRuntime.diagnostics.durationMs || 0) + durationMs;
    providerRuntime.diagnostics.pages = Number(providerRuntime.diagnostics.pages || 0) + 1;

    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      const stderr = String(result.stderr || "").trim().slice(0, 500);
      throw new Error(`Command exited with status ${result.status}${stderr ? `: ${stderr}` : ""}`);
    }

    const payload = parseCommandProviderOutput(result.stdout);
    const candidates = normalizeCommandProviderRegions(payload, pageNumber);
    providerRuntime.pages.set(pageNumber, candidates);
    providerRuntime.diagnostics.regions = Number(providerRuntime.diagnostics.regions || 0) + candidates.length;
    providerRuntime.diagnostics.status = providerRuntime.diagnostics.errors ? "warn" : "ok";
    providerRuntime.diagnostics.message = `Command visual provider processed ${providerRuntime.diagnostics.pages} page(s), ${providerRuntime.diagnostics.regions} region(s).`;
    return candidates
      .map((candidate, index) => normalizeProviderRegionForPage(candidate, page, providerRuntime, index))
      .filter(Boolean);
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    providerRuntime.pages.set(pageNumber, []);
    providerRuntime.diagnostics.durationMs = Number(providerRuntime.diagnostics.durationMs || 0) + durationMs;
    providerRuntime.diagnostics.errors = Number(providerRuntime.diagnostics.errors || 0) + 1;
    providerRuntime.diagnostics.status = "error";
    providerRuntime.diagnostics.message = "Command visual provider failed for at least one page.";
    providerRuntime.diagnostics.error = formatProviderError(error);
    providerRuntime.diagnostics.lastError = formatProviderError(error);
    providerRuntime.diagnostics.failedPageNumber = pageNumber;
    return [];
  }
}

function normalizeProviderPayload(payload) {
  const pages = new Map();
  if (Array.isArray(payload?.pages)) {
    for (const page of payload.pages) {
      const pageNumber = Number(page.pageNumber || page.page || page.index || 0);
      const regions = Array.isArray(page.regions) ? page.regions : Array.isArray(page.visualRegions) ? page.visualRegions : [];
      if (pageNumber > 0 && regions.length) {
        pages.set(pageNumber, regions);
      }
    }
    return pages;
  }

  const source = payload?.pages && typeof payload.pages === "object" ? payload.pages : payload;
  if (source && typeof source === "object") {
    for (const [key, value] of Object.entries(source)) {
      const pageNumber = Number(String(key).replace(/^page[_-]?/i, ""));
      const regions = Array.isArray(value) ? value : Array.isArray(value?.regions) ? value.regions : [];
      if (pageNumber > 0 && regions.length) {
        pages.set(pageNumber, regions);
      }
    }
  }
  return pages;
}

function serializePageForCommandProvider(page = {}) {
  return {
    pageNumber: Number(page.pageNumber || 0) || null,
    width: Number(page.width || 0) || null,
    height: Number(page.height || 0) || null,
    imagePath: page.imagePath || "",
    imageWidth: Number(page.imageWidth || 0) || null,
    imageHeight: Number(page.imageHeight || 0) || null,
    text: String(page.text || "").slice(0, 20000),
    blocks: (Array.isArray(page.blocks) ? page.blocks : []).slice(0, 800).map((block, index) => ({
      index,
      text: String(block?.text || "").slice(0, 4000),
      x: normalizeNullableNumber(block?.x),
      y: normalizeNullableNumber(block?.y),
      width: normalizeNullableNumber(block?.width),
      height: normalizeNullableNumber(block?.height),
      lineCount: normalizeNullableNumber(block?.lineCount),
    })),
  };
}

function parseCommandProviderOutput(stdout) {
  const text = String(stdout || "").trim();
  if (!text) {
    return { regions: [] };
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Command output is not valid JSON: ${error.message}`);
  }
}

function normalizeCommandProviderRegions(payload, pageNumber) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.regions)) {
    return payload.regions;
  }

  const pages = normalizeProviderPayload(payload);
  return pages.get(pageNumber) || [];
}

function normalizeCommandPath(value, cwd) {
  const clean = String(value || "").trim();
  if (!clean || clean.includes("\0")) {
    return "";
  }
  if (!clean.includes("/") && !clean.includes("\\")) {
    return clean;
  }

  const resolved = path.isAbsolute(clean) ? path.normalize(clean) : path.resolve(cwd, clean);
  if (!path.isAbsolute(clean) && !resolved.startsWith(`${cwd}${path.sep}`) && resolved !== cwd) {
    throw new Error("Command path must stay inside the PaperLens workspace when it is relative.");
  }
  return resolved;
}

function normalizeCommandArgs(value) {
  if (value === undefined || value === null || value === "") {
    return [];
  }

  const raw = Array.isArray(value) ? value : JSON.parse(String(value));
  if (!Array.isArray(raw)) {
    throw new Error("PAPERLENS_VISUAL_PROVIDER_ARGS must be a JSON array of strings.");
  }

  return raw.map((item) => {
    const arg = String(item ?? "");
    if (arg.includes("\0")) {
      throw new Error("Command args cannot contain null bytes.");
    }
    return arg;
  });
}

function clampInteger(value, defaultValue, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return defaultValue;
  }
  return Math.trunc(Math.max(min, Math.min(max, number)));
}

function normalizeNullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatProviderError(error) {
  if (!error) {
    return "";
  }
  if (error.code === "ETIMEDOUT" || error.signal === "SIGTERM") {
    return "Command timed out.";
  }
  return String(error.message || error).slice(0, 500);
}

function normalizeProviderRegionForPage(candidate, page, providerRuntime, index) {
  const visualType = normalizeVisualType(candidate.visualType || candidate.type || candidate.labelType);
  if (!visualType) {
    return null;
  }

  const pageWidth = Number(candidate.pageWidth || page.width || 0);
  const pageHeight = Number(candidate.pageHeight || page.height || 0);
  const crop = normalizeCandidateCrop(candidate, pageWidth, pageHeight);
  if (!crop) {
    return null;
  }

  const score = normalizeScore(candidate.score ?? candidate.confidence ?? candidate.probability);
  const cropQuality = {
    ...buildCropQuality(crop, visualType),
    modelProvider: providerRuntime.provider,
    modelConfidence: score,
  };
  if (score !== null && score < 0.45) {
    cropQuality.confidence = "low";
  }

  const candidateId = sanitizeRegionId(candidate.id || candidate.label || `${visualType}_${index + 1}`);
  return {
    id: `model_${page.pageNumber}_${candidateId}_${index + 1}`,
    source: providerRuntime.source || "model",
    visualType,
    label: String(candidate.label || candidate.name || "").trim(),
    x: crop.x,
    y: crop.y,
    width: crop.width,
    height: crop.height,
    pageWidth: crop.pageWidth,
    pageHeight: crop.pageHeight,
    pixelRefined: false,
    modelProvider: providerRuntime.provider,
    modelConfidence: score,
    cropQuality,
  };
}

function normalizeVisualType(value) {
  const clean = String(value || "").trim().toLowerCase();
  if (VISUAL_TYPES.has(clean)) {
    return clean;
  }
  if (["fig", "image", "picture", "diagram", "plot", "chart"].includes(clean)) {
    return "figure";
  }
  if (["equation", "math", "display-formula"].includes(clean)) {
    return "formula";
  }
  if (["algorithm", "listing"].includes(clean)) {
    return "code";
  }
  return "";
}

function normalizeCandidateCrop(candidate, pageWidth, pageHeight) {
  const bbox = Array.isArray(candidate.bbox)
    ? candidate.bbox
    : Array.isArray(candidate.box) ? candidate.box : null;
  const raw = bbox
    ? {
        x: bbox[0],
        y: bbox[1],
        width: bbox[2],
        height: bbox[3],
      }
    : {
        x: candidate.x ?? candidate.left,
        y: candidate.y ?? candidate.top,
        width: candidate.width ?? (candidate.right !== undefined && candidate.left !== undefined
          ? Number(candidate.right) - Number(candidate.left)
          : undefined),
        height: candidate.height ?? (candidate.bottom !== undefined && candidate.top !== undefined
          ? Number(candidate.bottom) - Number(candidate.top)
          : undefined),
      };

  if (!pageWidth || !pageHeight) {
    return null;
  }

  if (![raw.x, raw.y, raw.width, raw.height].every((value) => Number.isFinite(Number(value))) ||
    Number(raw.width) <= 0 || Number(raw.height) <= 0) {
    return null;
  }

  return normalizeVisualCrop({
    ...raw,
    pageWidth,
    pageHeight,
  });
}

function normalizeScore(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }
  return Math.max(0, Math.min(1, number > 1 ? number / 100 : number));
}

function sanitizeRegionId(value) {
  return String(value || "")
    .trim()
    .replace(/[^\w.-]+/g, "_")
    .slice(0, 48) || "region";
}
