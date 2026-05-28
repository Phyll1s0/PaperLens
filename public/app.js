const state = {
  paper: null,
  query: "",
  busyParagraphId: null,
  jobHistory: [],
  autoAnalyze: {
    running: false,
    stopRequested: false,
    jobId: null,
    completed: 0,
    failed: 0,
    total: 0,
    currentId: null,
    startedAt: 0,
    timer: null,
    pollInFlight: false,
    lastProgressKey: "",
  },
};

const els = {
  providerSelect: document.querySelector("#providerSelect"),
  baseUrlInput: document.querySelector("#baseUrlInput"),
  modelInput: document.querySelector("#modelInput"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  agentBudgetInput: document.querySelector("#agentBudgetInput"),
  proxyUrlInput: document.querySelector("#proxyUrlInput"),
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
  rerunAnalyzeButton: document.querySelector("#rerunAnalyzeButton"),
  stopAutoButton: document.querySelector("#stopAutoButton"),
  jobHistory: document.querySelector("#jobHistory"),
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

const API_TIMEOUT_MS = 240_000;
const API_KEY_REF_STORAGE_KEY = "paper-reader-api-key-ref";
const API_KEY_INFO_STORAGE_KEY = "paper-reader-api-key-info";
const LEGACY_API_KEY_STORAGE_KEY = "paper-reader-api-key";

loadSettings();
bindEvents();
loadRecentPapers();
updateModelDiagnostics();
updateAutoButtons();

function bindEvents() {
  els.uploadButton.addEventListener("click", uploadPdf);
  els.pingButton.addEventListener("click", pingModel);
  els.autoAnalyzeButton.addEventListener("click", () => startAutoAnalyze());
  els.rerunAnalyzeButton.addEventListener("click", () => startAutoAnalyze({ rerunAll: true }));
  els.stopAutoButton.addEventListener("click", stopAutoAnalyze);
  els.providerSelect.addEventListener("change", () => {
    clearSavedApiKeyRef();
    applyProvider(els.providerSelect.value);
    saveSettings();
  });
  els.searchInput.addEventListener("input", () => {
    state.query = els.searchInput.value.trim().toLowerCase();
    renderPaper();
  });

  for (const input of [els.baseUrlInput, els.modelInput, els.apiKeyInput, els.agentBudgetInput, els.proxyUrlInput]) {
    input.addEventListener("input", () => {
      if (input === els.baseUrlInput) {
        clearSavedApiKeyRef();
      }
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
  const legacyApiKey = sessionStorage.getItem(LEGACY_API_KEY_STORAGE_KEY) || "";
  sessionStorage.removeItem(LEGACY_API_KEY_STORAGE_KEY);
  els.providerSelect.value = provider;
  els.apiKeyInput.value = legacyApiKey;
  els.agentBudgetInput.value = sessionStorage.getItem("paper-reader-agent-budget") || "500";
  els.proxyUrlInput.value = sessionStorage.getItem("paper-reader-proxy-url") || "";
  els.aiSegmentInput.checked = sessionStorage.getItem("paper-reader-ai-segment") !== "false";
  els.autoAnalyzeInput.checked = sessionStorage.getItem("paper-reader-auto-analyze") !== "false";
  applyProvider(provider);

  if (!PROVIDERS[provider]) {
    els.baseUrlInput.value = sessionStorage.getItem("paper-reader-base-url") || els.baseUrlInput.value;
    els.modelInput.value = sessionStorage.getItem("paper-reader-model") || els.modelInput.value;
  }
  updateApiKeyPlaceholder();
}

function saveSettings() {
  sessionStorage.setItem("paper-reader-provider", els.providerSelect.value);
  sessionStorage.setItem("paper-reader-base-url", els.baseUrlInput.value.trim());
  sessionStorage.setItem("paper-reader-model", els.modelInput.value.trim());
  sessionStorage.removeItem(LEGACY_API_KEY_STORAGE_KEY);
  sessionStorage.setItem("paper-reader-agent-budget", els.agentBudgetInput.value.trim());
  sessionStorage.setItem("paper-reader-proxy-url", els.proxyUrlInput.value.trim());
  sessionStorage.setItem("paper-reader-ai-segment", String(els.aiSegmentInput.checked));
  sessionStorage.setItem("paper-reader-auto-analyze", String(els.autoAnalyzeInput.checked));
  updateApiKeyPlaceholder();
}

function getSettings() {
  const apiKey = normalizeApiKeyInput(els.apiKeyInput.value);
  return {
    provider: els.providerSelect.value,
    baseUrl: els.baseUrlInput.value.trim(),
    model: normalizeModelNameInput(els.modelInput.value),
    apiKey,
    apiKeyRef: apiKey ? "" : sessionStorage.getItem(API_KEY_REF_STORAGE_KEY) || "",
    agentBudgetUsd: Number(els.agentBudgetInput.value || 500),
    proxyUrl: els.proxyUrlInput.value.trim(),
  };
}

function getStoredKeyInfo() {
  try {
    return JSON.parse(sessionStorage.getItem(API_KEY_INFO_STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

function applySecuredSettings(settings) {
  if (!settings) {
    return;
  }

  if (settings.provider) {
    els.providerSelect.value = settings.provider;
  }
  if (settings.baseUrl) {
    els.baseUrlInput.value = settings.baseUrl;
  }
  if (settings.model) {
    els.modelInput.value = settings.model;
  }

  if (settings.apiKeyRef) {
    sessionStorage.setItem(API_KEY_REF_STORAGE_KEY, settings.apiKeyRef);
    if (settings.keyInfo) {
      sessionStorage.setItem(API_KEY_INFO_STORAGE_KEY, JSON.stringify(settings.keyInfo));
    }
    els.apiKeyInput.value = "";
  } else {
    clearSavedApiKeyRef();
  }

  saveSettings();
  updateModelDiagnostics();
}

function clearSavedApiKeyRef() {
  sessionStorage.removeItem(API_KEY_REF_STORAGE_KEY);
  sessionStorage.removeItem(API_KEY_INFO_STORAGE_KEY);
  updateApiKeyPlaceholder();
}

function updateApiKeyPlaceholder() {
  const keyInfo = getStoredKeyInfo();
  els.apiKeyInput.placeholder = keyInfo
    ? `已保存本地 ${keyInfo.keyPrefix || "API"} Key；输入新 Key 可替换`
    : "";
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
  const savedKey = settings.apiKey ? null : getStoredKeyInfo();
  const keyPrefix = settings.apiKey.startsWith("sk-kimi-")
    ? "sk-kimi"
    : settings.apiKey.startsWith("sk-")
      ? "sk"
      : settings.apiKey ? "unknown" : savedKey?.keyPrefix || "missing";
  const keyLength = settings.apiKey ? settings.apiKey.length : savedKey?.keyLength || 0;
  const diagnostics = remoteDiagnostics || {
    provider: settings.provider,
    endpoint,
    model: settings.model,
    keyPresent: Boolean(settings.apiKey || settings.apiKeyRef),
    keySaved: Boolean(settings.apiKeyRef && !settings.apiKey),
    keyPrefix,
    keyLength,
    keyFormatOk: settings.provider !== "claude-kimi-agent" || keyPrefix === "sk-kimi",
    proxyPresent: Boolean(settings.proxyUrl),
    proxySource: settings.proxyUrl ? "page" : "none",
  };

  const lines = [
    `Provider: ${diagnostics.provider || settings.provider}`,
    `Endpoint: ${diagnostics.endpoint}`,
    `Model: ${diagnostics.model}`,
    `Key: ${diagnostics.keyPresent ? `${diagnostics.keySaved ? "saved " : ""}${diagnostics.keyPrefix}, ${diagnostics.keyLength} chars` : "missing"}`,
  ];

  if (settings.provider === "claude-kimi-agent") {
    lines.push(`Kimi Code Key: ${diagnostics.keyFormatOk ? "格式正常" : "格式异常，应以 sk-kimi- 开头"}`);
  }

  if (diagnostics.claudeCommand) {
    lines.push(`Claude CLI: ${diagnostics.claudeCommand}`);
  }

  if (settings.provider === "claude-kimi-agent" || settings.provider === "claude-local") {
    const proxySource = diagnostics.proxySource && diagnostics.proxySource !== "none"
      ? ` (${diagnostics.proxySource})`
      : "";
    lines.push(`Proxy: ${diagnostics.proxyPresent ? `detected${proxySource}` : "not detected"}`);
  }

  els.modelDiagnosticsText.textContent = lines.join(" · ");
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
    const response = await apiFetch("/api/papers/upload", {
      method: "POST",
      body: formData,
    }, "上传 PDF");
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
    const response = await apiFetch(`/api/papers/${encodeURIComponent(state.paper.id)}/segment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: getSettings() }),
    }, "AI 分段");
    const result = await readResponse(response);
    applySecuredSettings(result.settings);
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
    const response = await apiFetch("/api/papers", {}, "载入最近论文");
    const data = await readResponse(response);
    renderRecentPapers(data.papers || []);
  } catch (error) {
    els.paperList.textContent = "";
  }
}

async function openPaper(paperId) {
  setStatus("正在载入论文");

  try {
    const response = await apiFetch(`/api/papers/${encodeURIComponent(paperId)}`, {}, "载入论文");
    state.paper = await readResponse(response);
    state.query = "";
    els.searchInput.value = "";
    setStatus("论文已载入");
    renderPaper();
    await syncActiveAnalysisJob();
    await loadJobHistory();
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
    const response = await apiFetch("/api/model/ping", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: getSettings() }),
    }, "测试模型连接");
    const result = await response.json().catch(() => ({}));
    if (result.diagnostics) {
      updateModelDiagnostics(result.diagnostics);
    }
    applySecuredSettings(result.settings);

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
  if (!state.paper) {
    return;
  }

  await createAnalysisJob({
    paragraphIds: [paragraphId],
    force: true,
    statusLabel: "已加入后端分析队列",
  });
}

async function startAutoAnalyze(options = {}) {
  if (!state.paper || state.autoAnalyze.running) {
    return;
  }

  if (!ensureModelSettings()) {
    return;
  }

  await createAnalysisJob({
    rerunAll: Boolean(options.rerunAll),
    statusLabel: options.rerunAll ? "已重新加入后端分析队列" : "已启动后端自动分析队列",
  });
}

async function createAnalysisJob(payload = {}) {
  if (!state.paper) {
    return;
  }

  if (!ensureModelSettings()) {
    return;
  }

  setStatus("正在创建后端分析任务");
  updateAutoButtons();

  try {
    const response = await apiFetch(`/api/papers/${encodeURIComponent(state.paper.id)}/analysis-jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        settings: getSettings(),
        paragraphIds: payload.paragraphIds || [],
        rerunAll: Boolean(payload.rerunAll),
        force: Boolean(payload.force),
      }),
    }, "创建分析任务");
    const result = await readResponse(response);
    applySecuredSettings(result.settings);
    if (result.paper) {
      state.paper = result.paper;
    }

    if (!result.job) {
      renderPaper();
      setStatus(result.message || "没有待分析段落");
      updateAutoButtons();
      return;
    }

    beginAnalysisJob(result.job);
    renderPaper();
    await loadJobHistory();
    setStatus(payload.statusLabel || "已加入后端分析队列");
  } catch (error) {
    setStatus(error.message, true);
    updateAutoButtons();
  }
}

async function stopAutoAnalyze() {
  if (!state.autoAnalyze.running || !state.autoAnalyze.jobId) {
    return;
  }

  state.autoAnalyze.stopRequested = true;
  setStatus("正在通知后端停止任务");
  updateAutoButtons();

  try {
    const response = await apiFetch(`/api/jobs/${encodeURIComponent(state.autoAnalyze.jobId)}/cancel`, {
      method: "POST",
    }, "停止分析任务");
    const result = await readResponse(response);
    if (result.job) {
      applyAnalysisJob(result.job);
    }
    await pollAnalysisJob({ forceRefresh: true });
    await loadJobHistory();
  } catch (error) {
    setStatus(error.message, true);
  }
}

function beginAnalysisJob(job) {
  applyAnalysisJob(job);
  clearAutoTimer();
  if (state.autoAnalyze.running) {
    state.autoAnalyze.timer = window.setInterval(() => {
      pollAnalysisJob().catch((error) => setStatus(error.message, true));
    }, 1800);
  }
  updateAutoStatus();
  updateAutoButtons();
}

function applyAnalysisJob(job) {
  const running = isActiveAnalysisJob(job);
  state.autoAnalyze.running = running;
  state.autoAnalyze.stopRequested = Boolean(job.cancelRequested || job.status === "canceling");
  state.autoAnalyze.jobId = job.id;
  state.autoAnalyze.completed = Number(job.completed || 0);
  state.autoAnalyze.failed = Number(job.failed || 0);
  state.autoAnalyze.total = Number(job.total || 0);
  state.autoAnalyze.currentId = job.currentParagraphId || "";
  state.autoAnalyze.startedAt = Date.parse(job.startedAt || job.createdAt) || Date.now();
  state.autoAnalyze.lastProgressKey = getJobProgressKey(job);

  if (!running) {
    clearAutoTimer();
  }
}

function isActiveAnalysisJob(job) {
  return job && (job.status === "queued" || job.status === "running" || job.status === "canceling");
}

function getJobProgressKey(job) {
  return [
    job.status,
    job.completed,
    job.failed,
    job.currentParagraphId || "",
    job.updatedAt || "",
  ].join(":");
}

async function pollAnalysisJob(options = {}) {
  if (!state.autoAnalyze.jobId || state.autoAnalyze.pollInFlight) {
    return;
  }

  state.autoAnalyze.pollInFlight = true;
  try {
    const response = await apiFetch(`/api/jobs/${encodeURIComponent(state.autoAnalyze.jobId)}`, {}, "查询分析任务");
    const result = await readResponse(response);
    const job = result.job;
    const previousKey = state.autoAnalyze.lastProgressKey;
    applyAnalysisJob(job);
    const progressChanged = previousKey !== state.autoAnalyze.lastProgressKey;
    if (options.forceRefresh || progressChanged || !state.autoAnalyze.running) {
      await refreshCurrentPaper();
    }

    updateAutoStatus();
    updateAutoButtons();

    if (!state.autoAnalyze.running) {
      loadRecentPapers();
      loadJobHistory();
      if (job.status === "canceled") {
        setStatus(`已停止自动分析：完成 ${job.completed} 段，失败 ${job.failed} 段`);
      } else {
        setStatus(`自动分析完成：完成 ${job.completed} 段，失败 ${job.failed} 段`, job.failed > 0);
      }
    }
  } finally {
    state.autoAnalyze.pollInFlight = false;
  }
}

async function loadJobHistory() {
  if (!state.paper) {
    state.jobHistory = [];
    renderJobHistory();
    return;
  }

  try {
    const response = await apiFetch(`/api/papers/${encodeURIComponent(state.paper.id)}/analysis-jobs`, {}, "载入任务历史");
    const result = await readResponse(response);
    state.jobHistory = result.jobs || [];
    renderJobHistory();
  } catch {
    state.jobHistory = [];
    renderJobHistory();
  }
}

function renderJobHistory() {
  if (!els.jobHistory) {
    return;
  }

  if (!state.paper || !state.jobHistory.length) {
    els.jobHistory.replaceChildren();
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const job of state.jobHistory.slice(0, 3)) {
    const item = document.createElement("div");
    item.className = `job-history-item ${job.status}`;

    const summary = document.createElement("span");
    summary.textContent = [
      getJobStatusText(job.status),
      `${Number(job.completed || 0) + Number(job.failed || 0)}/${job.total || 0}`,
      `失败 ${job.failed || 0}`,
    ].join(" · ");
    item.append(summary);

    if (!isActiveAnalysisJob(job) && Number(job.failed || 0) > 0) {
      const retryButton = document.createElement("button");
      retryButton.type = "button";
      retryButton.textContent = "重跑失败";
      retryButton.disabled = state.autoAnalyze.running;
      retryButton.addEventListener("click", () => retryFailedJob(job.id));
      item.append(retryButton);
    }

    fragment.append(item);
  }

  els.jobHistory.replaceChildren(fragment);
}

function getJobStatusText(status) {
  if (status === "queued") {
    return "排队中";
  }
  if (status === "running") {
    return "运行中";
  }
  if (status === "canceling") {
    return "停止中";
  }
  if (status === "canceled") {
    return "已停止";
  }
  if (status === "error") {
    return "失败";
  }
  return "已完成";
}

async function retryFailedJob(jobId) {
  setStatus("正在重跑失败段落");
  try {
    const response = await apiFetch(`/api/jobs/${encodeURIComponent(jobId)}/retry-failed`, {
      method: "POST",
    }, "重跑失败段落");
    const result = await readResponse(response);
    if (result.job) {
      beginAnalysisJob(result.job);
    }
    await refreshCurrentPaper();
    await loadJobHistory();
    setStatus(result.message || "失败段落已重新加入队列");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function syncActiveAnalysisJob() {
  if (!state.paper) {
    return;
  }

  try {
    const response = await apiFetch(`/api/papers/${encodeURIComponent(state.paper.id)}/analysis-jobs/active`, {}, "同步分析任务");
    const result = await readResponse(response);
    if (result.job) {
      beginAnalysisJob(result.job);
      await pollAnalysisJob({ forceRefresh: true });
    } else if (state.autoAnalyze.running) {
      clearAutoTimer();
      state.autoAnalyze.running = false;
      state.autoAnalyze.stopRequested = false;
      state.autoAnalyze.jobId = null;
      updateAutoButtons();
    }
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function refreshCurrentPaper() {
  if (!state.paper) {
    return;
  }

  const response = await apiFetch(`/api/papers/${encodeURIComponent(state.paper.id)}`, {}, "刷新论文状态");
  state.paper = await readResponse(response);
  renderPaper();
}

function needsAnalysis(paragraph) {
  return !paragraph.translation && !paragraph.explanation && paragraph.analysisStatus !== "done";
}

function resetParagraphAnalyses(paragraphs) {
  for (const paragraph of paragraphs) {
    paragraph.translation = "";
    paragraph.explanation = "";
    paragraph.keyTerms = [];
    paragraph.analysisStatus = "pending";
    paragraph.analysisError = "";
  }
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
    const response = await apiFetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        paperId: state.paper.id,
        paragraphId,
        message,
        settings: getSettings(),
      }),
    }, "段落追问");
    const result = await readResponse(response);
    applySecuredSettings(result.settings);
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
  const { apiKey, apiKeyRef, model, baseUrl } = getSettings();
  if (!apiKey && !apiKeyRef && baseUrl !== "local:claude-config") {
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
        fragment.append(renderPagePreview(pageImage, getPageArtifacts(paper, paragraph.pageNumber)));
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

function getPageArtifacts(paper, pageNumber) {
  return (paper.pageArtifacts || [])
    .filter((item) => item.pageNumber === pageNumber && item.type !== "figure-text")
    .sort((a, b) => Number(a.y || 0) - Number(b.y || 0))
    .slice(0, 8);
}

function renderPagePreview(pageImage, artifacts = []) {
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

  if (artifacts.length) {
    const artifactList = document.createElement("div");
    artifactList.className = "page-artifacts";
    for (const artifact of artifacts) {
      artifactList.append(renderPageArtifact(artifact));
    }
    wrapper.append(artifactList);
  }

  return wrapper;
}

function renderPageArtifact(artifact) {
  const card = document.createElement("div");
  card.className = `page-artifact ${artifact.type}`;
  card.id = artifact.id;

  const meta = document.createElement("div");
  meta.className = "page-artifact-meta";
  meta.textContent = artifact.label
    ? `${artifact.label} · ${getArtifactLabel(artifact.type, artifact.visualType)}`
    : getArtifactLabel(artifact.type, artifact.visualType);

  const body = artifact.type === "code"
    ? document.createElement("pre")
    : document.createElement("p");
  if (artifact.type === "code") {
    body.textContent = artifact.text;
  } else {
    const text = artifact.type === "formula" && !hasMathDelimiters(artifact.text)
      ? `\\[${artifact.text}\\]`
      : artifact.text;
    renderRichText(body, text);
  }

  const crop = renderArtifactCrop(artifact);
  if (crop) {
    card.append(meta, crop, body);
  } else {
    card.append(meta, body);
  }

  return card;
}

function renderArtifactCrop(artifact) {
  const crop = artifact.crop;
  if (!artifact.imagePath || !crop || !crop.width || !crop.height || !crop.pageWidth || !crop.pageHeight) {
    return null;
  }

  const frame = document.createElement("button");
  frame.className = "artifact-crop";
  frame.type = "button";
  frame.title = `放大查看${getArtifactLabel(artifact.type, artifact.visualType)}`;
  frame.style.aspectRatio = `${crop.width} / ${crop.height}`;
  frame.addEventListener("click", () => openArtifactViewer(artifact));

  frame.append(renderCropImage(artifact));
  return frame;
}

function renderCropImage(artifact) {
  const crop = artifact.crop;
  const image = document.createElement("img");
  image.src = artifact.imagePath;
  image.alt = artifact.label
    ? `${artifact.label} 裁剪预览`
    : `${getArtifactLabel(artifact.type, artifact.visualType)}裁剪预览`;
  image.loading = "lazy";
  image.decoding = "async";
  image.style.width = `${(crop.pageWidth / crop.width) * 100}%`;
  image.style.height = `${(crop.pageHeight / crop.height) * 100}%`;
  image.style.left = `${-(crop.x / crop.width) * 100}%`;
  image.style.top = `${-(crop.y / crop.height) * 100}%`;
  return image;
}

function openArtifactViewer(artifact) {
  closeArtifactViewer();

  const overlay = document.createElement("div");
  overlay.className = "artifact-viewer";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      closeArtifactViewer();
    }
  });

  const panel = document.createElement("section");
  panel.className = "artifact-viewer-panel";

  const header = document.createElement("div");
  header.className = "artifact-viewer-header";

  const title = document.createElement("div");
  title.className = "artifact-viewer-title";
  title.textContent = artifact.label
    ? `${artifact.label} · ${getArtifactLabel(artifact.type, artifact.visualType)}`
    : getArtifactLabel(artifact.type, artifact.visualType);

  const actions = document.createElement("div");
  actions.className = "artifact-viewer-actions";

  const pageLink = document.createElement("a");
  pageLink.href = artifact.imagePath;
  pageLink.target = "_blank";
  pageLink.rel = "noreferrer";
  pageLink.textContent = "打开整页";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.textContent = "关闭";
  closeButton.addEventListener("click", closeArtifactViewer);

  actions.append(pageLink, closeButton);
  header.append(title, actions);

  const cropFrame = document.createElement("div");
  cropFrame.className = "artifact-viewer-crop";
  cropFrame.style.aspectRatio = `${artifact.crop.width} / ${artifact.crop.height}`;
  cropFrame.style.width = `min(100%, 1080px, calc(74vh * ${artifact.crop.width / artifact.crop.height}))`;
  cropFrame.append(renderCropImage(artifact));

  const caption = document.createElement(artifact.type === "code" ? "pre" : "p");
  caption.className = "artifact-viewer-caption";
  if (artifact.type === "code") {
    caption.textContent = artifact.text;
  } else {
    renderRichText(caption, artifact.text);
  }

  panel.append(header, cropFrame, caption);
  overlay.append(panel);
  document.body.append(overlay);

  const onKeydown = (event) => {
    if (event.key === "Escape") {
      closeArtifactViewer();
    }
  };
  overlay._onKeydown = onKeydown;
  document.addEventListener("keydown", onKeydown);
}

function closeArtifactViewer() {
  const overlay = document.querySelector(".artifact-viewer");
  if (!overlay) {
    return;
  }

  if (overlay._onKeydown) {
    document.removeEventListener("keydown", overlay._onKeydown);
  }
  overlay.remove();
}

function getArtifactLabel(type, visualType = "") {
  const labels = {
    caption: "图表说明",
    code: "代码块",
    formula: "公式",
  };

  if (type === "caption" && visualType === "table") {
    return "表格";
  }
  if (type === "caption" && visualType === "figure") {
    return "图片";
  }

  return labels[type] || "页面材料";
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
  const pageLabel = paragraph.pageEndNumber && paragraph.pageEndNumber !== paragraph.pageNumber
    ? `第 ${paragraph.pageNumber}-${paragraph.pageEndNumber} 页`
    : `第 ${paragraph.pageNumber} 页`;
  kicker.textContent = `P${paragraph.order + 1} · ${pageLabel}`;

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
  renderRichText(source, paragraph.sourceText);
  content.append(source);

  const relatedArtifacts = getRelatedArtifactsForParagraph(state.paper, paragraph);
  if (relatedArtifacts.length) {
    content.append(renderRelatedArtifacts(relatedArtifacts));
  }

  if (getAnalysisStatus(paragraph) === "queued" && !paragraph.translation && !paragraph.explanation) {
    content.append(renderAnalysisNotice("已加入后端队列，等待生成翻译与讲解"));
  }

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

function getRelatedArtifactsForParagraph(paper, paragraph) {
  const artifacts = paper?.pageArtifacts || [];
  const ids = new Set(paragraph.relatedArtifactIds || []);

  for (const artifact of artifacts) {
    if (artifact.type === "caption" && paragraphMentionsArtifact(paragraph.sourceText, artifact)) {
      ids.add(artifact.id);
    }
  }

  return artifacts.filter((artifact) => ids.has(artifact.id));
}

function paragraphMentionsArtifact(text, artifact) {
  const parsed = parseArtifactLabel(artifact.label);
  if (!parsed) {
    return false;
  }

  const number = escapeRegExp(parsed.number);
  const pattern = parsed.kind === "table"
    ? `\\b(?:table|tab\\.?)\\s*${number}(?:\\s*\\([a-z]\\))?\\b`
    : `\\b(?:figure|fig\\.?)\\s*${number}(?:\\s*\\([a-z]\\))?\\b`;

  return new RegExp(pattern, "i").test(String(text || ""));
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

function renderRelatedArtifacts(artifacts) {
  const row = document.createElement("div");
  row.className = "related-artifacts";

  const label = document.createElement("span");
  label.className = "related-artifacts-label";
  label.textContent = "相关图表";
  row.append(label);

  for (const artifact of artifacts) {
    const link = document.createElement("a");
    link.className = "artifact-link";
    link.href = `#${artifact.id}`;
    link.textContent = artifact.label || getArtifactLabel(artifact.type, artifact.visualType);
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const target = document.getElementById(artifact.id);
      if (!target) {
        return;
      }

      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("is-highlighted");
      window.setTimeout(() => target.classList.remove("is-highlighted"), 1600);
    });
    row.append(link);
  }

  return row;
}

function getAnalysisStatus(paragraph) {
  if (paragraph.analysisStatus === "queued") {
    return "queued";
  }

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
  if (status === "queued") {
    return "队列中";
  }
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
  if (status === "queued") {
    return "队列中";
  }
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
  notice.textContent = isError ? normalizeDisplayError(text) : text;
  return notice;
}

function normalizeDisplayError(text) {
  const message = String(text || "");
  if (/failed to fetch|fetch failed/i.test(message)) {
    return "网络请求失败：无法连接本机服务或模型服务。请确认 PaperLens 仍在运行，并检查模型代理/API 配置后重试。";
  }

  return message;
}

function renderRichText(element, text) {
  element.replaceChildren(createRichTextFragment(String(text || "")));
}

function createRichTextFragment(text) {
  const fragment = document.createDocumentFragment();
  const segments = splitMathSegments(text);

  for (const segment of segments) {
    if (!segment.math) {
      fragment.append(document.createTextNode(segment.text));
      continue;
    }

    fragment.append(renderMathSegment(segment.text, segment.display));
  }

  return fragment;
}

function splitMathSegments(text) {
  const segments = [];
  let index = 0;

  while (index < text.length) {
    const next = findNextMathDelimiter(text, index);
    if (!next) {
      segments.push({ math: false, text: text.slice(index) });
      break;
    }

    if (next.start > index) {
      segments.push({ math: false, text: text.slice(index, next.start) });
    }

    const contentStart = next.start + next.open.length;
    const close = text.indexOf(next.close, contentStart);
    if (close === -1) {
      segments.push({ math: false, text: text.slice(next.start) });
      break;
    }

    segments.push({
      math: true,
      display: next.display,
      text: text.slice(contentStart, close).trim(),
    });
    index = close + next.close.length;
  }

  return segments;
}

function hasMathDelimiters(text) {
  return /\$\$|\$[^$\s]|\\\(|\\\[/.test(String(text || ""));
}

function findNextMathDelimiter(text, fromIndex) {
  const delimiters = [
    { open: "$$", close: "$$", display: true },
    { open: "\\[", close: "\\]", display: true },
    { open: "\\(", close: "\\)", display: false },
    { open: "$", close: "$", display: false },
  ];
  let best = null;

  for (const delimiter of delimiters) {
    const start = text.indexOf(delimiter.open, fromIndex);
    if (start === -1) {
      continue;
    }

    if (delimiter.open === "$" && !isLikelyInlineDollar(text, start)) {
      continue;
    }

    if (!best || start < best.start || (start === best.start && delimiter.open.length > best.open.length)) {
      best = { ...delimiter, start };
    }
  }

  return best;
}

function isLikelyInlineDollar(text, index) {
  if (text[index + 1] === "$") {
    return false;
  }

  const previous = text[index - 1] || "";
  const next = text[index + 1] || "";
  if (!next || /\s/.test(next) || /\d/.test(next)) {
    return false;
  }

  return !previous || !/[A-Za-z0-9]/.test(previous);
}

function renderMathSegment(source, display = false) {
  const wrapper = document.createElement("span");
  wrapper.className = display ? "math-block" : "math-inline";
  wrapper.title = source;
  renderLatexInto(wrapper, source);
  return wrapper;
}

function renderLatexInto(container, source) {
  const stream = { source: normalizeLatexSource(source), index: 0 };
  renderLatexStream(stream, container, "");
}

function normalizeLatexSource(source) {
  return String(source || "")
    .replace(/\\left/g, "")
    .replace(/\\right/g, "")
    .replace(/\\,/g, " ")
    .replace(/\\;/g, " ")
    .replace(/\\!/g, "");
}

function renderLatexStream(stream, container, stopChar) {
  let lastToken = null;

  while (stream.index < stream.source.length) {
    const char = stream.source[stream.index];
    if (stopChar && char === stopChar) {
      stream.index += 1;
      break;
    }

    if (/\s/.test(char)) {
      container.append(document.createTextNode(" "));
      stream.index += 1;
      continue;
    }

    if ((char === "^" || char === "_") && lastToken) {
      stream.index += 1;
      const script = document.createElement(char === "^" ? "sup" : "sub");
      renderLatexInto(script, readLatexArgument(stream));
      lastToken.append(script);
      continue;
    }

    const token = readLatexToken(stream);
    if (token) {
      container.append(token);
      lastToken = token.classList?.contains("math-token") || token.classList?.contains("math-frac") ||
        token.classList?.contains("math-root")
        ? token
        : lastToken;
    }
  }
}

function readLatexToken(stream) {
  const char = stream.source[stream.index];

  if (char === "\\") {
    stream.index += 1;
    const command = readLatexCommand(stream);
    return renderLatexCommand(command, stream);
  }

  if (char === "{") {
    stream.index += 1;
    const group = document.createElement("span");
    group.className = "math-token";
    renderLatexStream(stream, group, "}");
    return group;
  }

  stream.index += 1;
  return mathToken(mapLatexSymbol(char) || char);
}

function readLatexCommand(stream) {
  const start = stream.index;
  while (stream.index < stream.source.length && /[A-Za-z]/.test(stream.source[stream.index])) {
    stream.index += 1;
  }

  if (stream.index === start && stream.index < stream.source.length) {
    stream.index += 1;
  }

  return stream.source.slice(start, stream.index);
}

function renderLatexCommand(command, stream) {
  if (command === "frac") {
    const numerator = readLatexArgument(stream);
    const denominator = readLatexArgument(stream);
    const fraction = document.createElement("span");
    fraction.className = "math-frac";
    const top = document.createElement("span");
    const bottom = document.createElement("span");
    renderLatexInto(top, numerator);
    renderLatexInto(bottom, denominator);
    fraction.append(top, bottom);
    return fraction;
  }

  if (command === "sqrt") {
    const root = document.createElement("span");
    root.className = "math-root";
    const body = document.createElement("span");
    renderLatexInto(body, readLatexArgument(stream));
    root.append(mathToken("√"), body);
    return root;
  }

  if (["text", "mathrm", "operatorname", "mathbf", "mathit"].includes(command)) {
    const token = document.createElement("span");
    token.className = "math-token";
    renderLatexInto(token, readLatexArgument(stream));
    return token;
  }

  return mathToken(LATEX_COMMANDS[command] || `\\${command}`);
}

function readLatexArgument(stream) {
  while (stream.index < stream.source.length && /\s/.test(stream.source[stream.index])) {
    stream.index += 1;
  }

  if (stream.source[stream.index] === "{") {
    stream.index += 1;
    let depth = 1;
    const start = stream.index;
    while (stream.index < stream.source.length && depth > 0) {
      const char = stream.source[stream.index];
      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
      }
      stream.index += 1;
    }
    return stream.source.slice(start, stream.index - 1);
  }

  if (stream.source[stream.index] === "\\") {
    stream.index += 1;
    return `\\${readLatexCommand(stream)}`;
  }

  const value = stream.source[stream.index] || "";
  stream.index += 1;
  return value;
}

function mathToken(text) {
  const span = document.createElement("span");
  span.className = "math-token";
  span.textContent = text;
  return span;
}

function mapLatexSymbol(char) {
  const symbols = {
    "*": "·",
    "-": "−",
  };
  return symbols[char] || "";
}

const LATEX_COMMANDS = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ϵ",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  vartheta: "ϑ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  varphi: "ϕ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  neq: "≠",
  approx: "≈",
  sim: "∼",
  times: "×",
  cdot: "·",
  pm: "±",
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  infty: "∞",
  sum: "∑",
  prod: "∏",
  int: "∫",
  partial: "∂",
  nabla: "∇",
  forall: "∀",
  exists: "∃",
  in: "∈",
  notin: "∉",
  subset: "⊂",
  subseteq: "⊆",
  cup: "∪",
  cap: "∩",
  log: "log",
  exp: "exp",
  min: "min",
  max: "max",
  argmin: "argmin",
  argmax: "argmax",
  softmax: "softmax",
};

function renderAnalysisBox(title, text) {
  const box = document.createElement("section");
  box.className = "analysis-box";

  const heading = document.createElement("h3");
  heading.textContent = title;

  const body = document.createElement("p");
  renderRichText(body, text);

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
  renderRichText(p, text);
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
    `后端分析 ${state.autoAnalyze.completed + state.autoAnalyze.failed}/${state.autoAnalyze.total}`,
    `失败 ${state.autoAnalyze.failed}`,
    `已用 ${elapsed}s${currentLabel}${stopLabel}`,
  ].join(" · "), state.autoAnalyze.failed > 0);
}

function updateAutoButtons() {
  els.autoAnalyzeButton.disabled = !state.paper || state.autoAnalyze.running;
  els.rerunAnalyzeButton.disabled = !state.paper || state.autoAnalyze.running;
  els.stopAutoButton.classList.toggle("hidden", !state.autoAnalyze.running);
  els.stopAutoButton.disabled = !state.autoAnalyze.running || state.autoAnalyze.stopRequested;
  renderJobHistory();
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
  els.statusText.textContent = isError ? normalizeDisplayError(text) : text;
  els.statusText.classList.toggle("error-text", isError);
}

function setModelStatus(text, isError = false) {
  els.modelStatusText.textContent = isError ? normalizeDisplayError(text) : text;
  els.modelStatusText.classList.toggle("error-text", isError);
}

async function apiFetch(url, options = {}, label = "请求") {
  const controller = new AbortController();
  const { timeoutMs, signal, ...fetchOptions } = options;
  const abortFromExternalSignal = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", abortFromExternalSignal, { once: true });
    }
  }
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs || API_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
  } catch (error) {
    const message = error.name === "AbortError"
      ? signal?.aborted
        ? `${label}已停止。`
        : `${label}超时。模型可能仍在处理，或本机服务暂时无响应。`
      : `${label}失败：无法连接 PaperLens 本机服务。请确认服务仍在运行，或刷新页面后重试。`;
    const wrapped = new Error(message);
    wrapped.cause = error;
    wrapped.isNetworkError = true;
    wrapped.isAbort = error.name === "AbortError" && Boolean(signal?.aborted);
    throw wrapped;
  } finally {
    signal?.removeEventListener("abort", abortFromExternalSignal);
    window.clearTimeout(timeout);
  }
}

async function readResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed with ${response.status}`);
  }

  return data;
}
