const state = {
  paper: null,
  query: "",
  busyParagraphId: null,
  autoAnalyze: {
    running: false,
    stopRequested: false,
    completed: 0,
    failed: 0,
    total: 0,
    currentId: null,
    startedAt: 0,
    timer: null,
  },
};

const els = {
  providerSelect: document.querySelector("#providerSelect"),
  baseUrlInput: document.querySelector("#baseUrlInput"),
  modelInput: document.querySelector("#modelInput"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  agentBudgetInput: document.querySelector("#agentBudgetInput"),
  modelStatusText: document.querySelector("#modelStatusText"),
  modelDiagnosticsText: document.querySelector("#modelDiagnosticsText"),
  providerHintText: document.querySelector("#providerHintText"),
  pdfInput: document.querySelector("#pdfInput"),
  aiSegmentInput: document.querySelector("#aiSegmentInput"),
  autoAnalyzeInput: document.querySelector("#autoAnalyzeInput"),
  uploadButton: document.querySelector("#uploadButton"),
  statusText: document.querySelector("#statusText"),
  paperList: document.querySelector("#paperList"),
  paperMeta: document.querySelector("#paperMeta"),
  paperTitle: document.querySelector("#paperTitle"),
  paperStats: document.querySelector("#paperStats"),
  emptyState: document.querySelector("#emptyState"),
  paragraphList: document.querySelector("#paragraphList"),
  outline: document.querySelector("#outline"),
  searchInput: document.querySelector("#searchInput"),
  autoAnalyzeButton: document.querySelector("#autoAnalyzeButton"),
  stopAutoButton: document.querySelector("#stopAutoButton"),
  pingButton: document.querySelector("#pingButton"),
};

const PROVIDERS = {
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    hint: "DeepSeek OpenAI-compatible API。可改用 deepseek-v4-pro 获得更强模型。",
  },
  "claude-kimi-agent": {
    baseUrl: "local:claude-kimi",
    model: "kimi-for-coding",
    hint: "通过本机 Claude Code CLI 调用页面输入的 Kimi Code Key，并隔离 Claude 用户级 settings，避免被本机 OpenSSI 等配置覆盖。",
  },
  "claude-local": {
    baseUrl: "local:claude-config",
    model: "sonnet",
    hint: "通过本机 Claude Code 已登录/已配置的账号或 key 调用，不使用页面 API Key，适合使用 OpenSSI 等本机配置。",
  },
  "kimi-code": {
    baseUrl: "https://api.kimi.com/coding/v1",
    model: "kimi-for-coding",
    hint: "Kimi Code Key 可认证，但官方限制普通 Chat Completion 只面向 Coding Agent；本应用建议使用 Kimi 开放平台 Key。",
  },
  "kimi-platform": {
    baseUrl: "https://api.moonshot.cn/v1",
    model: "kimi-k2.6",
    hint: "Kimi 开放平台 Key 适合普通 OpenAI-compatible 应用调用。",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    hint: "OpenAI-compatible 普通 Chat Completion。",
  },
};

loadSettings();
bindEvents();
loadRecentPapers();
updateModelDiagnostics();
updateAutoButtons();

function bindEvents() {
  els.uploadButton.addEventListener("click", uploadPdf);
  els.pingButton.addEventListener("click", pingModel);
  els.autoAnalyzeButton.addEventListener("click", () => startAutoAnalyze());
  els.stopAutoButton.addEventListener("click", stopAutoAnalyze);
  els.providerSelect.addEventListener("change", () => {
    applyProvider(els.providerSelect.value);
    saveSettings();
  });
  els.searchInput.addEventListener("input", () => {
    state.query = els.searchInput.value.trim().toLowerCase();
    renderPaper();
  });

  for (const input of [els.baseUrlInput, els.modelInput, els.apiKeyInput, els.agentBudgetInput]) {
    input.addEventListener("input", () => {
      saveSettings();
      updateModelDiagnostics();
    });
  }

  for (const input of [els.aiSegmentInput, els.autoAnalyzeInput]) {
    input.addEventListener("change", saveSettings);
  }
}

