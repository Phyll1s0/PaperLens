import http from "node:http";
import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const DATA_DIR = path.join(__dirname, "data");
const CACHE_DIR = path.join(__dirname, ".cache");
const WORKSPACE_CACHE_KEY = createHash("sha1").update(__dirname).digest("hex").slice(0, 12);
const SWIFT_MODULE_CACHE_DIR = path.join(CACHE_DIR, `swift-module-cache-${WORKSPACE_CACHE_KEY}`);
const TMP_DIR = path.join(CACHE_DIR, "tmp");
const MAX_UPLOAD_BYTES = 120 * 1024 * 1024;

await mkdir(UPLOAD_DIR, { recursive: true });
await mkdir(DATA_DIR, { recursive: true });
await mkdir(SWIFT_MODULE_CACHE_DIR, { recursive: true });
await mkdir(TMP_DIR, { recursive: true });

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/") {
      return serveStatic(res, path.join(PUBLIC_DIR, "index.html"));
    }

    if (req.method === "GET" && url.pathname.startsWith("/public/")) {
      return serveStatic(res, path.join(__dirname, url.pathname));
    }

    if (req.method === "POST" && url.pathname === "/api/papers/upload") {
      return await handleUpload(req, res);
    }

    if (req.method === "GET" && url.pathname === "/api/papers") {
      return json(res, await listPapers());
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
    console.error(error);
    return json(res, { error: error.message || "Internal server error" }, 500);
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
  await writeFile(pdfPath, filePart.content);

  const extraction = await extractPdfText(pdfPath);
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

async function handleAnalyze(req, res) {
  const payload = await readJson(req);
  const { paperId, paragraphId, settings } = payload;

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
        "你是一个严谨的论文精读助手。必须忠于论文原文，不编造。请只输出合法 JSON，不要使用 Markdown 代码块。",
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

  const content = await callModel(settings, messages);
  const parsed = parseModelJson(content);

  paragraph.translation = parsed.translation || "";
  paragraph.explanation = parsed.explanation || content;
  paragraph.keyTerms = Array.isArray(parsed.keyTerms) ? parsed.keyTerms : [];
  paragraph.updatedAt = new Date().toISOString();

  await savePaper(paper);
  return json(res, { paragraph });
}

async function handleModelPing(req, res) {
  const payload = await readJson(req);
  const diagnostics = getSettingsDiagnostics(payload.settings);

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
    ], { maxTokens: 64 });

    return json(res, { ok: true, answer, diagnostics });
  } catch (error) {
    return json(res, {
      error: error.message || "模型连接测试失败。",
      diagnostics,
    }, 500);
  }
}

async function handleChat(req, res) {
  const payload = await readJson(req);
  const { paperId, paragraphId, message, settings } = payload;

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
        "你是论文阅读问答助手。回答要基于给定论文上下文；如果上下文没有答案，要明确说论文中没有直接说明。使用中文回答。",
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

  const answer = await callModel(settings, messages);
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

  return {
    id,
    filename,
    title,
    pdfPath,
    pageCount: extraction.pageCount,
    status: "ready",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sections,
    paragraphs,
  };
}

function splitIntoParagraphs(pages) {
  const paragraphs = [];
  let order = 0;

  for (const page of pages) {
    const blocks = extractTextBlocks(page.text);

    for (const block of blocks) {
      const clean = normalizeParagraph(block);
      if (!clean || (clean.length < 20 && !isLikelyHeading(clean))) {
        continue;
      }

      paragraphs.push({
        id: `para_${order}_${randomUUID().slice(0, 8)}`,
        kind: isLikelyHeading(clean) ? "heading" : "paragraph",
        order,
        pageNumber: page.pageNumber,
        sectionId: "section_0",
        sourceText: clean,
        translation: "",
        explanation: "",
        keyTerms: [],
        chatMessages: [],
      });
      order += 1;
    }
  }

  return paragraphs;
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

async function extractPdfText(pdfPath) {
  const scriptPath = path.join(__dirname, "scripts", "extract_pdf_text.swift");

  return new Promise((resolve, reject) => {
    execFile("/usr/bin/swift", [scriptPath, pdfPath], {
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

async function callModel(settings, messages, options = {}) {
  const cleanSettings = normalizeSettings(settings);
  if (cleanSettings.baseUrl === "local:claude-kimi") {
    return callClaudeAgent(cleanSettings, messages, { usePageKimiKey: true });
  }

  if (cleanSettings.baseUrl === "local:claude-config") {
    return callClaudeAgent(cleanSettings, messages, { usePageKimiKey: false });
  }

  const endpoint = getChatCompletionsEndpoint(cleanSettings.baseUrl);
  const controller = new AbortController();
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
        throw new Error("模型请求超时，请稍后重试。");
      }

      throw new Error(`模型请求失败：${error.message}`);
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
    clearTimeout(timeout);
  }
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

    const child = spawn("claude", args, {
      cwd: __dirname,
      env: {
        ...process.env,
        ...(options.usePageKimiKey ? {
          ANTHROPIC_BASE_URL: "https://api.kimi.com/coding/",
          ANTHROPIC_API_KEY: settings.apiKey,
        } : {}),
        ENABLE_TOOL_SEARCH: "false",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Claude Code 本地 Agent 调用超时。"));
    }, 180_000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      if (error.code === "ENOENT") {
        reject(new Error("未找到 claude CLI。请先安装并配置 Claude Code。"));
        return;
      }

      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
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

  if (!apiKey && baseUrl !== "local:claude-config") {
    throw new Error("API Key is required.");
  }

  if (!model) {
    throw new Error("Model name is required.");
  }

  return { provider, apiKey: normalizeApiKey(apiKey), model, baseUrl, agentBudgetUsd };
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

function getSettingsDiagnostics(settings = {}) {
  const provider = String(settings.provider || "").trim();
  const baseUrl = resolveBaseUrlForProvider(provider, String(settings.baseUrl || "https://api.openai.com/v1").trim());
  const model = normalizeModelName(String(settings.model || "").trim());
  const apiKey = normalizeApiKey(String(settings.apiKey || ""));
  const keyPrefix = apiKey.startsWith("sk-kimi-")
    ? "sk-kimi"
    : apiKey.startsWith("sk-")
      ? "sk"
      : apiKey ? "unknown" : "missing";

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
  return JSON.parse(await readFile(paperPath, "utf8"));
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

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
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
