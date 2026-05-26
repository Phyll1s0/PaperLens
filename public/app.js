const state = {
  paper: null,
  query: "",
  busyParagraphId: null,
};

const els = {
  providerSelect: document.querySelector("#providerSelect"),
  baseUrlInput: document.querySelector("#baseUrlInput"),
  modelInput: document.querySelector("#modelInput"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  modelStatusText: document.querySelector("#modelStatusText"),
  modelDiagnosticsText: document.querySelector("#modelDiagnosticsText"),
  providerHintText: document.querySelector("#providerHintText"),
  pdfInput: document.querySelector("#pdfInput"),
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
  pingButton: document.querySelector("#pingButton"),
};

const PROVIDERS = {
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    hint: "DeepSeek OpenAI-compatible API。可改用 deepseek-v4-pro 获得更强模型。",
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

function bindEvents() {
  els.uploadButton.addEventListener("click", uploadPdf);
  els.pingButton.addEventListener("click", pingModel);
  els.providerSelect.addEventListener("change", () => {
    applyProvider(els.providerSelect.value);
    saveSettings();
  });
  els.searchInput.addEventListener("input", () => {
    state.query = els.searchInput.value.trim().toLowerCase();
    renderPaper();
  });

  for (const input of [els.baseUrlInput, els.modelInput, els.apiKeyInput]) {
    input.addEventListener("input", () => {
      saveSettings();
      updateModelDiagnostics();
    });
  }
}

function loadSettings() {
  const provider = sessionStorage.getItem("paper-reader-provider") || "deepseek";
  els.providerSelect.value = provider;
  applyProvider(provider);
  els.baseUrlInput.value = sessionStorage.getItem("paper-reader-base-url") || els.baseUrlInput.value;
  els.modelInput.value = sessionStorage.getItem("paper-reader-model") || els.modelInput.value;
  els.apiKeyInput.value = sessionStorage.getItem("paper-reader-api-key") || "";
}

function saveSettings() {
  sessionStorage.setItem("paper-reader-provider", els.providerSelect.value);
  sessionStorage.setItem("paper-reader-base-url", els.baseUrlInput.value.trim());
  sessionStorage.setItem("paper-reader-model", els.modelInput.value.trim());
  sessionStorage.setItem("paper-reader-api-key", els.apiKeyInput.value.trim());
}

function getSettings() {
  return {
    baseUrl: els.baseUrlInput.value.trim(),
    model: normalizeModelNameInput(els.modelInput.value),
    apiKey: normalizeApiKeyInput(els.apiKeyInput.value),
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
    endpoint,
    model: settings.model,
    keyPresent: Boolean(settings.apiKey),
    keyPrefix,
    keyLength,
  };

  els.modelDiagnosticsText.textContent = [
    `Endpoint: ${diagnostics.endpoint}`,
    `Model: ${diagnostics.model}`,
    `Key: ${diagnostics.keyPresent ? `${diagnostics.keyPrefix}, ${diagnostics.keyLength} chars` : "missing"}`,
  ].join(" · ");
}

function getChatEndpoint(baseUrl) {
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
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
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

async function analyzeParagraph(paragraphId) {
  if (!ensureModelSettings()) {
    return;
  }

  state.busyParagraphId = paragraphId;
  renderPaper();

  try {
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
    replaceParagraph(result.paragraph);
    setStatus("分析完成");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    state.busyParagraphId = null;
    renderPaper();
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

function ensureModelSettings() {
  const { apiKey, model } = getSettings();
  if (!apiKey) {
    setStatus("请输入 API Key", true);
    return false;
  }

  if (!model) {
    setStatus("请输入模型名称", true);
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

function renderPaper() {
  const paper = state.paper;

  if (!paper) {
    els.emptyState.classList.remove("hidden");
    els.paragraphList.innerHTML = "";
    els.outline.innerHTML = "";
    return;
  }

  els.emptyState.classList.add("hidden");
  els.paperTitle.textContent = paper.title || paper.filename;
  els.paperMeta.textContent = `${paper.pageCount} 页`;
  els.paperStats.textContent = `${getReadingParagraphs(paper).length} 个段落`;
  renderOutline(paper);
  renderParagraphs(paper);
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

  for (const paragraph of paragraphs) {
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

  const kicker = document.createElement("div");
  kicker.className = "paragraph-kicker";
  kicker.textContent = `P${paragraph.order + 1} · 第 ${paragraph.pageNumber} 页`;

  const analyzeButton = document.createElement("button");
  analyzeButton.className = "secondary-button";
  analyzeButton.type = "button";
  analyzeButton.textContent = state.busyParagraphId === paragraph.id ? "处理中" : "翻译与讲解";
  analyzeButton.disabled = Boolean(state.busyParagraphId);
  analyzeButton.addEventListener("click", () => analyzeParagraph(paragraph.id));

  header.append(kicker, analyzeButton);

  const content = document.createElement("div");
  content.className = "paragraph-content";

  const source = document.createElement("p");
  source.className = "source-text";
  source.textContent = paragraph.sourceText;
  content.append(source);

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

function setBusy(isBusy) {
  els.uploadButton.disabled = isBusy;
  els.pdfInput.disabled = isBusy;
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