function loadSettings() {
  const provider = sessionStorage.getItem("paper-reader-provider") || "deepseek";
  els.providerSelect.value = provider;
  els.apiKeyInput.value = sessionStorage.getItem("paper-reader-api-key") || "";
  els.agentBudgetInput.value = sessionStorage.getItem("paper-reader-agent-budget") || "500";
  els.aiSegmentInput.checked = sessionStorage.getItem("paper-reader-ai-segment") !== "false";
  els.autoAnalyzeInput.checked = sessionStorage.getItem("paper-reader-auto-analyze") !== "false";
  applyProvider(provider);

  if (!PROVIDERS[provider]) {
    els.baseUrlInput.value = sessionStorage.getItem("paper-reader-base-url") || els.baseUrlInput.value;
    els.modelInput.value = sessionStorage.getItem("paper-reader-model") || els.modelInput.value;
  }
}

function saveSettings() {
  sessionStorage.setItem("paper-reader-provider", els.providerSelect.value);
  sessionStorage.setItem("paper-reader-base-url", els.baseUrlInput.value.trim());
  sessionStorage.setItem("paper-reader-model", els.modelInput.value.trim());
  sessionStorage.setItem("paper-reader-api-key", els.apiKeyInput.value.trim());
  sessionStorage.setItem("paper-reader-agent-budget", els.agentBudgetInput.value.trim());
  sessionStorage.setItem("paper-reader-ai-segment", String(els.aiSegmentInput.checked));
  sessionStorage.setItem("paper-reader-auto-analyze", String(els.autoAnalyzeInput.checked));
}

function getSettings() {
  return {
    provider: els.providerSelect.value,
    baseUrl: els.baseUrlInput.value.trim(),
    model: normalizeModelNameInput(els.modelInput.value),
    apiKey: normalizeApiKeyInput(els.apiKeyInput.value),
    agentBudgetUsd: Number(els.agentBudgetInput.value || 500),
  };
}

function normalizeApiKeyInput(value) {
  const clean = value
    .trim()
    .replace(/^bearer\s+/i, "")
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, "")
    .replace(/[，,。.;；\s]+$/g, "")
    .trim();
  const match = clean.match(/(sk-[A-Za-z0-9._-]+)/);

  return match?.[1] || clean;
}

function normalizeModelNameInput(value) {
  const model = value.trim();
  const compact = model.toLowerCase().replace(/[\s_.-]+/g, "");
  const aliases = new Map([
    ["kimi26", "kimi-k2.6"],
    ["kimik26", "kimi-k2.6"],
    ["k26", "kimi-k2.6"],
  ]);

  return aliases.get(compact) || model;
}

function updateModelDiagnostics(remoteDiagnostics) {
  const settings = getSettings();
  const endpoint = getChatEndpoint(settings.baseUrl);
  const keyPrefix = settings.apiKey.startsWith("sk-kimi-")
    ? "sk-kimi"
    : settings.apiKey.startsWith("sk-")
      ? "sk"
      : settings.apiKey ? "unknown" : "missing";
  const keyLength = settings.apiKey.length;
  const diagnostics = remoteDiagnostics || {
    provider: settings.provider,
    endpoint,
    model: settings.model,
    keyPresent: Boolean(settings.apiKey),
    keyPrefix,
    keyLength,
  };

  els.modelDiagnosticsText.textContent = [
    `Provider: ${diagnostics.provider || settings.provider}`,
    `Endpoint: ${diagnostics.endpoint}`,
    `Model: ${diagnostics.model}`,
    `Key: ${diagnostics.keyPresent ? `${diagnostics.keyPrefix}, ${diagnostics.keyLength} chars` : "missing"}`,
  ].join(" · ");
}

function getChatEndpoint(baseUrl) {
  if (baseUrl === "local:claude-kimi") {
    return "local claude CLI + page Kimi key -> https://api.kimi.com/coding/";
  }

  if (baseUrl === "local:claude-config") {
    return "local claude CLI configured auth";
  }

  const clean = baseUrl.replace(/\/+$/, "");
  return clean.endsWith("/chat/completions") ? clean : `${clean}/chat/completions`;
}

