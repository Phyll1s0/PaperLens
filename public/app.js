const state = {
  paper: null,
  query: "",
  libraryQuery: "",
  favoriteOnly: false,
  analysisProfile: "quality",
  maintenanceBusy: false,
  busyParagraphId: null,
  pipelineBusy: false,
  jobHistory: [],
  progressTimer: null,
  lastProgressParagraphId: "",
  autoAnalyze: {
    running: false,
    stopRequested: false,
    jobId: null,
    completed: 0,
    failed: 0,
    cacheHits: 0,
    total: 0,
    currentId: null,
    currentBatchSize: 0,
    strategy: null,
    startedAt: 0,
    timer: null,
    pollInFlight: false,
    lastProgressKey: "",
    networkFailures: 0,
  },
  ocrJob: {
    running: false,
    jobId: null,
    status: "",
    message: "",
    startedAt: 0,
    timer: null,
    pollInFlight: false,
  },
  auth: {
    required: false,
    authenticated: true,
    checking: true,
    publicRisk: false,
    secretsEncrypted: false,
  },
};

const els = {
  authOverlay: document.querySelector("#authOverlay"),
  authForm: document.querySelector("#authForm"),
  authTokenInput: document.querySelector("#authTokenInput"),
  authLoginButton: document.querySelector("#authLoginButton"),
  authStatusText: document.querySelector("#authStatusText"),
  providerSelect: document.querySelector("#providerSelect"),
  baseUrlInput: document.querySelector("#baseUrlInput"),
  modelInput: document.querySelector("#modelInput"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  agentBudgetInput: document.querySelector("#agentBudgetInput"),
  proxyUrlInput: document.querySelector("#proxyUrlInput"),
  modelStatusText: document.querySelector("#modelStatusText"),
  modelDiagnosticsText: document.querySelector("#modelDiagnosticsText"),
  providerHintText: document.querySelector("#providerHintText"),
  providerGuide: document.querySelector("#providerGuide"),
  serviceStatusText: document.querySelector("#serviceStatusText"),
  pdfInput: document.querySelector("#pdfInput"),
  aiSegmentInput: document.querySelector("#aiSegmentInput"),
  autoAnalyzeInput: document.querySelector("#autoAnalyzeInput"),
  qualityProfileButton: document.querySelector("#qualityProfileButton"),
  fastProfileButton: document.querySelector("#fastProfileButton"),
  analysisDashboard: document.querySelector("#analysisDashboard"),
  uploadButton: document.querySelector("#uploadButton"),
  statusText: document.querySelector("#statusText"),
  librarySearchInput: document.querySelector("#librarySearchInput"),
  favoriteOnlyInput: document.querySelector("#favoriteOnlyInput"),
  rebuildAllVisualButton: document.querySelector("#rebuildAllVisualButton"),
  paperList: document.querySelector("#paperList"),
  paperMeta: document.querySelector("#paperMeta"),
  paperTitle: document.querySelector("#paperTitle"),
  paperStats: document.querySelector("#paperStats"),
  paperLibraryControls: document.querySelector("#paperLibraryControls"),
  favoriteButton: document.querySelector("#favoriteButton"),
  tagInput: document.querySelector("#tagInput"),
  saveTagsButton: document.querySelector("#saveTagsButton"),
  rebuildVisualButton: document.querySelector("#rebuildVisualButton"),
  emptyState: document.querySelector("#emptyState"),
  paragraphList: document.querySelector("#paragraphList"),
  outline: document.querySelector("#outline"),
  searchInput: document.querySelector("#searchInput"),
  autoAnalyzeButton: document.querySelector("#autoAnalyzeButton"),
  resumeAnalyzeButton: document.querySelector("#resumeAnalyzeButton"),
  downloadNotesButton: document.querySelector("#downloadNotesButton"),
  downloadDocxButton: document.querySelector("#downloadDocxButton"),
  rerunAnalyzeButton: document.querySelector("#rerunAnalyzeButton"),
  stopAutoButton: document.querySelector("#stopAutoButton"),
  jobHistory: document.querySelector("#jobHistory"),
  pingButton: document.querySelector("#pingButton"),
};

const PROVIDERS = {
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    hint: "DeepSeek OpenAI-compatible API。可改用 deepseek-v4-pro 获得更强模型。",
  },
  "claude-kimi-agent": {
    label: "Claude Code + Kimi Code Key",
    baseUrl: "local:claude-kimi",
    model: "kimi-for-coding",
    hint: "通过本机 Claude Code CLI 调用页面输入的 Kimi Code Key，并隔离 Claude 用户级 settings，避免被本机 OpenSSI 等配置覆盖。",
  },
  "claude-local": {
    label: "Claude Code 本机配置",
    baseUrl: "local:claude-config",
    model: "sonnet",
    hint: "通过本机 Claude Code 已登录/已配置的账号或 key 调用，不使用页面 API Key，适合使用 OpenSSI 等本机配置。",
  },
  "kimi-code": {
    label: "Kimi Code",
    baseUrl: "https://api.kimi.com/coding/v1",
    model: "kimi-for-coding",
    hint: "Kimi Code Key 可认证，但官方限制普通 Chat Completion 只面向 Coding Agent；本应用建议使用 Kimi 开放平台 Key。",
  },
  "kimi-platform": {
    label: "Kimi 开放平台",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "kimi-k2.6",
    hint: "Kimi 开放平台 Key 适合普通 OpenAI-compatible 应用调用。",
  },
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    hint: "OpenAI-compatible 普通 Chat Completion。",
  },
};

const API_TIMEOUT_MS = 240_000;
const CLIENT_LOADED_AT_MS = Date.now();
const REQUIRED_SERVICE_SCHEMA_VERSION = 2;
const SERVICE_VERSION_CHECK_INTERVAL_MS = 60_000;
const API_KEY_REF_STORAGE_KEY = "paper-reader-api-key-ref";
const API_KEY_INFO_STORAGE_KEY = "paper-reader-api-key-info";
const LEGACY_API_KEY_STORAGE_KEY = "paper-reader-api-key";
const ANALYSIS_PROFILE_LABELS = {
  quality: "精读",
  fast: "快速",
};
const CLIENT_ANALYSIS_DEFAULTS = {
  general: { batchSize: 12, concurrency: 3, maxBatchSize: 24, expectedBatchSeconds: 45, failedRetryBatchSize: 3 },
  deepseek: { batchSize: 12, concurrency: 3, maxBatchSize: 24, expectedBatchSeconds: 34, failedRetryBatchSize: 3 },
  "kimi-direct": { batchSize: 12, concurrency: 3, maxBatchSize: 20, expectedBatchSeconds: 42, failedRetryBatchSize: 2 },
  "claude-agent": { batchSize: 8, concurrency: 2, maxBatchSize: 20, expectedBatchSeconds: 75, failedRetryBatchSize: 2 },
};

loadSettings();
bindEvents();
initializeApp();

function bindEvents() {
  els.authForm.addEventListener("submit", (event) => {
    event.preventDefault();
    loginWithAccessToken();
  });
  els.uploadButton.addEventListener("click", uploadPdf);
  els.pingButton.addEventListener("click", pingModel);
  els.autoAnalyzeButton.addEventListener("click", () => startAutoAnalyze());
  els.resumeAnalyzeButton.addEventListener("click", resumeMissingAnalysis);
  els.downloadNotesButton.addEventListener("click", downloadPaperNotes);
  els.downloadDocxButton.addEventListener("click", downloadPaperDocx);
  els.rerunAnalyzeButton.addEventListener("click", rerunFullPipeline);
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
  els.librarySearchInput.addEventListener("input", debounce(() => {
    state.libraryQuery = els.librarySearchInput.value.trim();
    loadRecentPapers();
  }, 250));
  els.favoriteOnlyInput.addEventListener("change", () => {
    state.favoriteOnly = els.favoriteOnlyInput.checked;
    loadRecentPapers();
  });
  els.rebuildAllVisualButton.addEventListener("click", rebuildAllVisualArtifacts);
  els.qualityProfileButton.addEventListener("click", () => setAnalysisProfile("quality"));
  els.fastProfileButton.addEventListener("click", () => setAnalysisProfile("fast"));
  els.favoriteButton.addEventListener("click", () => {
    if (state.paper) {
      updatePaperMetadata({ favorite: !state.paper.favorite });
    }
  });
  els.saveTagsButton.addEventListener("click", savePaperTags);
  els.rebuildVisualButton.addEventListener("click", rebuildVisualArtifacts);
  els.tagInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      savePaperTags();
    }
  });
  els.paragraphList.addEventListener("scroll", scheduleReadingProgressSave);
  window.addEventListener("scroll", scheduleReadingProgressSave, { passive: true });
  window.addEventListener("online", () => {
    if (!state.paper) {
      return;
    }
    setStatus("网络已恢复，正在同步后端任务");
    syncActiveAnalysisJob();
  });
  window.addEventListener("offline", () => {
    if (state.autoAnalyze.running) {
      setStatus("浏览器网络已断开；后端分析队列会保留，恢复连接后会自动同步。", true);
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.paper) {
      syncActiveAnalysisJob();
    }
    if (document.visibilityState === "visible") {
      checkServiceVersion();
    }
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

async function initializeApp() {
  renderAuthGate();
  updateModelDiagnostics();
  updateAutoButtons();

  try {
    const auth = await fetchAuthStatus();
    applyAuthStatus(auth);
    if (canUseApp()) {
      loadRecentPapers();
    }
  } catch (error) {
    applyAuthStatus({
      authRequired: true,
      authenticated: false,
      message: error.message,
    });
  }

  checkServiceVersion();
  window.setInterval(checkServiceVersion, SERVICE_VERSION_CHECK_INTERVAL_MS);
}

async function fetchAuthStatus() {
  const response = await fetch("/api/auth/status", {
    cache: "no-store",
  });
  return await response.json().catch(() => ({}));
}

function applyAuthStatus(payload = {}) {
  state.auth.required = Boolean(payload.authRequired);
  state.auth.authenticated = payload.authenticated !== false;
  state.auth.checking = false;
  state.auth.publicRisk = Boolean(payload.publicRisk);
  state.auth.secretsEncrypted = Boolean(payload.secretsEncrypted);
  renderAuthGate(payload.message || "");
}

function canUseApp() {
  return !state.auth.required || state.auth.authenticated;
}

function renderAuthGate(message = "") {
  if (!els.authOverlay) {
    return;
  }

  const locked = state.auth.checking || (state.auth.required && !state.auth.authenticated);
  els.authOverlay.classList.toggle("hidden", !locked);
  document.body.classList.toggle("auth-locked", locked);
  if (els.authStatusText) {
    els.authStatusText.textContent = state.auth.checking
      ? "正在检查访问状态"
      : message || "这个 PaperLens 实例已启用访问保护。";
  }
  if (locked && !state.auth.checking) {
    window.setTimeout(() => els.authTokenInput?.focus(), 50);
  }
}

async function loginWithAccessToken() {
  const token = els.authTokenInput.value.trim();
  if (!token) {
    els.authStatusText.textContent = "请输入访问令牌。";
    return;
  }

  els.authLoginButton.disabled = true;
  els.authStatusText.textContent = "正在登录";
  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || `登录失败：HTTP ${response.status}`);
    }

    els.authTokenInput.value = "";
    applyAuthStatus(result);
    loadRecentPapers();
    checkServiceVersion();
    setStatus("已进入 PaperLens");
  } catch (error) {
    els.authStatusText.textContent = normalizeDisplayError(error.message);
  } finally {
    els.authLoginButton.disabled = false;
  }
}