function applyProvider(provider) {
  const preset = PROVIDERS[provider];
  if (!preset) {
    els.providerHintText.textContent = "";
    updateModelDiagnostics();
    return;
  }

  els.baseUrlInput.value = preset.baseUrl;
  els.modelInput.value = preset.model;
  els.providerHintText.textContent = preset.hint || "";
  updateModelDiagnostics();
}

async function uploadPdf() {
  const file = els.pdfInput.files?.[0];
  if (!file) {
    setStatus("请选择 PDF", true);
    return;
  }

  const formData = new FormData();
  formData.append("pdf", file);

  setBusy(true);
  setStatus("正在上传并解析");

  try {
    const response = await fetch("/api/papers/upload", {
      method: "POST",
      body: formData,
    });
    const paper = await readResponse(response);
    state.paper = paper;
    state.query = "";
    els.searchInput.value = "";
    setStatus("解析完成");
    renderPaper();
    loadRecentPapers();
    setBusy(false);
    await runPostUploadPipeline();
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function runPostUploadPipeline() {
  if (!state.paper) {
    return;
  }

  if (!ensureModelSettings({ quiet: true })) {
    setStatus("解析完成。输入 API Key 后可以启动自动翻译讲解。");
    return;
  }

  if (els.aiSegmentInput.checked) {
    await segmentPaperWithAi({ continueOnError: true });
  }

  if (els.autoAnalyzeInput.checked) {
    await startAutoAnalyze();
  }
}

async function segmentPaperWithAi(options = {}) {
  if (!state.paper) {
    return false;
  }

  if (!ensureModelSettings({ quiet: options.continueOnError })) {
    return false;
  }

  const startedAt = Date.now();
  const timer = window.setInterval(() => {
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    setStatus(`AI 正在重新分段 · 已用 ${elapsed}s`);
  }, 1000);
  setStatus("AI 正在重新分段 · 已用 0s");

  try {
    const response = await fetch(`/api/papers/${encodeURIComponent(state.paper.id)}/segment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: getSettings() }),
    });
    const result = await readResponse(response);
    state.paper = result.paper;
    renderPaper();
    loadRecentPapers();
    setStatus(`AI 分段完成：${getReadingParagraphs(state.paper).length} 个段落`);
    return true;
  } catch (error) {
    const message = `AI 分段失败，继续使用基础分段：${error.message}`;
    setStatus(message, !options.continueOnError);
    return false;
  } finally {
    window.clearInterval(timer);
  }
}

async function loadRecentPapers() {
  try {
    const response = await fetch("/api/papers");
    const data = await readResponse(response);
    renderRecentPapers(data.papers || []);
  } catch (error) {
    els.paperList.textContent = "";
  }
}

async function openPaper(paperId) {
  setStatus("正在载入论文");

  try {
    const response = await fetch(`/api/papers/${encodeURIComponent(paperId)}`);
    state.paper = await readResponse(response);
    state.query = "";
    els.searchInput.value = "";
    setStatus("论文已载入");
    renderPaper();
  } catch (error) {
    setStatus(error.message, true);
  }
}

function renderRecentPapers(papers) {
  if (!papers.length) {
    els.paperList.textContent = "暂无论文";
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const paper of papers.slice(0, 8)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "paper-list-item";
    button.addEventListener("click", () => openPaper(paper.id));

    const title = document.createElement("span");
    title.textContent = paper.title || paper.filename;

    const meta = document.createElement("small");
    meta.textContent = `${paper.pageCount} 页 · ${paper.paragraphCount} 段`;

    button.append(title, meta);
    fragment.append(button);
  }

  els.paperList.replaceChildren(fragment);
}

async function pingModel() {
  if (!ensureModelSettings()) {
    return;
  }

  els.pingButton.disabled = true;
  setStatus("正在测试连接");
  setModelStatus("正在测试连接");

  try {
    const response = await fetch("/api/model/ping", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: getSettings() }),
    });
    const result = await response.json().catch(() => ({}));
    if (result.diagnostics) {
      updateModelDiagnostics(result.diagnostics);
    }

    if (!response.ok) {
      throw new Error(result.error || `Request failed with ${response.status}`);
    }

    setStatus(result.answer || "连接成功");
    setModelStatus(result.answer || "连接成功");
  } catch (error) {
    setStatus(error.message, true);
    setModelStatus(error.message, true);
  } finally {
    els.pingButton.disabled = false;
  }
}

async function analyzeParagraph(paragraphId, options = {}) {
  if (!ensureModelSettings({ quiet: options.fromAuto })) {
    return;
  }

  state.busyParagraphId = paragraphId;
  markParagraph(paragraphId, { analysisStatus: "running", analysisError: "" });
  renderPaper();

  try {
    const paragraph = await requestAnalyzeParagraph(paragraphId);
    replaceParagraph(paragraph);
    if (!options.fromAuto) {
      setStatus("分析完成");
    }
    return paragraph;
  } catch (error) {
    markParagraph(paragraphId, { analysisStatus: "error", analysisError: error.message });
    if (!options.fromAuto) {
      setStatus(error.message, true);
      return null;
    }
    throw error;
  } finally {
    state.busyParagraphId = null;
    renderPaper();
  }
}

async function requestAnalyzeParagraph(paragraphId) {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      paperId: state.paper.id,
      paragraphId,
      settings: getSettings(),
    }),
  });
  const result = await readResponse(response);
  return result.paragraph;
}

async function startAutoAnalyze() {
  if (!state.paper || state.autoAnalyze.running) {
    return;
  }

  if (!ensureModelSettings()) {
    return;
  }

  const pending = getReadingParagraphs(state.paper).filter(needsAnalysis);
  if (!pending.length) {
    setStatus("没有待分析段落");
    updateAutoButtons();
    return;
  }

  state.autoAnalyze = {
    running: true,
    stopRequested: false,
    completed: 0,
    failed: 0,
    total: pending.length,
    currentId: null,
    startedAt: Date.now(),
    timer: window.setInterval(updateAutoStatus, 1000),
  };
  updateAutoButtons();

  for (const paragraph of pending) {
    if (state.autoAnalyze.stopRequested) {
      break;
    }

    state.autoAnalyze.currentId = paragraph.id;
    updateAutoStatus();

    try {
      await analyzeParagraph(paragraph.id, { fromAuto: true });
      state.autoAnalyze.completed += 1;
    } catch {
      state.autoAnalyze.failed += 1;
    }

    updateAutoStatus();
  }

  const stopped = state.autoAnalyze.stopRequested;
  const completed = state.autoAnalyze.completed;
  const failed = state.autoAnalyze.failed;
  clearAutoTimer();
  state.autoAnalyze.running = false;
  state.autoAnalyze.stopRequested = false;
  state.autoAnalyze.currentId = null;
  updateAutoButtons();
  renderPaper();
  loadRecentPapers();

  if (stopped) {
    setStatus(`已停止自动分析：完成 ${completed} 段，失败 ${failed} 段`);
    return;
  }

  setStatus(`自动分析完成：完成 ${completed} 段，失败 ${failed} 段`, failed > 0);
}

function stopAutoAnalyze() {
  if (!state.autoAnalyze.running) {
    return;
  }

  state.autoAnalyze.stopRequested = true;
  setStatus("正在停止，当前段落完成后会暂停");
  updateAutoButtons();
}

function needsAnalysis(paragraph) {
  return !paragraph.translation && !paragraph.explanation && paragraph.analysisStatus !== "done";
}

async function askParagraph(paragraphId, input) {
  const message = input.value.trim();
  if (!message) {
    return;
  }

  if (!ensureModelSettings()) {
    return;
  }

  input.value = "";
  state.busyParagraphId = paragraphId;
  renderPaper();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        paperId: state.paper.id,
        paragraphId,
        message,
        settings: getSettings(),
      }),
    });
    const result = await readResponse(response);
    replaceParagraph(result.paragraph);
    setStatus("回答完成");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    state.busyParagraphId = null;
    renderPaper();
  }
}

function ensureModelSettings(options = {}) {
  const { apiKey, model, baseUrl } = getSettings();
  if (!apiKey && baseUrl !== "local:claude-config") {
    if (!options.quiet) {
      setStatus("请输入 API Key", true);
    }
    return false;
  }

  if (!model) {
    if (!options.quiet) {
      setStatus("请输入模型名称", true);
    }
    return false;
  }

  return true;
}

function replaceParagraph(nextParagraph) {
  const index = state.paper.paragraphs.findIndex((item) => item.id === nextParagraph.id);
  if (index !== -1) {
    state.paper.paragraphs[index] = nextParagraph;
  }
}

function markParagraph(paragraphId, patch) {
  if (!state.paper) {
    return;
  }

  const paragraph = state.paper.paragraphs.find((item) => item.id === paragraphId);
  if (paragraph) {
    Object.assign(paragraph, patch);
  }
}

function renderPaper() {
  const paper = state.paper;

  if (!paper) {
    els.emptyState.classList.remove("hidden");
    els.paragraphList.innerHTML = "";
    els.outline.innerHTML = "";
    updateAutoButtons();
    return;
  }

  els.emptyState.classList.add("hidden");
  els.paperTitle.textContent = paper.title || paper.filename;
  els.paperMeta.textContent = `${paper.pageCount} 页`;
  const readingParagraphs = getReadingParagraphs(paper);
  const analyzedCount = readingParagraphs.filter((paragraph) => !needsAnalysis(paragraph)).length;
  const segmentLabels = {
    ai: "AI 分段",
    layout: "版面分段",
    heuristic: "基础分段",
  };
  const segmentLabel = segmentLabels[paper.segmentationMode] || "基础分段";
  els.paperStats.textContent = `${readingParagraphs.length} 个段落 · 已讲解 ${analyzedCount} · ${segmentLabel}`;
  renderOutline(paper);
  renderParagraphs(paper);
  updateAutoButtons();
}

function renderOutline(paper) {
  const fragment = document.createDocumentFragment();

  for (const section of paper.sections) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = section.title;
    button.addEventListener("click", () => {
      const paragraph = paper.paragraphs.find((item) => item.sectionId === section.id && item.kind !== "heading");
      if (paragraph) {
        document.querySelector(`#${CSS.escape(paragraph.id)}`)?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
    });
    fragment.append(button);
  }

  els.outline.replaceChildren(fragment);
}

function renderParagraphs(paper) {
  const query = state.query;
  const readingParagraphs = getReadingParagraphs(paper);
  const paragraphs = query
    ? readingParagraphs.filter((paragraph) => {
      const haystack = [
        paragraph.sourceText,
        paragraph.translation,
        paragraph.explanation,
        ...(paragraph.keyTerms || []),
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    })
    : readingParagraphs;

  const fragment = document.createDocumentFragment();
  let lastSectionId = "";
  let lastPageNumber = 0;

  for (const paragraph of paragraphs) {
    if (paragraph.pageNumber !== lastPageNumber) {
      const pageImage = getPageImage(paper, paragraph.pageNumber);
      if (pageImage) {
        fragment.append(renderPagePreview(pageImage));
      }
      lastPageNumber = paragraph.pageNumber;
    }

    if (paragraph.sectionId !== lastSectionId) {
      const section = paper.sections.find((item) => item.id === paragraph.sectionId);
      if (section) {
        fragment.append(renderSectionDivider(section));
      }
      lastSectionId = paragraph.sectionId;
    }

    fragment.append(renderParagraphCard(paragraph));
  }

  els.paragraphList.replaceChildren(fragment);
}

function getPageImage(paper, pageNumber) {
  return (paper.pageImages || []).find((item) => item.pageNumber === pageNumber);
}

function renderPagePreview(pageImage) {
  const wrapper = document.createElement("section");
  wrapper.className = "page-preview";

  const header = document.createElement("div");
  header.className = "page-preview-header";
  header.textContent = `第 ${pageImage.pageNumber} 页`;

  const image = document.createElement("img");
  image.src = pageImage.imagePath;
  image.alt = `第 ${pageImage.pageNumber} 页页面快照`;
  image.loading = "lazy";
  image.decoding = "async";
  if (pageImage.imageWidth && pageImage.imageHeight) {
    image.width = pageImage.imageWidth;
    image.height = pageImage.imageHeight;
  }

  wrapper.append(header, image);
  return wrapper;
}

function getReadingParagraphs(paper) {
  return paper.paragraphs.filter((paragraph) => paragraph.kind !== "heading");
}

function renderSectionDivider(section) {
  const divider = document.createElement("div");
  divider.className = "section-divider";
  divider.textContent = section.title;
  return divider;
}

function renderParagraphCard(paragraph) {
  const card = document.createElement("article");
  card.className = "paragraph-card";
  card.id = paragraph.id;

  const header = document.createElement("div");
  header.className = "paragraph-header";

  const meta = document.createElement("div");
  meta.className = "paragraph-meta";

  const kicker = document.createElement("div");
  kicker.className = "paragraph-kicker";
  kicker.textContent = `P${paragraph.order + 1} · 第 ${paragraph.pageNumber} 页`;

  const status = document.createElement("span");
  status.className = `paragraph-status ${getAnalysisStatus(paragraph)}`;
  status.textContent = getAnalysisStatusText(paragraph);
  meta.append(kicker, status);

  const analyzeButton = document.createElement("button");
  analyzeButton.className = "secondary-button";
  analyzeButton.type = "button";
  analyzeButton.textContent = getAnalyzeButtonText(paragraph);
  analyzeButton.disabled = Boolean(state.busyParagraphId) || state.autoAnalyze.running;
  analyzeButton.addEventListener("click", () => analyzeParagraph(paragraph.id));

  header.append(meta, analyzeButton);

  const content = document.createElement("div");
  content.className = "paragraph-content";

  const source = document.createElement("p");
  source.className = "source-text";
  source.textContent = paragraph.sourceText;
  content.append(source);

  if (getAnalysisStatus(paragraph) === "running" && !paragraph.translation && !paragraph.explanation) {
    content.append(renderAnalysisNotice("正在生成翻译与讲解"));
  }

  if (paragraph.analysisError) {
    content.append(renderAnalysisNotice(paragraph.analysisError, true));
  }

  if (paragraph.translation || paragraph.explanation || paragraph.keyTerms?.length) {
    const grid = document.createElement("div");
    grid.className = "analysis-grid";
    grid.append(
      renderAnalysisBox("翻译", paragraph.translation || "尚未生成"),
      renderAnalysisBox("讲解", paragraph.explanation || "尚未生成"),
    );
    content.append(grid);

    if (paragraph.keyTerms?.length) {
      const terms = document.createElement("div");
      terms.className = "term-row";
      for (const term of paragraph.keyTerms) {
        const chip = document.createElement("span");
        chip.className = "term-chip";
        chip.textContent = term;
        terms.append(chip);
      }
      content.append(terms);
    }
  }

  content.append(renderChatBox(paragraph));
  card.append(header, content);
  return card;
}

function getAnalysisStatus(paragraph) {
  if (state.busyParagraphId === paragraph.id || paragraph.analysisStatus === "running") {
    return "running";
  }

  if (paragraph.analysisError || paragraph.analysisStatus === "error") {
    return "error";
  }

  if (!needsAnalysis(paragraph)) {
    return "done";
  }

  return "pending";
}

function getAnalysisStatusText(paragraph) {
  const status = getAnalysisStatus(paragraph);
  if (status === "running") {
    return "生成中";
  }
  if (status === "done") {
    return "已生成";
  }
  if (status === "error") {
    return "失败";
  }
  return "待生成";
}

function getAnalyzeButtonText(paragraph) {
  const status = getAnalysisStatus(paragraph);
  if (status === "running") {
    return "处理中";
  }
  if (status === "done") {
    return "重新生成";
  }
  if (status === "error") {
    return "重试";
  }
  return "翻译与讲解";
}

function renderAnalysisNotice(text, isError = false) {
  const notice = document.createElement("div");
  notice.className = `analysis-notice${isError ? " error-text" : ""}`;
  notice.textContent = text;
  return notice;
}

function renderAnalysisBox(title, text) {
  const box = document.createElement("section");
  box.className = "analysis-box";

  const heading = document.createElement("h3");
  heading.textContent = title;

  const body = document.createElement("p");
  body.textContent = text;

  box.append(heading, body);
  return box;
}

function renderChatBox(paragraph) {
  const wrapper = document.createElement("section");
  wrapper.className = "chat-box";

  const thread = document.createElement("div");
  thread.className = "chat-thread";

  for (const item of paragraph.chatMessages || []) {
    const question = document.createElement("div");
    question.className = "chat-message";
    question.append(label("你"), paragraphText(item.question));

    const answer = document.createElement("div");
    answer.className = "chat-message";
    answer.append(label("AI"), paragraphText(item.answer));

    thread.append(question, answer);
  }

  const input = document.createElement("textarea");
  input.placeholder = "追问这一段";
  input.disabled = Boolean(state.busyParagraphId);

  const actions = document.createElement("div");
  actions.className = "chat-actions";

  const askButton = document.createElement("button");
  askButton.className = "secondary-button";
  askButton.type = "button";
  askButton.textContent = state.busyParagraphId === paragraph.id ? "等待回答" : "发送";
  askButton.disabled = Boolean(state.busyParagraphId);
  askButton.addEventListener("click", () => askParagraph(paragraph.id, input));

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      askParagraph(paragraph.id, input);
    }
  });

  actions.append(askButton);
  wrapper.append(thread, input, actions);
  return wrapper;
}

function label(text) {
  const strong = document.createElement("strong");
  strong.textContent = text;
  return strong;
}

function paragraphText(text) {
  const p = document.createElement("p");
  p.textContent = text;
  return p;
}

function updateAutoStatus() {
  if (!state.autoAnalyze.running) {
    return;
  }

  const elapsed = Math.max(0, Math.round((Date.now() - state.autoAnalyze.startedAt) / 1000));
  const current = state.paper?.paragraphs.find((paragraph) => paragraph.id === state.autoAnalyze.currentId);
  const currentLabel = current ? `，当前 P${current.order + 1}` : "";
  const stopLabel = state.autoAnalyze.stopRequested ? "，正在停止" : "";
  setStatus([
    `自动分析 ${state.autoAnalyze.completed + state.autoAnalyze.failed}/${state.autoAnalyze.total}`,
    `失败 ${state.autoAnalyze.failed}`,
    `已用 ${elapsed}s${currentLabel}${stopLabel}`,
  ].join(" · "), state.autoAnalyze.failed > 0);
}

function updateAutoButtons() {
  els.autoAnalyzeButton.disabled = !state.paper || state.autoAnalyze.running;
  els.stopAutoButton.classList.toggle("hidden", !state.autoAnalyze.running);
  els.stopAutoButton.disabled = !state.autoAnalyze.running || state.autoAnalyze.stopRequested;
}

function clearAutoTimer() {
  if (state.autoAnalyze.timer) {
    window.clearInterval(state.autoAnalyze.timer);
    state.autoAnalyze.timer = null;
  }
}

function setBusy(isBusy) {
  els.uploadButton.disabled = isBusy;
  els.pdfInput.disabled = isBusy;
  els.aiSegmentInput.disabled = isBusy;
  els.autoAnalyzeInput.disabled = isBusy;
}

function setStatus(text, isError = false) {
  els.statusText.textContent = text;
  els.statusText.classList.toggle("error-text", isError);
}

function setModelStatus(text, isError = false) {
  els.modelStatusText.textContent = text;
  els.modelStatusText.classList.toggle("error-text", isError);
}

async function readResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed with ${response.status}`);
  }

  return data;
}