function handleUnauthorizedResponse(data = {}) {
  applyAuthStatus({
    authRequired: true,
    authenticated: false,
    message: data.error || "访问令牌已失效，请重新登录。",
  });
}

function loadSettings() {
  const provider = sessionStorage.getItem("paper-reader-provider") || "deepseek";
  const legacyApiKey = sessionStorage.getItem(LEGACY_API_KEY_STORAGE_KEY) || "";
  sessionStorage.removeItem(LEGACY_API_KEY_STORAGE_KEY);
  els.providerSelect.value = provider;
  els.apiKeyInput.value = legacyApiKey;
  els.agentBudgetInput.value = sessionStorage.getItem("paper-reader-agent-budget") || "500";
  els.proxyUrlInput.value = sessionStorage.getItem("paper-reader-proxy-url") || "";
  state.analysisProfile = normalizeAnalysisProfile(sessionStorage.getItem("paper-reader-analysis-profile") || "quality");
  els.aiSegmentInput.checked = sessionStorage.getItem("paper-reader-ai-segment") !== "false";
  els.autoAnalyzeInput.checked = sessionStorage.getItem("paper-reader-auto-analyze") !== "false";
  applyProvider(provider);

  if (!PROVIDERS[provider]) {
    els.baseUrlInput.value = sessionStorage.getItem("paper-reader-base-url") || els.baseUrlInput.value;
    els.modelInput.value = sessionStorage.getItem("paper-reader-model") || els.modelInput.value;
  }
  updateApiKeyPlaceholder();
  updateAnalysisProfileButtons();
  renderAnalysisDashboard();
}

function saveSettings() {
  sessionStorage.setItem("paper-reader-provider", els.providerSelect.value);
  sessionStorage.setItem("paper-reader-base-url", els.baseUrlInput.value.trim());
  sessionStorage.setItem("paper-reader-model", els.modelInput.value.trim());
  sessionStorage.removeItem(LEGACY_API_KEY_STORAGE_KEY);
  sessionStorage.setItem("paper-reader-agent-budget", els.agentBudgetInput.value.trim());
  sessionStorage.setItem("paper-reader-proxy-url", els.proxyUrlInput.value.trim());
  sessionStorage.setItem("paper-reader-analysis-profile", state.analysisProfile);
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
    analysisProfile: state.analysisProfile,
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
  if (settings.analysisProfile) {
    state.analysisProfile = normalizeAnalysisProfile(settings.analysisProfile);
    updateAnalysisProfileButtons();
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
  renderAnalysisDashboard();
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

function normalizeAnalysisProfile(value) {
  return value === "fast" ? "fast" : "quality";
}

function setAnalysisProfile(profile) {
  state.analysisProfile = normalizeAnalysisProfile(profile);
  saveSettings();
  updateAnalysisProfileButtons();
  renderAnalysisDashboard();
}

function updateAnalysisProfileButtons() {
  const profile = normalizeAnalysisProfile(state.analysisProfile);
  els.qualityProfileButton.setAttribute("aria-pressed", profile === "quality" ? "true" : "false");
  els.fastProfileButton.setAttribute("aria-pressed", profile === "fast" ? "true" : "false");
}

function updateModelDiagnostics(remoteDiagnostics) {
  const settings = getSettings();
  const endpoint = getChatEndpoint(settings.baseUrl);
  const savedKey = settings.apiKey ? null : getStoredKeyInfo();
  const isClaudeProvider = settings.baseUrl === "local:claude-kimi" || settings.baseUrl === "local:claude-config";
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
    proxyAppliedToAgent: isClaudeProvider,
    proxyTransport: {
      present: Boolean(settings.proxyUrl),
      applied: isClaudeProvider && Boolean(settings.proxyUrl),
      mode: isClaudeProvider ? "cli-env" : "direct",
      protocol: settings.proxyUrl ? settings.proxyUrl.split(":")[0] : "",
      supported: true,
      effectiveProxy: settings.proxyUrl,
    },
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

  const proxySource = diagnostics.proxySource && diagnostics.proxySource !== "none"
    ? ` (${diagnostics.proxySource})`
    : "";
  const proxyMode = diagnostics.proxyTransport?.mode && diagnostics.proxyTransport.mode !== "direct"
    ? ` · ${diagnostics.proxyTransport.mode}`
    : "";
  lines.push(`Proxy: ${diagnostics.proxyPresent ? `detected${proxySource}${proxyMode}` : "not detected"}`);

  els.modelDiagnosticsText.textContent = lines.join(" · ");
  renderProviderGuide(diagnostics);
}

function renderProviderGuide(diagnostics) {
  if (!els.providerGuide) {
    return;
  }

  const settings = getSettings();
  const guide = getProviderGuide(settings, diagnostics);
  const fragment = document.createDocumentFragment();

  const header = document.createElement("div");
  header.className = "provider-guide-header";
  const title = document.createElement("strong");
  title.textContent = guide.title;
  const summary = document.createElement("span");
  summary.textContent = guide.summary;
  header.append(title, summary);
  fragment.append(header);

  const chips = document.createElement("div");
  chips.className = "provider-guide-chips";
  for (const chip of guide.chips) {
    const item = document.createElement("span");
    item.className = `provider-guide-chip ${chip.status}`;
    item.textContent = chip.label;
    chips.append(item);
  }
  fragment.append(chips);

  const list = document.createElement("ul");
  list.className = "provider-guide-list";
  for (const item of guide.items) {
    const row = document.createElement("li");
    row.className = item.status;
    const marker = document.createElement("span");
    marker.className = "provider-guide-marker";
    marker.textContent = item.status === "ok" ? "✓" : item.status === "warn" ? "!" : "•";
    const text = document.createElement("span");
    text.textContent = item.text;
    row.append(marker, text);
    list.append(row);
  }
  fragment.append(list);

  els.providerGuide.replaceChildren(fragment);
}

function getProviderGuide(settings, diagnostics) {
  const provider = settings.provider || "custom";
  const preset = PROVIDERS[provider];
  const providerLabel = preset?.label || "自定义 Provider";
  const isClaudeProvider = settings.baseUrl === "local:claude-kimi" || settings.baseUrl === "local:claude-config";
  const keyRequired = settings.baseUrl !== "local:claude-config";
  const keyOk = !keyRequired || (Boolean(diagnostics.keyPresent) && diagnostics.keyFormatOk !== false);
  const keyStatus = getKeyGuideStatus(settings, diagnostics, keyRequired);
  const cliStatus = getClaudeCliGuideStatus(settings, diagnostics);
  const proxyStatus = getProxyGuideStatus(settings, diagnostics);
  const runtimeLabel = diagnostics.runtime?.isDocker ? "Docker" : "本机";
  const chips = [
    { label: providerLabel, status: "neutral" },
    { label: keyStatus.chip, status: keyStatus.status },
    { label: proxyStatus.chip, status: proxyStatus.status },
    { label: runtimeLabel, status: diagnostics.runtime?.isDocker ? "warn" : "neutral" },
  ];

  if (isClaudeProvider) {
    chips.splice(2, 0, { label: cliStatus.chip, status: cliStatus.status });
  }

  const items = [
    { status: "ok", text: `Endpoint：${diagnostics.endpoint || getChatEndpoint(settings.baseUrl)}` },
    { status: keyStatus.status, text: keyStatus.text },
    { status: proxyStatus.status, text: proxyStatus.text },
  ];

  if (isClaudeProvider) {
    items.splice(2, 0, { status: cliStatus.status, text: cliStatus.text });
  }

  items.push(...getProviderSpecificGuideItems(settings, diagnostics, { keyOk, isClaudeProvider }));

  return {
    title: "配置向导",
    summary: getProviderGuideSummary(settings, diagnostics),
    chips,
    items,
  };
}

function getKeyGuideStatus(settings, diagnostics, keyRequired) {
  if (!keyRequired) {
    return {
      status: "ok",
      chip: "页面 Key 不需要",
      text: "Claude Code 本机配置会使用本机已登录或已配置的认证，页面 API Key 会被忽略。",
    };
  }

  if (!diagnostics.keyPresent) {
    return {
      status: "warn",
      chip: "Key 缺失",
      text: "请粘贴完整 API Key；不要使用控制台列表里脱敏后的 sk-ki... 形式。",
    };
  }

  if (!diagnostics.keyFormatOk) {
    return {
      status: "warn",
      chip: "Key 格式异常",
      text: "当前 Provider 需要完整 Kimi Code Key，格式应以 sk-kimi- 开头。",
    };
  }

  return {
    status: "ok",
    chip: diagnostics.keySaved ? "Key 已安全保存" : "Key 已填写",
    text: diagnostics.keySaved
      ? `已使用后端本地保存的 ${diagnostics.keyPrefix} Key，前端不会继续保存明文。`
      : `已检测到 ${diagnostics.keyPrefix} Key，长度 ${diagnostics.keyLength}。`,
  };
}

function getClaudeCliGuideStatus(settings, diagnostics) {
  if (settings.baseUrl !== "local:claude-kimi" && settings.baseUrl !== "local:claude-config") {
    return { status: "neutral", chip: "无需 Claude CLI", text: "" };
  }

  if (diagnostics.claudeAvailable) {
    const source = diagnostics.claudeCommandSource === "env"
      ? "PAPERLENS_CLAUDE_CLI"
      : "PATH";
    if (diagnostics.claudeCommandSource === "env" && diagnostics.claudeVerified === false) {
      return {
        status: "warn",
        chip: "Claude CLI 已配置",
        text: `后端会尝试调用 ${diagnostics.claudeCommand}，来源：${source}；该命令不是绝对路径，需要运行时验证。`,
      };
    }

    return {
      status: "ok",
      chip: "Claude CLI 已找到",
      text: `后端会调用 ${diagnostics.claudeCommand}，来源：${source}。`,
    };
  }

  return {
    status: "warn",
    chip: "Claude CLI 缺失",
    text: diagnostics.runtime?.isDocker
      ? "容器里没有找到 claude CLI；请重建包含 Claude Code 的镜像，或在容器环境设置 PAPERLENS_CLAUDE_CLI。"
      : "本机没有找到 claude CLI；请先确认终端能运行 claude --version，或设置 PAPERLENS_CLAUDE_CLI 指向可执行文件。",
  };
}

function getProxyGuideStatus(settings, diagnostics) {
  if (diagnostics.proxyPresent) {
    const sourceLabels = {
      page: "页面",
      env: ".env",
      environment: "环境变量",
    };
    const source = sourceLabels[diagnostics.proxySource] || diagnostics.proxySource || "配置";
    const transport = diagnostics.proxyTransport || {};
    const modeLabels = {
      "cli-env": "CLI 环境变量",
      "http-connect": "HTTP CONNECT",
      "socks5-tunnel": "SOCKS5 tunnel",
      direct: "直连",
    };
    const applies = diagnostics.proxyAppliedToAgent
      ? `后端会通过 ${modeLabels[transport.mode] || transport.mode || "代理传输"} 应用到模型请求。`
      : transport.noProxyBypassed
        ? "当前目标命中 NO_PROXY，后端会绕过代理。"
        : "已检测到代理，但当前协议不受 PaperLens 传输层支持。";
    const status = diagnostics.proxyAppliedToAgent
      ? "ok"
      : transport.noProxyBypassed ? "neutral" : "warn";
    return {
      status,
      chip: `Proxy ${source}`,
      text: `已检测到代理来源：${source}${transport.effectiveProxy ? `（${transport.effectiveProxy}）` : ""}。${applies}`,
    };
  }

  return {
    status: "neutral",
    chip: "Proxy 未填",
    text: diagnostics.runtime?.isDocker
      ? "如果容器需要访问宿主机代理，Proxy URL 通常写 http://host.docker.internal:端口，而不是 127.0.0.1。"
      : "如果模型服务需要代理，在 Proxy URL 填你的本机代理地址，例如 http://127.0.0.1:7897。",
  };
}

function getProviderGuideSummary(settings, diagnostics) {
  if (settings.provider === "claude-kimi-agent") {
    return "页面 Kimi Code Key 会注入到本机 Claude Code CLI，适合 Kimi Code Key 不能直接 Chat Completion 的情况。";
  }

  if (settings.provider === "claude-local") {
    return "不读取页面 Key，完全依赖运行 PaperLens 的那台机器上的 Claude Code 配置。";
  }

  if (settings.provider === "kimi-code") {
    return "只用于验证 Kimi Code endpoint；若提示访问受限，切到 Claude Code + Kimi Code Key。";
  }

  if (settings.provider === "kimi-platform") {
    return "适合普通网页应用调用，和 Kimi Code 控制台生成的 Key 不是同一种入口。";
  }

  if (settings.provider === "deepseek") {
    return "OpenAI-compatible 普通接口，适合批量翻译讲解和较高吞吐。";
  }

  return diagnostics.endpoint || "使用自定义 Base URL 和模型名。";
}

function getProviderSpecificGuideItems(settings, diagnostics, context) {
  const items = [];

  if (settings.provider === "claude-kimi-agent") {
    items.push({
      status: diagnostics.runtime?.isDocker ? "warn" : "ok",
      text: diagnostics.runtime?.isDocker
        ? "当前在 Docker 内运行；页面 Key 能传给容器内 CLI，但不会读取宿主机 ~/.claude。"
        : "当前在本机进程运行；会使用页面输入的 Kimi Code Key，并隔离用户级 Claude settings。",
    });
    items.push({
      status: "neutral",
      text: "如果出现 Budget has been exceeded，说明已走到 Claude Code/Kimi 认证链路，下一步应检查 CLI 实际使用的账户、Key 和预算来源。",
    });
  } else if (settings.provider === "claude-local") {
    items.push({
      status: diagnostics.runtime?.isDocker ? "warn" : "ok",
      text: diagnostics.runtime?.isDocker
        ? "Docker 内的 Claude Code 本机配置和宿主机不同；需要把认证放进容器环境或改用页面 Key Provider。"
        : "页面不会覆盖本机 Claude Code 配置；如果本机配置是 OpenSSI，它会继续走那套认证。",
    });
  } else if (settings.provider === "kimi-code") {
    items.push({
      status: "warn",
      text: "Kimi Code Key 常见现象是认证成功但普通 Chat Completion 被拒绝；论文阅读建议优先用 Kimi 开放平台或 Claude Code + Kimi Code Key。",
    });
  } else if (settings.provider === "kimi-platform") {
    items.push({
      status: settings.baseUrl.includes("moonshot.cn") ? "ok" : "warn",
      text: "Kimi 开放平台应使用 https://api.moonshot.cn/v1；不要混用 Kimi Code Console 的 endpoint。",
    });
  } else if (settings.provider === "deepseek") {
    items.push({
      status: settings.baseUrl.includes("deepseek.com") ? "ok" : "warn",
      text: "DeepSeek 推荐 Base URL 为 https://api.deepseek.com，模型可用 deepseek-v4-flash 或 deepseek-v4-pro。",
    });
  } else if (settings.provider === "custom") {
    items.push({
      status: settings.baseUrl ? "ok" : "warn",
      text: "自定义 Provider 需要填写完整 Base URL；如果不是 /chat/completions 结尾，PaperLens 会自动拼接。",
    });
  }

  if (!context.keyOk) {
    items.push({
      status: "warn",
      text: "测试连接会先验证 Key 并把 Key 安全转存到后端本地引用；后续长任务使用引用，不把明文留在前端。",
    });
  }

  return items;
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
    setStatus(isOcrRequiredPaper(paper)
      ? "检测到扫描版 PDF：需要先 OCR，再进行分段和讲解。"
      : "解析完成",
      isOcrRequiredPaper(paper));
    renderPaper();
    loadRecentPapers();
    setBusy(false);
    if (isOcrRequiredPaper(paper)) {
      return;
    }
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

  if (isOcrRequiredPaper(state.paper)) {
    setStatus("这篇 PDF 需要 OCR 后才能进行 AI 分段和讲解。", true);
    return;
  }

  if (!ensureModelSettings({ quiet: true })) {
    setStatus("解析完成。输入 API Key 后可以启动自动翻译讲解。");
    return;
  }

  let segmentationReady = true;
  if (els.aiSegmentInput.checked) {
    segmentationReady = await segmentPaperWithAi({ continueOnError: true });
  }

  if (els.autoAnalyzeInput.checked) {
    if (!segmentationReady) {
      setStatus("AI 分段失败，已暂停自动分析。请重新分段后再启动翻译讲解。", true);
      return;
    }

    await startAutoAnalyze();
  }
}

async function segmentPaperWithAi(options = {}) {
  if (!state.paper) {
    return false;
  }

  if (isOcrRequiredPaper(state.paper)) {
    setStatus("扫描版 PDF 需要先 OCR，无法直接 AI 分段。", true);
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
    const params = new URLSearchParams();
    if (state.libraryQuery) {
      params.set("q", state.libraryQuery);
    }
    if (state.favoriteOnly) {
      params.set("favorite", "1");
    }
    const response = await apiFetch(`/api/papers${params.toString() ? `?${params}` : ""}`, {}, "载入最近论文");
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
    resetAnalysisJobState();
    state.query = "";
    state.lastProgressParagraphId = state.paper.readingProgress?.paragraphId || "";
    els.searchInput.value = "";
    setStatus("论文已载入");
    renderPaper();
    scrollToReadingProgress();
    await syncActiveAnalysisJob();
    await loadJobHistory();
  } catch (error) {
    setStatus(error.message, true);
  }
}

function renderRecentPapers(papers) {
  if (!papers.length) {
    els.paperList.textContent = state.libraryQuery || state.favoriteOnly ? "没有匹配论文" : "暂无论文";
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const paper of papers.slice(0, 20)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "paper-list-item";
    button.addEventListener("click", () => openPaper(paper.id));

    const title = document.createElement("span");
    title.textContent = `${paper.favorite ? "★ " : ""}${paper.title || paper.filename}`;

    const meta = document.createElement("small");
    const progress = Number(paper.readingProgress?.percent || 0);
    const exportLabel = paper.latestExport ? ` · ${paper.latestExport.format}` : "";
    const matchLabel = paper.matchedParagraphCount ? ` · 命中 ${paper.matchedParagraphCount}` : "";
    const ocrLabel = paper.ocr?.needed ? " · 需要 OCR" : "";
    meta.textContent = `${paper.pageCount} 页 · ${paper.paragraphCount} 段 · ${progress}%${ocrLabel}${exportLabel}${matchLabel}`;

    button.append(title, meta);
    if (paper.tags?.length) {
      const tags = document.createElement("div");
      tags.className = "paper-list-tags";
      tags.textContent = paper.tags.map((tag) => `#${tag}`).join(" ");
      button.append(tags);
    }
    if (paper.matchSnippet) {
      const snippet = document.createElement("small");
      snippet.className = "paper-list-snippet";
      snippet.textContent = paper.matchSnippet;
      button.append(snippet);
    }
    fragment.append(button);
  }

  els.paperList.replaceChildren(fragment);
}

async function updatePaperMetadata(patch, options = {}) {
  if (!state.paper) {
    return null;
  }

  try {
    const response = await apiFetch(`/api/papers/${encodeURIComponent(state.paper.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }, "更新论文信息");
    state.paper = await readResponse(response);
    if (!options.quiet) {
      setStatus("论文信息已更新");
      renderPaper();
      await loadRecentPapers();
    }
    return state.paper;
  } catch (error) {
    if (!options.quiet) {
      setStatus(error.message, true);
    }
    return null;
  }
}

function savePaperTags() {
  if (!state.paper) {
    return;
  }

  const tags = els.tagInput.value
    .split(/[,，#\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  updatePaperMetadata({ tags });
}

async function rebuildVisualArtifacts() {
  if (!state.paper || state.maintenanceBusy) {
    return;
  }

  state.maintenanceBusy = true;
  updateAutoButtons();
  setStatus("正在重建视觉结构和图表裁剪");

  try {
    const response = await apiFetch(`/api/papers/${encodeURIComponent(state.paper.id)}/visual-artifacts/rebuild`, {
      method: "POST",
    }, "重建视觉结构");
    const result = await readResponse(response);
    state.paper = result.paper || state.paper;
    renderPaper();
    await loadRecentPapers();
    setStatus(result.message || formatVisualRebuildStatus(result.stats));
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    state.maintenanceBusy = false;
    updateAutoButtons();
  }
}

async function rebuildAllVisualArtifacts() {
  if (state.maintenanceBusy) {
    return;
  }

  state.maintenanceBusy = true;
  updateAutoButtons();
  setStatus("正在批量重建本地论文库图表裁剪");

  try {
    const response = await apiFetch("/api/papers/visual-artifacts/rebuild", {
      method: "POST",
    }, "批量重建视觉结构");
    const result = await readResponse(response);
    if (state.paper) {
      await refreshCurrentPaper();
    }
    await loadRecentPapers();
    setStatus(result.message || formatVisualRebuildAllStatus(result.summary));
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    state.maintenanceBusy = false;
    updateAutoButtons();
  }
}

function formatVisualRebuildStatus(stats = {}) {
  return [
    `已重建 ${stats.pages || 0} 页`,
    `图表 ${stats.artifacts || 0} 个`,
    `像素收紧 ${stats.pixelRefined || 0} 个`,
  ].join(" · ");
}

function formatVisualRebuildAllStatus(summary = {}) {
  return [
    `已维护 ${summary.rebuilt || 0}/${summary.papers || 0} 篇`,
    `图表 ${summary.artifacts || 0} 个`,
    `失败 ${summary.failed || 0}`,
  ].join(" · ");
}

function scheduleReadingProgressSave() {
  if (!state.paper) {
    return;
  }

  window.clearTimeout(state.progressTimer);
  state.progressTimer = window.setTimeout(saveVisibleReadingProgress, 650);
}

function saveVisibleReadingProgress() {
  const paragraph = getVisibleReadingParagraph();
  if (!paragraph || paragraph.id === state.lastProgressParagraphId) {
    return;
  }

  state.lastProgressParagraphId = paragraph.id;
  updatePaperMetadata({
    readingProgress: {
      paragraphId: paragraph.id,
      paragraphOrder: paragraph.order,
    },
  }, { quiet: true });
}

function getVisibleReadingParagraph() {
  const cards = [...document.querySelectorAll(".paragraph-card[id]")];
  if (!cards.length || !state.paper) {
    return null;
  }

  const viewportTop = 92;
  const candidate = cards.find((card) => {
    const rect = card.getBoundingClientRect();
    return rect.bottom > viewportTop && rect.top < window.innerHeight * 0.74;
  }) || cards[0];
  return state.paper.paragraphs.find((paragraph) => paragraph.id === candidate.id) || null;
}

function formatExportHistoryLabel(entry) {
  if (!entry) {
    return "";
  }

  const date = entry.exportedAt ? new Date(entry.exportedAt) : null;
  const dateLabel = date && Number.isFinite(date.getTime())
    ? date.toLocaleDateString()
    : "";
  return `${entry.format || "export"}${dateLabel ? ` ${dateLabel}` : ""}`;
}

function refreshPaperSoon() {
  window.setTimeout(() => refreshPaper().then(loadRecentPapers).catch(() => {}), 900);
}

function scrollToReadingProgress() {
  const paragraphId = state.paper?.readingProgress?.paragraphId;
  if (!paragraphId) {
    return;
  }

  window.setTimeout(() => {
    document.querySelector(`#${CSS.escape(paragraphId)}`)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, 120);
}

function debounce(fn, delay = 250) {
  let timer = null;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
}

async function checkServiceVersion() {
  if (!els.serviceStatusText) {
    return;
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch("/api/health", {
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    renderServiceStatus(getServiceStatus(payload, response.ok));
  } catch {
    renderServiceStatus({
      level: "error",
      title: "服务未连接",
      text: "无法连接 PaperLens 后端。若页面还能显示旧内容，当前只是浏览器里的旧界面。",
      details: [],
      actions: ["npm run dev", "npm run service:status"],
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

function getServiceStatus(payload, responseOk) {
  if (!responseOk || !payload?.ok) {
    return {
      level: "error",
      title: "健康检查失败",
      text: "PaperLens 服务健康检查失败，请查看终端日志或重启服务。",
      details: [],
      actions: ["npm run health", "npm run service:restart"],
    };
  }

  const details = getServiceStatusDetails(payload);

  if (!payload.serviceSchemaVersion) {
    return {
      level: "warn",
      title: "后端仍是旧进程",
      text: "当前页面已更新，但服务未返回版本信息。请重启 PaperLens 服务后刷新页面。",
      details,
      actions: ["npm run service:restart", "或 Ctrl+C 后重新 npm run dev", "刷新页面"],
    };
  }

  if (Number(payload.serviceSchemaVersion) < REQUIRED_SERVICE_SCHEMA_VERSION) {
    return {
      level: "warn",
      title: "后端版本过旧",
      text: `需要 schema ${REQUIRED_SERVICE_SCHEMA_VERSION}，当前是 ${payload.serviceSchemaVersion}。请重启 PaperLens 服务。`,
      details,
      actions: ["npm run service:restart", "或 Ctrl+C 后重新 npm run dev", "刷新页面"],
    };
  }

  if (payload.needsRestart) {
    return {
      level: "warn",
      title: "后端需要重启",
      text: payload.restartReason || "服务源码已更新，但后端仍是旧进程。请重启 PaperLens 服务。",
      details,
      actions: ["npm run service:restart", "或 Ctrl+C 后重新 npm run dev", "刷新页面"],
    };
  }

  if (Number(payload.staticAssetMtimeMs || 0) > CLIENT_LOADED_AT_MS + 1000) {
    return {
      level: "warn",
      title: "前端需要刷新",
      text: "前端文件已更新。请刷新页面，以免新旧界面脚本混用。",
      details,
      actions: ["刷新页面"],
    };
  }

  if (payload.security?.publicRisk) {
    return {
      level: "warn",
      title: "部署未启用访问保护",
      text: payload.security.message || "当前服务可能对外开放，但没有设置访问令牌。",
      details,
      actions: ["设置 PAPERLENS_ACCESS_TOKEN", "重启服务"],
    };
  }

  return {
    level: "ok",
    title: "服务已同步",
    text: `服务已同步 · v${payload.version || "0.0.0"} · 已运行 ${formatDuration(payload.uptimeSeconds || 0)}`,
    details,
    actions: [],
  };
}

function getServiceStatusDetails(payload = {}) {
  const runtime = payload.runtime || {};
  const queue = payload.queue || {};
  const details = [
    {
      label: "后端",
      value: `v${payload.version || "0.0.0"} · schema ${payload.serviceSchemaVersion ?? "旧"}`,
    },
    {
      label: "运行",
      value: `${formatDuration(runtime.uptimeSeconds ?? payload.uptimeSeconds ?? 0)} · PID ${runtime.pid || "?"}`,
    },
    {
      label: "地址",
      value: runtime.host && runtime.port ? `${runtime.host}:${runtime.port}` : "本机服务",
    },
    {
      label: "队列",
      value: formatServiceQueue(queue),
    },
    {
      label: "访问",
      value: formatServiceSecurity(payload.security),
    },
  ];

  if (queue.activeJob) {
    details.push({
      label: "当前",
      value: formatActiveServiceJob(queue.activeJob),
    });
  }

  return details;
}

function formatServiceSecurity(security = {}) {
  if (security.authRequired) {
    return security.authenticated ? "令牌保护" : "需要登录";
  }

  if (security.publicRisk) {
    return "未保护 · 公网风险";
  }

  return "本机开发";
}

function formatServiceQueue(queue = {}) {
  if (!Number.isFinite(Number(queue.savedJobs))) {
    return "等待后端上报";
  }

  const running = Number(queue.runningJobs || 0) + Number(queue.cancelingJobs || 0);
  const queued = Number(queue.queuedJobs || 0);
  const active = Number(queue.activeJobs || 0);
  const items = queue.activeItems || {};
  const itemLabel = Number(items.total || 0)
    ? ` · ${Number(items.done || 0) + Number(items.error || 0)}/${items.total} 项`
    : "";

  if (active > 0) {
    return `${running} 运行 / ${queued} 排队${itemLabel}`;
  }

  return `空闲 · ${Number(queue.savedJobs || 0)} 个历史任务`;
}

function formatActiveServiceJob(job = {}) {
  const done = Number(job.completed || 0) + Number(job.failed || 0);
  const total = Number(job.total || 0);
  const title = job.paperTitle ? `${truncateServiceText(job.paperTitle, 18)} · ` : "";
  return `${title}${getJobStatusText(job.status)} ${done}/${total}`;
}

function truncateServiceText(text, maxLength) {
  const value = String(text || "").trim();
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function renderServiceStatus(status) {
  const visible = Boolean(status.title || status.text);
  els.serviceStatusText.classList.toggle("visible", visible);
  els.serviceStatusText.classList.toggle("ok", status.level === "ok");
  els.serviceStatusText.classList.toggle("warn", status.level === "warn");
  els.serviceStatusText.classList.toggle("error", status.level === "error");
  els.serviceStatusText.replaceChildren();

  if (!visible) {
    return;
  }

  const header = document.createElement("div");
  header.className = "service-status-header";
  const dot = document.createElement("span");
  dot.className = "service-status-dot";
  const title = document.createElement("strong");
  title.textContent = status.title || "服务状态";
  header.append(dot, title);

  const body = document.createElement("p");
  body.className = "service-status-body";
  body.textContent = status.text || "";

  els.serviceStatusText.append(header, body);

  if (status.details?.length) {
    const grid = document.createElement("div");
    grid.className = "service-status-grid";
    for (const detail of status.details) {
      const item = document.createElement("div");
      item.className = "service-status-metric";
      const label = document.createElement("span");
      label.textContent = detail.label;
      const value = document.createElement("strong");
      value.textContent = detail.value;
      item.append(label, value);
      grid.append(item);
    }
    els.serviceStatusText.append(grid);
  }

  if (status.actions?.length) {
    const actions = document.createElement("div");
    actions.className = "service-status-actions";
    for (const action of status.actions) {
      const code = document.createElement("code");
      code.textContent = action;
      actions.append(code);
    }
    els.serviceStatusText.append(actions);
  }
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

  if (isOcrRequiredPaper(state.paper)) {
    setStatus("扫描版 PDF 需要先 OCR，无法直接翻译讲解。", true);
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

async function resumeMissingAnalysis() {
  if (!state.paper || state.autoAnalyze.running || state.pipelineBusy) {
    return;
  }

  if (isOcrRequiredPaper(state.paper)) {
    setStatus("扫描版 PDF 需要先 OCR，无法补跑分析。", true);
    return;
  }

  const missingCount = getMissingAnalysisCount(state.paper);
  if (!missingCount) {
    setStatus("没有失败或未完成段落需要补跑。");
    return;
  }

  await createAnalysisJob({
    statusLabel: `已补跑失败/未完成段落：${missingCount} 段`,
  });
}

function downloadPaperNotes() {
  if (!state.paper) {
    return;
  }

  const link = document.createElement("a");
  link.href = `/api/papers/${encodeURIComponent(state.paper.id)}/export.md`;
  link.download = "";
  document.body.append(link);
  link.click();
  link.remove();
  setStatus("正在下载 Markdown 笔记");
  refreshPaperSoon();
}

function downloadPaperDocx() {
  if (!state.paper) {
    return;
  }

  const link = document.createElement("a");
  link.href = `/api/papers/${encodeURIComponent(state.paper.id)}/export.docx`;
  link.download = "";
  document.body.append(link);
  link.click();
  link.remove();
  setStatus("正在下载 Word 文档");
  refreshPaperSoon();
}

async function rerunFullPipeline() {
  if (!state.paper || state.autoAnalyze.running || state.pipelineBusy) {
    return;
  }

  if (isOcrRequiredPaper(state.paper)) {
    setStatus("扫描版 PDF 需要先 OCR，无法重分段和全跑。", true);
    return;
  }

  if (!ensureModelSettings()) {
    return;
  }

  state.pipelineBusy = true;
  updateAutoButtons();

  try {
    const segmented = await segmentPaperWithAi();
    if (!segmented) {
      setStatus("重新分段失败，未启动重新生成。", true);
      return;
    }

    await createAnalysisJob({
      rerunAll: true,
      statusLabel: "已重新分段并加入后端分析队列",
    });
  } finally {
    state.pipelineBusy = false;
    updateAutoButtons();
  }
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
      pollAnalysisJob().catch(handleAnalysisPollError);
    }, 1800);
  }
  updateAutoStatus();
  updateAutoButtons();
}

function applyAnalysisJob(job) {
  const previousJobId = state.autoAnalyze.jobId;
  const running = isActiveAnalysisJob(job);
  state.autoAnalyze.running = running;
  state.autoAnalyze.stopRequested = Boolean(job.cancelRequested || job.status === "canceling");
  state.autoAnalyze.jobId = job.id;
  state.autoAnalyze.completed = Number(job.completed || 0);
  state.autoAnalyze.failed = Number(job.failed || 0);
  state.autoAnalyze.cacheHits = Number(job.cacheHits || 0);
  state.autoAnalyze.total = Number(job.total || 0);
  state.autoAnalyze.currentId = job.currentParagraphId || "";
  state.autoAnalyze.currentBatchSize = Number(job.currentBatchSize || 0);
  state.autoAnalyze.strategy = job.strategy || null;
  state.autoAnalyze.startedAt = Date.parse(job.startedAt || job.createdAt) || Date.now();
  state.autoAnalyze.lastProgressKey = getJobProgressKey(job);

  if (job.id !== previousJobId || !running) {
    state.autoAnalyze.networkFailures = 0;
  }

  if (!running) {
    clearAutoTimer();
  }
}

function resetAnalysisJobState() {
  clearAutoTimer();
  Object.assign(state.autoAnalyze, {
    running: false,
    stopRequested: false,
    jobId: null,
    completed: 0,
    failed: 0,
    cacheHits: 0,
    total: 0,
    currentId: null,
    currentBatchSize: 0,
    strategy: null,
    startedAt: 0,
    pollInFlight: false,
    lastProgressKey: "",
    networkFailures: 0,
  });
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
    job.currentBatchSize || 0,
    job.updatedAt || "",
  ].join(":");
}

function handleAnalysisPollError(error) {
  if (!error.isNetworkError) {
    setStatus(error.message, true);
    return;
  }

  state.autoAnalyze.networkFailures += 1;
  const count = state.autoAnalyze.networkFailures;
  const countLabel = count > 1 ? `（第 ${count} 次）` : "";
  const offlineLabel = navigator.onLine === false
    ? "浏览器当前处于离线状态"
    : "页面会继续自动重连";

  setStatus(`本机连接暂时中断${countLabel}：后端 Job 会继续保留，${offlineLabel}。`, true);
  updateAutoButtons();
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
    state.autoAnalyze.networkFailures = 0;
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
      resetAnalysisJobState();
      updateAutoButtons();
    } else if (!state.autoAnalyze.running && state.autoAnalyze.jobId) {
      resetAnalysisJobState();
      updateAutoButtons();
    }
  } catch (error) {
    if (state.autoAnalyze.running && error.isNetworkError) {
      handleAnalysisPollError(error);
    } else {
      setStatus(error.message, true);
    }
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
  return paragraph.kind === "paragraph" &&
    paragraph.analysisEligible !== false &&
    !isLikelyNonReadingText(paragraph.sourceText || "", paragraph.sectionTitleHint || "") &&
    (
      paragraph.analysisStatus === "error" ||
      Boolean(paragraph.analysisError) ||
      !hasCompleteAnalysis(paragraph)
    );
}

function hasCompleteAnalysis(paragraph) {
  return Boolean(String(paragraph.translation || "").trim()) &&
    Boolean(String(paragraph.explanation || "").trim());
}

function getMissingAnalysisCount(paper) {
  return getReadingParagraphs(paper).filter((paragraph) => needsAnalysis(paragraph)).length;
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
    els.paperLibraryControls.classList.add("hidden");
    els.paragraphList.innerHTML = "";
    els.outline.innerHTML = "";
    updateAutoButtons();
    return;
  }

  els.emptyState.classList.add("hidden");
  els.paperTitle.textContent = paper.title || paper.filename;
  els.paperMeta.textContent = `${paper.pageCount} 页`;
  const readingParagraphs = getReadingParagraphs(paper);
  const ocrRequired = isOcrRequiredPaper(paper);
  const analyzedCount = readingParagraphs.filter((paragraph) => !needsAnalysis(paragraph)).length;
  const segmentLabels = {
    ai: "AI 分段",
    layout: "版面分段",
    heuristic: "基础分段",
  };
  const segmentLabel = segmentLabels[paper.segmentationMode] || "基础分段";
  const progress = Number(paper.readingProgress?.percent || 0);
  const exportLabel = paper.exportHistory?.length
    ? ` · 最近导出 ${formatExportHistoryLabel(paper.exportHistory[0])}`
    : "";
  els.paperStats.textContent = ocrRequired
    ? `${paper.pageCount || 0} 页 · 需要 OCR · 已生成 ${paper.ocr?.pageImageCount || paper.pageImages?.length || 0} 张页图`
    : `${readingParagraphs.length} 个段落 · 已讲解 ${analyzedCount} · ${progress}% · ${segmentLabel}${exportLabel}`;
  els.paperLibraryControls.classList.remove("hidden");
  els.favoriteButton.textContent = paper.favorite ? "★" : "☆";
  els.favoriteButton.setAttribute("aria-pressed", paper.favorite ? "true" : "false");
  els.tagInput.value = (paper.tags || []).join(", ");
  if (ocrRequired) {
    syncOcrJobFromPaper(paper);
    renderScannedPaper(paper);
  } else {
    resetOcrJobState();
    renderOutline(paper);
    renderParagraphs(paper);
  }
  updateAutoButtons();
}

function isOcrRequiredPaper(paper) {
  return Boolean(paper?.ocr?.needed || paper?.status === "needs_ocr" || paper?.segmentationMode === "ocr-required");
}

function renderScannedPaper(paper) {
  els.outline.replaceChildren();
  const fragment = document.createDocumentFragment();
  fragment.append(renderOcrRequiredNotice(paper));

  const pageImages = Array.isArray(paper.pageImages) ? paper.pageImages : [];
  if (pageImages.length) {
    for (const pageImage of pageImages.slice(0, 12)) {
      fragment.append(renderPagePreview(pageImage, []));
    }
  } else {
    const empty = document.createElement("section");
    empty.className = "ocr-notice";
    const title = document.createElement("h3");
    title.textContent = "没有可显示的页面图";
    const body = document.createElement("p");
    body.textContent = "当前 PDF 没有可提取文本，也没有生成页面截图。请用 OCR 工具生成可搜索 PDF 后重新上传。";
    empty.append(title, body);
    fragment.append(empty);
  }

  els.paragraphList.replaceChildren(fragment);
}

function renderOcrRequiredNotice(paper) {
  const notice = document.createElement("section");
  notice.className = "ocr-notice";

  const title = document.createElement("h3");
  title.textContent = "这篇 PDF 需要 OCR";

  const summary = document.createElement("p");
  const ocr = paper.ocr || {};
  summary.textContent = [
    `已检测到 ${ocr.pageCount || paper.pageCount || 0} 页`,
    `可阅读段落 ${ocr.readableParagraphCount || 0} 个`,
    `可提取字符 ${ocr.textCharacters || 0} 个`,
    `页图 ${ocr.pageImageCount || paper.pageImages?.length || 0} 张`,
    ocr.language ? `语言 ${ocr.language}` : "",
  ].filter(Boolean).join(" · ");

  const jobStatus = document.createElement("div");
  jobStatus.className = "ocr-job-status";
  const jobTitle = document.createElement("strong");
  jobTitle.textContent = getOcrStatusTitle(paper);
  const jobBody = document.createElement("span");
  jobBody.textContent = getOcrStatusBody(paper);
  jobStatus.append(jobTitle, jobBody);

  const actions = document.createElement("div");
  actions.className = "ocr-actions";
  const ocrButton = document.createElement("button");
  ocrButton.className = "primary-button";
  ocrButton.type = "button";
  ocrButton.textContent = state.ocrJob.running ? "OCR 运行中" : "本机 OCR 并重新解析";
  ocrButton.disabled = state.ocrJob.running || state.pipelineBusy || state.autoAnalyze.running;
  ocrButton.addEventListener("click", startOcrJob);
  actions.append(ocrButton);

  if (state.ocrJob.running) {
    const stopButton = document.createElement("button");
    stopButton.className = "secondary-button";
    stopButton.type = "button";
    stopButton.textContent = "停止 OCR";
    stopButton.addEventListener("click", stopOcrJob);
    actions.append(stopButton);
  }

  const steps = document.createElement("ol");
  steps.className = "ocr-steps";
  for (const step of [
    "点击上方按钮后，PaperLens 会调用本机 OCRmyPDF/Tesseract。",
    "OCR 完成后会自动重新提取文本、页面结构和段落。",
    "如果本机缺少工具，可以按下面命令安装后再重试。",
  ]) {
    const item = document.createElement("li");
    item.textContent = step;
    steps.append(item);
  }

  const commands = document.createElement("pre");
  commands.className = "ocr-command";
  commands.textContent = [
    "brew install ocrmypdf tesseract tesseract-lang",
    "PAPERLENS_OCR_LANGUAGE=eng npm run dev",
    "ocrmypdf --skip-text --deskew --rotate-pages -l eng input.pdf output.ocr.pdf",
  ].join("\n");

  const note = document.createElement("p");
  note.textContent = "Docker 镜像会内置 OCRmyPDF、Tesseract 英文和简体中文语言包；中文论文可设置 PAPERLENS_OCR_LANGUAGE=eng+chi_sim。";

  notice.append(title, summary, jobStatus, actions, steps, commands, note);
  return notice;
}

function getOcrStatusTitle(paper) {
  const status = paper.ocr?.status || "";
  if (state.ocrJob.running || status === "queued" || status === "running") {
    return "OCR 任务运行中";
  }
  if (status === "failed") {
    return "上次 OCR 失败";
  }
  return "可在本机自动 OCR";
}

function getOcrStatusBody(paper) {
  const ocr = paper.ocr || {};
  if (state.ocrJob.message && (!ocr.jobId || state.ocrJob.jobId === ocr.jobId)) {
    return state.ocrJob.message;
  }
  if (ocr.error) {
    return normalizeDisplayError(ocr.error);
  }
  return ocr.recommendation || "将扫描版 PDF 转成可搜索 PDF 后，PaperLens 会继续分段和讲解。";
}

async function startOcrJob() {
  if (!state.paper || state.ocrJob.running) {
    return;
  }

  setStatus("正在创建本机 OCR 任务");
  try {
    const response = await apiFetch(`/api/papers/${encodeURIComponent(state.paper.id)}/ocr-jobs`, {
      method: "POST",
    }, "创建 OCR 任务");
    const result = await readResponse(response);
    if (result.paper) {
      state.paper = result.paper;
    }
    if (!result.job) {
      renderPaper();
      setStatus(result.message || "这篇 PDF 不需要 OCR");
      return;
    }

    beginOcrJob(result.job);
    renderPaper();
    setStatus(result.message || "已加入本机 OCR 队列");
  } catch (error) {
    setStatus(error.message, true);
  }
}

function beginOcrJob(job) {
  applyOcrJob(job);
  clearOcrTimer();
  if (state.ocrJob.running) {
    state.ocrJob.timer = window.setInterval(() => {
      pollOcrJob().catch((error) => {
        setStatus(error.message, true);
      });
    }, 1800);
  }
}

function applyOcrJob(job) {
  state.ocrJob.running = isActiveAnalysisJob(job);
  state.ocrJob.jobId = job.id;
  state.ocrJob.status = job.status || "";
  state.ocrJob.message = job.message || getJobStatusText(job.status);
  state.ocrJob.startedAt = Date.parse(job.startedAt || job.createdAt) || Date.now();
  if (!state.ocrJob.running) {
    clearOcrTimer();
  }
}

function syncOcrJobFromPaper(paper) {
  const jobId = paper?.ocr?.jobId || "";
  const status = paper?.ocr?.status || "";
  const active = jobId && (status === "queued" || status === "running");
  if (!active || state.ocrJob.jobId === jobId) {
    return;
  }

  beginOcrJob({
    id: jobId,
    type: "ocr",
    paperId: paper.id,
    paperTitle: paper.title || paper.filename || "",
    status,
    total: 1,
    completed: 0,
    failed: 0,
    message: paper.ocr?.recommendation || "OCR 任务运行中",
    createdAt: paper.ocr?.queuedAt || paper.ocr?.startedAt || new Date().toISOString(),
    startedAt: paper.ocr?.startedAt || "",
    updatedAt: paper.updatedAt || "",
  });
}

async function pollOcrJob() {
  if (!state.ocrJob.jobId || state.ocrJob.pollInFlight) {
    return;
  }

  state.ocrJob.pollInFlight = true;
  try {
    const response = await apiFetch(`/api/jobs/${encodeURIComponent(state.ocrJob.jobId)}`, {}, "查询 OCR 任务");
    const result = await readResponse(response);
    const job = result.job;
    applyOcrJob(job);
    await refreshCurrentPaper();
    loadRecentPapers();

    if (state.ocrJob.running) {
      const elapsed = Math.round((Date.now() - state.ocrJob.startedAt) / 1000);
      setStatus(`${job.message || "OCR 运行中"} · 已用 ${formatDuration(elapsed)}`);
    } else if (job.status === "done") {
      resetOcrJobState({ keepMessage: true });
      setStatus(job.message || "OCR 完成，已重新解析论文");
    } else if (job.status === "canceled") {
      resetOcrJobState();
      setStatus("OCR 任务已停止");
    } else {
      resetOcrJobState({ keepMessage: true });
      setStatus(job.error || job.message || "OCR 失败", true);
    }

    renderPaper();
  } finally {
    state.ocrJob.pollInFlight = false;
  }
}

async function stopOcrJob() {
  if (!state.ocrJob.running || !state.ocrJob.jobId) {
    return;
  }

  setStatus("正在停止 OCR 任务");
  try {
    const response = await apiFetch(`/api/jobs/${encodeURIComponent(state.ocrJob.jobId)}/cancel`, {
      method: "POST",
    }, "停止 OCR 任务");
    const result = await readResponse(response);
    if (result.job) {
      applyOcrJob(result.job);
    }
    await pollOcrJob();
  } catch (error) {
    setStatus(error.message, true);
  }
}

function resetOcrJobState(options = {}) {
  clearOcrTimer();
  Object.assign(state.ocrJob, {
    running: false,
    jobId: null,
    status: "",
    message: options.keepMessage ? state.ocrJob.message : "",
    startedAt: 0,
    pollInFlight: false,
  });
}

function clearOcrTimer() {
  if (state.ocrJob.timer) {
    window.clearInterval(state.ocrJob.timer);
    state.ocrJob.timer = null;
  }
}

function renderOutline(paper) {
  const fragment = document.createDocumentFragment();

  for (const section of paper.sections) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = section.title;
    button.addEventListener("click", () => {
      const paragraph = paper.paragraphs.find((item) => item.sectionId === section.id && isReadingParagraph(paper, item));
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

  const header = document.createElement("div");
  header.className = "page-artifact-header";

  const meta = document.createElement("div");
  meta.className = "page-artifact-meta";
  meta.textContent = artifact.label
    ? `${artifact.label} · ${getArtifactLabel(artifact.type, artifact.visualType)}`
    : getArtifactLabel(artifact.type, artifact.visualType);
  header.append(meta, renderArtifactActions(artifact));

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
    card.append(header, crop, body);
  } else {
    card.append(header, body);
  }

  return card;
}

function renderArtifactActions(artifact) {
  const actions = document.createElement("div");
  actions.className = "page-artifact-actions";

  if (!hasArtifactCrop(artifact)) {
    return actions;
  }

  const viewButton = document.createElement("button");
  viewButton.type = "button";
  viewButton.textContent = "查看";
  viewButton.title = `放大查看${getArtifactLabel(artifact.type, artifact.visualType)}`;
  viewButton.addEventListener("click", () => openArtifactViewer(artifact));

  const locateButton = document.createElement("button");
  locateButton.type = "button";
  locateButton.textContent = "定位";
  locateButton.title = "在整页预览中定位这块内容";
  locateButton.addEventListener("click", () => openArtifactViewer(artifact, { focusLocator: true }));

  const downloadLink = document.createElement("a");
  downloadLink.href = getArtifactCropUrl(artifact, { download: true });
  downloadLink.download = getArtifactDownloadName(artifact);
  downloadLink.textContent = "下载";
  downloadLink.title = "下载裁剪图";

  actions.append(viewButton, locateButton, downloadLink);
  return actions;
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

function hasArtifactCrop(artifact) {
  const crop = artifact?.crop || {};
  return Boolean(
    artifact?.imagePath &&
      Number(crop.width) > 0 &&
      Number(crop.height) > 0 &&
      Number(crop.pageWidth) > 0 &&
      Number(crop.pageHeight) > 0,
  );
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

function openArtifactViewer(artifact, options = {}) {
  if (!hasArtifactCrop(artifact)) {
    focusArtifactCard(artifact?.id);
    return;
  }

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

  const downloadLink = document.createElement("a");
  downloadLink.href = getArtifactCropUrl(artifact, { download: true });
  downloadLink.download = getArtifactDownloadName(artifact);
  downloadLink.textContent = "下载裁剪";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.textContent = "关闭";
  closeButton.addEventListener("click", closeArtifactViewer);

  actions.append(downloadLink, pageLink, closeButton);
  header.append(title, actions);

  const viewerBody = document.createElement("div");
  viewerBody.className = "artifact-viewer-body";

  const cropFrame = document.createElement("div");
  cropFrame.className = "artifact-viewer-crop";
  cropFrame.style.aspectRatio = `${artifact.crop.width} / ${artifact.crop.height}`;
  cropFrame.style.width = `min(100%, 1080px, calc(74vh * ${artifact.crop.width / artifact.crop.height}))`;
  cropFrame.append(renderCropImage(artifact));
  viewerBody.append(cropFrame, renderArtifactLocator(artifact, options));

  const caption = document.createElement(artifact.type === "code" ? "pre" : "p");
  caption.className = "artifact-viewer-caption";
  if (artifact.type === "code") {
    caption.textContent = artifact.text;
  } else {
    renderRichText(caption, artifact.text);
  }

  panel.append(header, viewerBody, caption);
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

function renderArtifactLocator(artifact, options = {}) {
  const crop = artifact.crop;
  const locator = document.createElement("section");
  locator.className = `artifact-viewer-locator${options.focusLocator ? " is-focused" : ""}`;

  const title = document.createElement("div");
  title.className = "artifact-viewer-locator-title";
  title.textContent = artifact.pageNumber ? `第 ${artifact.pageNumber} 页定位` : "整页定位";

  const pageLink = document.createElement("a");
  pageLink.className = "artifact-page-map";
  pageLink.href = artifact.imagePath;
  pageLink.target = "_blank";
  pageLink.rel = "noreferrer";
  pageLink.title = "打开整页图片";

  const pageImage = document.createElement("img");
  pageImage.src = artifact.imagePath;
  pageImage.alt = artifact.pageNumber ? `第 ${artifact.pageNumber} 页整页定位` : "整页定位";
  pageImage.loading = "lazy";
  pageImage.decoding = "async";

  const marker = document.createElement("span");
  marker.className = "artifact-page-marker";
  marker.style.left = `${clampPercent(crop.x / crop.pageWidth * 100)}%`;
  marker.style.top = `${clampPercent(crop.y / crop.pageHeight * 100)}%`;
  marker.style.width = `${clampPercent(crop.width / crop.pageWidth * 100)}%`;
  marker.style.height = `${clampPercent(crop.height / crop.pageHeight * 100)}%`;

  pageLink.append(pageImage, marker);

  const hint = document.createElement("p");
  hint.className = "artifact-viewer-locator-hint";
  hint.textContent = "绿色框是当前裁剪在整页中的位置。";

  locator.append(title, pageLink, hint);
  return locator;
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

function focusArtifactCard(artifactId) {
  if (!artifactId) {
    return;
  }

  const target = document.getElementById(artifactId);
  if (!target) {
    return;
  }

  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.add("is-highlighted");
  window.setTimeout(() => target.classList.remove("is-highlighted"), 1600);
}

function getArtifactCropUrl(artifact, options = {}) {
  if (!state.paper?.id || !artifact?.id || !hasArtifactCrop(artifact)) {
    return "";
  }

  const url = `/api/papers/${encodeURIComponent(state.paper.id)}/artifacts/${encodeURIComponent(artifact.id)}/crop.svg`;
  return options.download ? `${url}?download=1` : url;
}

function getArtifactDownloadName(artifact) {
  const label = artifact?.label || artifact?.visualType || artifact?.type || "paperlens-crop";
  return `${sanitizeClientFilename(label)}.svg`;
}

function sanitizeClientFilename(value) {
  return String(value || "paperlens-crop")
    .trim()
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "paperlens-crop";
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(0, Math.min(100, number));
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
  return paper.paragraphs.filter((paragraph) => isReadingParagraph(paper, paragraph));
}

function isReadingParagraph(paper, paragraph) {
  if (!paragraph || paragraph.kind !== "paragraph" || paragraph.analysisEligible === false) {
    return false;
  }

  const section = paper?.sections?.find((item) => item.id === paragraph.sectionId);
  return !isLikelyNonReadingText(paragraph.sourceText || "", section?.title || paragraph.sectionTitleHint || "");
}

function isLikelyNonReadingText(text, sectionTitle = "") {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) {
    return true;
  }

  if (/^(references|bibliography|参考文献)$/i.test(String(sectionTitle || "").trim())) {
    return true;
  }

  if (/^(?:figure|fig\.|table)\s+\d+[a-z]?\s*[:.]/i.test(clean)) {
    return true;
  }

  const emails = clean.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  if ((emails.length >= 2 && clean.length < 520) || /^\{[^}]+}\s*@/i.test(clean)) {
    return true;
  }

  if (/\b(?:author names are listed|equal contribution|corresponding author|correspondence to|ACM Reference Format|Copyright held by|Proceedings of|ISBN|ISSN|https:\/\/doi\.org|Creative Commons|©)\b/i.test(clean)) {
    return true;
  }

  const urls = clean.match(/(?:https?:\/\/|www\.)\S+/gi) || [];
  if (urls.length) {
    const stripped = clean
      .replace(/(?:https?:\/\/|www\.)\S+/gi, " ")
      .replace(/\b\d+\b/g, " ")
      .replace(/[^A-Za-z\u4e00-\u9fff]+/g, " ")
      .trim();
    const wordCount = stripped ? stripped.split(/\s+/).length : 0;
    if (clean.length < 260 && (wordCount <= 10 || urls.join("").length / Math.max(1, clean.length) > 0.35)) {
      return true;
    }
  }

  return /^\[\d+\]\s+/.test(clean);
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
    const chip = document.createElement("span");
    chip.className = "artifact-chip";

    const previewButton = document.createElement("button");
    previewButton.className = "artifact-link";
    previewButton.type = "button";
    previewButton.textContent = artifact.label || getArtifactLabel(artifact.type, artifact.visualType);
    previewButton.title = "打开裁剪预览";
    previewButton.addEventListener("click", () => openArtifactViewer(artifact));

    const jumpLink = document.createElement("a");
    jumpLink.className = "artifact-jump";
    jumpLink.href = `#${artifact.id}`;
    jumpLink.textContent = "定位";
    jumpLink.addEventListener("click", (event) => {
      event.preventDefault();
      focusArtifactCard(artifact.id);
    });

    chip.append(previewButton, jumpLink);
    row.append(chip);
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
      fragment.append(createMarkdownInlineFragment(segment.text));
      continue;
    }

    fragment.append(renderMathSegment(segment.text, segment.display));
  }

  return fragment;
}

function createMarkdownInlineFragment(text) {
  const fragment = document.createDocumentFragment();
  let index = 0;

  while (index < text.length) {
    const marker = findNextMarkdownMarker(text, index);
    if (!marker) {
      fragment.append(document.createTextNode(text.slice(index)));
      break;
    }

    if (marker.start > index) {
      fragment.append(document.createTextNode(text.slice(index, marker.start)));
    }

    const close = findMarkdownClose(text, marker);
    if (close === -1) {
      fragment.append(document.createTextNode(text.slice(marker.start, marker.start + marker.open.length)));
      index = marker.start + marker.open.length;
      continue;
    }

    const content = text.slice(marker.start + marker.open.length, close);
    const element = document.createElement(marker.tag);
    element.className = marker.className;
    if (marker.tag === "code") {
      element.textContent = content;
    } else {
      element.append(createMarkdownInlineFragment(content));
    }
    fragment.append(element);
    index = close + marker.close.length;
  }

  return fragment;
}

function findNextMarkdownMarker(text, fromIndex) {
  const markers = [
    { open: "`", close: "`", tag: "code", className: "markdown-code" },
    { open: "**", close: "**", tag: "strong", className: "markdown-strong" },
    { open: "__", close: "__", tag: "strong", className: "markdown-strong" },
    { open: "*", close: "*", tag: "em", className: "markdown-em" },
    { open: "_", close: "_", tag: "em", className: "markdown-em" },
  ];
  let best = null;

  for (const marker of markers) {
    let start = text.indexOf(marker.open, fromIndex);
    while (start !== -1 && !isLikelyMarkdownOpen(text, start, marker)) {
      start = text.indexOf(marker.open, start + marker.open.length);
    }

    if (start === -1) {
      continue;
    }

    if (!best || start < best.start || (start === best.start && marker.open.length > best.open.length)) {
      best = { ...marker, start };
    }
  }

  return best;
}

function isLikelyMarkdownOpen(text, start, marker) {
  if (isEscapedAt(text, start)) {
    return false;
  }

  const previous = text[start - 1] || "";
  const next = text[start + marker.open.length] || "";
  if (!next || /\s/.test(next)) {
    return false;
  }

  if ((marker.open === "*" || marker.open === "_") && text[start + 1] === marker.open) {
    return false;
  }

  if (marker.open.includes("_") && previous && /[A-Za-z0-9]/.test(previous)) {
    return false;
  }

  return true;
}

function findMarkdownClose(text, marker) {
  let close = text.indexOf(marker.close, marker.start + marker.open.length);
  while (close !== -1) {
    if (!isEscapedAt(text, close) && isLikelyMarkdownClose(text, close, marker)) {
      return close;
    }
    close = text.indexOf(marker.close, close + marker.close.length);
  }
  return -1;
}

function isLikelyMarkdownClose(text, close, marker) {
  const previous = text[close - 1] || "";
  const next = text[close + marker.close.length] || "";
  if (!previous || /\s/.test(previous)) {
    return false;
  }

  if (marker.close.includes("_") && next && /[A-Za-z0-9]/.test(next)) {
    return false;
  }

  return true;
}

function splitMathSegments(text) {
  const segments = [];
  let index = 0;

  while (index < text.length) {
    const next = findNextMathDelimiter(text, index);
    if (!next) {
      pushTextSegment(segments, text.slice(index));
      break;
    }

    if (next.start > index) {
      pushTextSegment(segments, text.slice(index, next.start));
    }

    const contentStart = next.start + next.open.length;
    const close = findClosingMathDelimiter(text, next, contentStart);
    if (close === -1) {
      pushTextSegment(segments, text.slice(next.start, contentStart));
      index = contentStart;
      continue;
    }

    const source = text.slice(contentStart, close).trim();
    if (!isRenderableMathSource(source, next.display)) {
      pushTextSegment(segments, text.slice(next.start, close + next.close.length));
      index = close + next.close.length;
      continue;
    }

    segments.push({
      math: true,
      display: next.display,
      text: source,
    });
    index = close + next.close.length;
  }

  return segments;
}

function pushTextSegment(segments, text) {
  if (!text) {
    return;
  }

  const previous = segments.at(-1);
  if (previous && !previous.math) {
    previous.text += text;
  } else {
    segments.push({ math: false, text });
  }
}

function hasMathDelimiters(text) {
  const source = String(text || "");
  return /\$\$|\\\(|\\\[|\\begin\{[^}]+}/.test(source) || /(^|[^\\])\$[^$\s\d]/.test(source);
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
    let start = findNextDelimiterOpen(text, delimiter, fromIndex);
    while (start !== -1 && delimiter.open === "$" && !isLikelyInlineDollar(text, start)) {
      start = findNextDelimiterOpen(text, delimiter, start + delimiter.open.length);
    }

    if (start === -1) {
      continue;
    }

    if (!best || start < best.start || (start === best.start && delimiter.open.length > best.open.length)) {
      best = { ...delimiter, start };
    }
  }

  return best;
}

function findNextDelimiterOpen(text, delimiter, fromIndex) {
  let start = text.indexOf(delimiter.open, fromIndex);
  while (start !== -1 && isEscapedAt(text, start)) {
    start = text.indexOf(delimiter.open, start + delimiter.open.length);
  }
  return start;
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

  if (previous && /[A-Za-z0-9\\]/.test(previous)) {
    return false;
  }

  return true;
}

function findClosingMathDelimiter(text, delimiter, fromIndex) {
  let index = text.indexOf(delimiter.close, fromIndex);
  while (index !== -1) {
    if (isEscapedAt(text, index)) {
      index = text.indexOf(delimiter.close, index + delimiter.close.length);
      continue;
    }

    if (delimiter.open === "$" && !isLikelyClosingInlineDollar(text, index)) {
      index = text.indexOf(delimiter.close, index + delimiter.close.length);
      continue;
    }

    return index;
  }

  return -1;
}

function isLikelyClosingInlineDollar(text, index) {
  const previous = text[index - 1] || "";
  const next = text[index + 1] || "";
  if (!previous || /\s/.test(previous)) {
    return false;
  }

  return !next || !/[A-Za-z0-9]/.test(next);
}

function isEscapedAt(text, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function isRenderableMathSource(source, display = false) {
  const clean = String(source || "").trim();
  if (!clean || clean.length > 1800) {
    return false;
  }

  if (display) {
    return true;
  }

  if (/^\d+(?:[.,]\d+)?$/.test(clean)) {
    return false;
  }

  return /\\[A-Za-z]+|[_^{}=<>≤≥≠≈∑∏∫√∞→←↔±×÷∂λμσγαβθΩΔ]|\b(?:argmin|argmax|softmax|log|exp|min|max|sum|prod)\b/i.test(clean) ||
    /^[A-Za-z][A-Za-z0-9]*(?:[_^][A-Za-z0-9{}]+)+$/.test(clean);
}

function renderMathSegment(source, display = false) {
  const wrapper = document.createElement("span");
  wrapper.className = display ? "math-block" : "math-inline";
  wrapper.title = source;
  try {
    renderLatexInto(wrapper, source);
  } catch {
    wrapper.textContent = source;
    wrapper.classList.add("math-raw");
  }
  return wrapper;
}

function renderLatexInto(container, source) {
  const stream = { source: normalizeLatexSource(source), index: 0 };
  renderLatexStream(stream, container, "");
}

function normalizeLatexSource(source) {
  return String(source || "")
    .replace(/\\begin\{[^}]+}/g, " ")
    .replace(/\\end\{[^}]+}/g, " ")
    .replace(/\\left/g, "")
    .replace(/\\right/g, "")
    .replace(/\\\\/g, " ")
    .replace(/\\qquad/g, "  ")
    .replace(/\\quad/g, " ")
    .replace(/\\:/g, " ")
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

  if (command === "overline" || command === "underline") {
    const token = document.createElement("span");
    token.className = `math-token math-${command}`;
    renderLatexInto(token, readLatexArgument(stream));
    return token;
  }

  if (LATEX_ACCENTS[command]) {
    const token = document.createElement("span");
    token.className = "math-token math-accent";
    token.dataset.accent = LATEX_ACCENTS[command];
    const body = document.createElement("span");
    renderLatexInto(body, readLatexArgument(stream));
    token.append(body);
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
    "|": "|",
  };
  return symbols[char] || "";
}

const LATEX_ACCENTS = {
  bar: "¯",
  dot: "·",
  hat: "^",
  tilde: "~",
  vec: "→",
};

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
  div: "÷",
  cdot: "·",
  cdots: "⋯",
  ldots: "…",
  dots: "…",
  pm: "±",
  mp: "∓",
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  leftrightarrow: "↔",
  Rightarrow: "⇒",
  Leftarrow: "⇐",
  Leftrightarrow: "⇔",
  infty: "∞",
  sum: "∑",
  prod: "∏",
  int: "∫",
  partial: "∂",
  nabla: "∇",
  propto: "∝",
  forall: "∀",
  exists: "∃",
  in: "∈",
  notin: "∉",
  subset: "⊂",
  subseteq: "⊆",
  supset: "⊃",
  supseteq: "⊇",
  cup: "∪",
  cap: "∩",
  setminus: "∖",
  emptyset: "∅",
  varnothing: "∅",
  land: "∧",
  lor: "∨",
  wedge: "∧",
  vee: "∨",
  equiv: "≡",
  cong: "≅",
  simeq: "≃",
  circ: "∘",
  degree: "°",
  lbrace: "{",
  rbrace: "}",
  langle: "⟨",
  rangle: "⟩",
  log: "log",
  exp: "exp",
  sin: "sin",
  cos: "cos",
  tan: "tan",
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

function renderAnalysisDashboard() {
  if (!els.analysisDashboard) {
    return;
  }

  const strategy = getVisibleAnalysisStrategy();
  const hasPaper = Boolean(state.paper);
  const activeOrKnownJob = Boolean(state.autoAnalyze.jobId && state.autoAnalyze.total);
  const targetCount = activeOrKnownJob
    ? Math.max(0, state.autoAnalyze.total - state.autoAnalyze.completed - state.autoAnalyze.failed)
    : hasPaper ? getMissingAnalysisCount(state.paper) : 0;
  const totalCount = activeOrKnownJob
    ? state.autoAnalyze.total
    : hasPaper ? getReadingParagraphs(state.paper).length : 0;
  const doneCount = activeOrKnownJob
    ? state.autoAnalyze.completed + state.autoAnalyze.failed
    : hasPaper ? totalCount - targetCount : 0;
  const cacheLabel = activeOrKnownJob
    ? `${state.autoAnalyze.cacheHits || 0}`
    : "待统计";
  const estimateSeconds = activeOrKnownJob && strategy.estimatedRemainingSeconds != null
    ? Number(strategy.estimatedRemainingSeconds)
    : estimateAnalysisSeconds(targetCount, strategy);
  const progressLabel = activeOrKnownJob
    ? `${doneCount}/${state.autoAnalyze.total}`
    : hasPaper ? `${targetCount} 待处理` : "未载入";
  const profile = normalizeAnalysisProfile(strategy.profile || state.analysisProfile);
  const fragment = document.createDocumentFragment();

  const header = document.createElement("div");
  header.className = "analysis-dashboard-header";
  const title = document.createElement("strong");
  title.textContent = "速度与质量";
  const summary = document.createElement("span");
  summary.textContent = getAnalysisDashboardSummary(profile, strategy, targetCount, estimateSeconds);
  header.append(title, summary);
  fragment.append(header);

  const grid = document.createElement("div");
  grid.className = "analysis-dashboard-grid";
  for (const item of [
    { label: "模式", value: ANALYSIS_PROFILE_LABELS[profile] || "精读" },
    { label: "预计", value: targetCount ? formatDuration(estimateSeconds) : "0s" },
    { label: "批次", value: `${strategy.effectiveBatchSize || strategy.batchSize || 1}` },
    { label: "并发", value: `${strategy.concurrency || 1}` },
    { label: "缓存", value: cacheLabel },
    { label: "失败补跑", value: `${strategy.failedRetryBatchSize || 1}/批` },
    { label: "进度", value: progressLabel },
    { label: "策略", value: strategy.label || strategy.name || "默认" },
  ]) {
    const metric = document.createElement("div");
    metric.className = "analysis-dashboard-metric";
    const label = document.createElement("span");
    label.textContent = item.label;
    const value = document.createElement("strong");
    value.textContent = item.value;
    metric.append(label, value);
    grid.append(metric);
  }
  fragment.append(grid);

  els.analysisDashboard.replaceChildren(fragment);
}

function getVisibleAnalysisStrategy() {
  if (state.autoAnalyze.strategy) {
    return normalizeStrategySnapshot(state.autoAnalyze.strategy);
  }

  return getClientAnalysisStrategy(getSettings(), state.paper);
}

function normalizeStrategySnapshot(strategy = {}) {
  return {
    name: strategy.name || "openai-compatible",
    label: strategy.label || strategy.name || "默认",
    profile: normalizeAnalysisProfile(strategy.profile || state.analysisProfile),
    batchSize: Number(strategy.batchSize || strategy.effectiveBatchSize || 1),
    effectiveBatchSize: Number(strategy.effectiveBatchSize || strategy.batchSize || 1),
    concurrency: Number(strategy.concurrency || 1),
    failedRetryBatchSize: Number(strategy.failedRetryBatchSize || 1),
    expectedBatchSeconds: Number(strategy.expectedBatchSeconds || 45),
    estimatedRemainingSeconds: Number.isFinite(Number(strategy.estimatedRemainingSeconds))
      ? Number(strategy.estimatedRemainingSeconds)
      : null,
  };
}

function getClientAnalysisStrategy(settings, paper) {
  const provider = String(settings.provider || "").toLowerCase();
  const baseUrl = String(settings.baseUrl || "").toLowerCase();
  const model = String(settings.model || "").toLowerCase();
  const agentLike = provider.startsWith("claude") || baseUrl.startsWith("local:claude");
  const deepseekLike = provider.includes("deepseek") || baseUrl.includes("deepseek") || model.includes("deepseek");
  const kimiDirectLike = provider.includes("kimi") || baseUrl.includes("moonshot") || baseUrl.includes("api.kimi.com");
  const profile = normalizeAnalysisProfile(settings.analysisProfile);
  const base = agentLike
    ? CLIENT_ANALYSIS_DEFAULTS["claude-agent"]
    : deepseekLike
      ? CLIENT_ANALYSIS_DEFAULTS.deepseek
      : kimiDirectLike
        ? CLIENT_ANALYSIS_DEFAULTS["kimi-direct"]
        : CLIENT_ANALYSIS_DEFAULTS.general;
  const strategy = {
    ...base,
    name: agentLike ? "claude-agent" : deepseekLike ? "deepseek" : kimiDirectLike ? "kimi-direct" : "openai-compatible",
    profile,
    targetMinutes: profile === "fast" ? 12 : 20,
  };

  applyAnalysisProfileToClientStrategy(strategy);
  const remaining = paper ? getMissingAnalysisCount(paper) : 0;
  strategy.effectiveBatchSize = getClientEffectiveBatchSize(strategy, remaining);
  strategy.label = getAnalysisStrategyLabel(strategy);
  return strategy;
}

function applyAnalysisProfileToClientStrategy(strategy) {
  if (strategy.profile !== "fast") {
    return;
  }

  strategy.batchSize = Math.min(strategy.maxBatchSize, Math.max(strategy.batchSize + 2, Math.ceil(strategy.batchSize * 1.35)));
  strategy.concurrency = Math.min(strategy.name === "claude-agent" ? 3 : 5, strategy.concurrency + 1);
  strategy.expectedBatchSeconds = Math.max(24, Math.round(strategy.expectedBatchSeconds * 0.82));
  strategy.failedRetryBatchSize = Math.min(8, strategy.failedRetryBatchSize + 1);
}

function getClientEffectiveBatchSize(strategy, remaining) {
  if (!remaining || remaining <= strategy.batchSize) {
    return strategy.batchSize;
  }

  const targetBatchCount = Math.max(1, Math.floor((strategy.targetMinutes * 60) / strategy.expectedBatchSeconds));
  const neededForTarget = Math.ceil(remaining / targetBatchCount);
  return Math.trunc(clampNumber(Math.max(strategy.batchSize, neededForTarget), 1, strategy.maxBatchSize));
}

function estimateAnalysisSeconds(remaining, strategy) {
  if (!remaining) {
    return 0;
  }

  const batchSize = Math.max(1, Number(strategy.effectiveBatchSize || strategy.batchSize || 1));
  const concurrency = Math.max(1, Number(strategy.concurrency || 1));
  const batchCount = Math.ceil(remaining / batchSize);
  return Math.max(1, Math.ceil(batchCount / concurrency)) * Number(strategy.expectedBatchSeconds || 45);
}

function getAnalysisDashboardSummary(profile, strategy, targetCount, estimateSeconds) {
  if (!targetCount) {
    return state.paper ? "当前没有待分析段落" : "载入论文后显示预计耗时和队列策略";
  }

  const profileLabel = profile === "fast" ? "吞吐优先" : "质量优先";
  return `${profileLabel} · ${targetCount} 段 · 约 ${formatDuration(estimateSeconds)} · ${strategy.concurrency || 1} 并发`;
}

function getAnalysisStrategyLabel(strategy = {}) {
  const providerLabel = {
    "claude-agent": "Claude Agent",
    deepseek: "DeepSeek",
    "kimi-direct": "Kimi Direct",
    "openai-compatible": "OpenAI兼容",
  }[strategy.name] || strategy.name || "默认";
  return `${providerLabel}/${ANALYSIS_PROFILE_LABELS[normalizeAnalysisProfile(strategy.profile)]}`;
}

function formatDuration(seconds) {
  const value = Math.max(0, Math.round(Number(seconds || 0)));
  if (value < 60) {
    return `${value}s`;
  }

  const minutes = Math.floor(value / 60);
  const rest = value % 60;
  if (minutes < 60) {
    return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const minuteRest = minutes % 60;
  return minuteRest ? `${hours}h ${minuteRest}m` : `${hours}h`;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

function updateAutoStatus() {
  if (!state.autoAnalyze.running) {
    return;
  }

  const elapsed = Math.max(0, Math.round((Date.now() - state.autoAnalyze.startedAt) / 1000));
  const current = state.paper?.paragraphs.find((paragraph) => paragraph.id === state.autoAnalyze.currentId);
  const currentLabel = current ? `，当前 P${current.order + 1}` : "";
  const batchLabel = state.autoAnalyze.currentBatchSize > 1 ? `，运行中 ${state.autoAnalyze.currentBatchSize} 段` : "";
  const cacheLabel = state.autoAnalyze.cacheHits > 0 ? ` · 缓存 ${state.autoAnalyze.cacheHits}` : "";
  const stopLabel = state.autoAnalyze.stopRequested ? "，正在停止" : "";
  setStatus([
    `后端分析 ${state.autoAnalyze.completed + state.autoAnalyze.failed}/${state.autoAnalyze.total}`,
    `失败 ${state.autoAnalyze.failed}`,
    `已用 ${elapsed}s${currentLabel}${batchLabel}${stopLabel}${cacheLabel}`,
  ].join(" · "), state.autoAnalyze.failed > 0);
}

function updateAutoButtons() {
  const busy = state.autoAnalyze.running || state.pipelineBusy || state.maintenanceBusy || state.ocrJob.running;
  const ocrRequired = isOcrRequiredPaper(state.paper);
  const missingCount = state.paper ? getMissingAnalysisCount(state.paper) : 0;
  els.qualityProfileButton.disabled = busy;
  els.fastProfileButton.disabled = busy;
  els.autoAnalyzeButton.disabled = !state.paper || busy || ocrRequired;
  els.resumeAnalyzeButton.disabled = !state.paper || busy || ocrRequired || missingCount === 0;
  els.resumeAnalyzeButton.textContent = missingCount
    ? `补跑未完成 ${missingCount}`
    : "补跑未完成";
  els.downloadNotesButton.disabled = !state.paper;
  els.downloadDocxButton.disabled = !state.paper;
  els.rerunAnalyzeButton.disabled = !state.paper || busy || ocrRequired;
  els.rebuildVisualButton.disabled = !state.paper || busy;
  els.rebuildVisualButton.textContent = state.maintenanceBusy ? "重建中" : "重建图表";
  els.rebuildAllVisualButton.disabled = busy;
  els.rebuildAllVisualButton.textContent = state.maintenanceBusy ? "批量重建中" : "重建全部图表";
  els.stopAutoButton.classList.toggle("hidden", !state.autoAnalyze.running);
  els.stopAutoButton.disabled = !state.autoAnalyze.running || state.autoAnalyze.stopRequested;
  renderAnalysisDashboard();
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
  els.rebuildAllVisualButton.disabled = isBusy || state.maintenanceBusy;
  els.rebuildVisualButton.disabled = isBusy || state.maintenanceBusy || !state.paper;
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
    const activeJobHint = state.autoAnalyze.running
      ? "后端分析任务仍保存在本机队列，页面恢复连接后会自动同步。"
      : "";
    const message = error.name === "AbortError"
      ? signal?.aborted
        ? `${label}已停止。`
        : `${label}超时。模型可能仍在处理，或本机服务暂时无响应。${activeJobHint}`
      : `${label}失败：无法连接 PaperLens 本机服务。${activeJobHint}请确认服务仍在运行，或刷新页面后重试。`;
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
    if (response.status === 401) {
      handleUnauthorizedResponse(data);
    }
    throw new Error(data.error || `Request failed with ${response.status}`);
  }

  return data;
}
