import path from "node:path";
import { getChatCompletionsEndpoint } from "./openai-compatible-provider.js";

const DEFAULT_KIMI_CODE_ANTHROPIC_ENDPOINT = "https://api.kimi.com/coding/v1/messages";

export function buildModelDiagnosticReport(settings = {}, options = {}) {
  const provider = String(settings.provider || "").trim() || "custom";
  const rawBaseUrl = String(settings.baseUrl || "https://api.openai.com/v1").trim();
  const baseUrl = resolveBaseUrlForProvider(provider, rawBaseUrl);
  const model = normalizeModelName(String(settings.model || "").trim());
  const apiKey = normalizeApiKey(String(settings.apiKey || ""));
  const apiKeyRef = String(settings.apiKeyRef || "").trim();
  const savedKey = options.savedKey || null;
  const environmentKey = options.environmentKey?.configured ? options.environmentKey : null;
  const diagnostics = options.diagnostics || {};
  const safeDiagnostics = sanitizeDiagnosticPayload(diagnostics);
  const usesKimiCodeDirect = options.usesKimiCodeDirect ?? baseUrl === "local:claude-kimi";
  const isClaudeProvider = baseUrl === "local:claude-config" || (baseUrl === "local:claude-kimi" && !usesKimiCodeDirect);
  const commandPath = String(options.commandPath || "");
  const keyRefMatches = options.keyRefMatches ?? (savedKey
    ? savedKey.provider === provider && savedKey.baseUrl === baseUrl
    : false);
  const kimiCodeAnthropicEndpoint = options.kimiCodeAnthropicEndpoint || DEFAULT_KIMI_CODE_ANTHROPIC_ENDPOINT;
  const keyPrefix = apiKey
    ? getApiKeyPrefix(apiKey)
    : savedKey?.keyPrefix || environmentKey?.keyPrefix || "missing";
  const keyLength = apiKey
    ? apiKey.length
    : savedKey?.keyLength || environmentKey?.keyLength || 0;
  const expectedPrefix = getExpectedPrefixForDiagnostic(baseUrl, environmentKey);
  const report = {
    generatedAt: options.generatedAt || new Date().toISOString(),
    paperLens: buildPaperLensBlock(options),
    runtime: buildRuntimeBlock(options),
    provider: {
      provider,
      rawBaseUrl: rawBaseUrl ? redactUrl(rawBaseUrl) : "",
      resolvedBaseUrl: redactUrl(baseUrl),
      endpoint: safeDiagnostics.endpoint || resolveDiagnosticEndpoint(baseUrl, usesKimiCodeDirect, kimiCodeAnthropicEndpoint),
      model,
      analysisProfile: normalizeAnalysisProfile(settings.analysisProfile),
    },
    key: {
      present: Boolean(apiKey || savedKey || environmentKey),
      saved: Boolean(savedKey && !apiKey),
      source: apiKey ? "page" : savedKey ? "server-ref" : environmentKey ? "env" : "missing",
      refPresent: Boolean(apiKeyRef),
      refMatchesProvider: apiKeyRef ? keyRefMatches : null,
      prefix: keyPrefix,
      length: keyLength,
      formatOk: typeof safeDiagnostics.keyFormatOk === "boolean"
        ? safeDiagnostics.keyFormatOk
        : isDiagnosticKeyFormatOk({ apiKey, keyPrefix, expectedPrefix }),
      expectedPrefix,
    },
    claude: buildClaudeDiagnosticBlock(settings, safeDiagnostics, commandPath, isClaudeProvider),
    proxy: buildProxyDiagnosticBlock(settings, safeDiagnostics, options.env || {}),
    budget: {
      cliMaxBudgetUsd: Number(settings.agentBudgetUsd || 500),
      note: isClaudeProvider
        ? "Claude Code CLI 会收到 --max-budget-usd；如果错误仍提示旧预算，通常是 CLI 读取了其他认证/配置或供应商账户预算。"
        : usesKimiCodeDirect
          ? "Kimi Code Direct 走 HTTP Anthropic 协议，不使用 Claude Code CLI 的 --max-budget-usd。"
          : "普通 OpenAI-compatible Provider 不使用 Claude Code CLI 的 --max-budget-usd。",
    },
    diagnostics: safeDiagnostics,
  };
  report.recommendations = buildModelDiagnosticRecommendations(report);
  return report;
}

function sanitizeDiagnosticPayload(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeDiagnosticPayload);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeDiagnosticPayload(item)]));
  }

  if (typeof value === "string") {
    return redactSecretText(value);
  }

  return value;
}

function redactSecretText(value) {
  return redactUrl(value)
    .replace(/\bBearer\s+[A-Za-z0-9._-]{8,}/g, "Bearer [redacted-api-key]")
    .replace(/\bsk-[A-Za-z0-9._-]{8,}/g, "[redacted-api-key]");
}

function buildPaperLensBlock(options = {}) {
  return {
    version: options.packageVersion || "0.0.0",
    serviceSchemaVersion: Number(options.serviceSchemaVersion || 0),
    serviceStartedAt: options.serviceStartedAt || "",
  };
}

function buildRuntimeBlock(options = {}) {
  const runtime = options.runtime || {};
  return {
    isDocker: Boolean(runtime.isDocker),
    platform: runtime.platform || "",
    arch: runtime.arch || "",
    nodeVersion: runtime.nodeVersion || "",
    host: runtime.host || "",
    port: runtime.port || 0,
    cwd: redactLocalPath(runtime.cwd || "", options.homeDir || ""),
  };
}

function resolveDiagnosticEndpoint(baseUrl, usesKimiCodeDirect, kimiCodeAnthropicEndpoint) {
  if (baseUrl === "local:claude-kimi") {
    return usesKimiCodeDirect
      ? kimiCodeAnthropicEndpoint
      : "local claude CLI + page Kimi key -> https://api.kimi.com/coding/";
  }

  if (baseUrl === "local:claude-config") {
    return "local claude CLI configured auth";
  }

  return getChatCompletionsEndpoint(baseUrl);
}

function getExpectedPrefixForDiagnostic(baseUrl, environmentKey = null) {
  if (environmentKey?.expectedPrefix) {
    return environmentKey.expectedPrefix;
  }

  if (baseUrl === "local:claude-kimi" || String(baseUrl || "").includes("api.kimi.com")) {
    return "sk-kimi";
  }

  if (
    String(baseUrl || "").includes("api.deepseek.com") ||
    String(baseUrl || "").includes("api.openai.com") ||
    String(baseUrl || "").includes("api.moonshot.cn")
  ) {
    return "sk";
  }

  return "provider-specific";
}

function isDiagnosticKeyFormatOk({ apiKey = "", keyPrefix = "", expectedPrefix = "provider-specific" } = {}) {
  if (apiKey) {
    if (expectedPrefix === "sk-kimi") {
      return apiKey.startsWith("sk-kimi-");
    }

    if (expectedPrefix === "sk") {
      return apiKey.startsWith("sk-");
    }

    return true;
  }

  if (expectedPrefix === "sk-kimi") {
    return keyPrefix === "sk-kimi";
  }

  if (expectedPrefix === "sk") {
    return keyPrefix === "sk" || keyPrefix === "sk-kimi";
  }

  return true;
}

function buildClaudeDiagnosticBlock(settings, diagnostics, commandPath, isClaudeProvider) {
  const provider = String(settings.provider || "").trim();
  return {
    required: isClaudeProvider,
    command: redactLocalPath(diagnostics.claudeCommand || ""),
    source: diagnostics.claudeCommandSource || "none",
    available: Boolean(diagnostics.claudeAvailable),
    verified: Boolean(diagnostics.claudeVerified),
    pathProbe: summarizeCommandPath(commandPath),
    invocation: isClaudeProvider ? {
      model: diagnostics.model || settings.model || "",
      usePageKimiKey: provider === "claude-kimi-agent",
      settingsIsolation: provider === "claude-kimi-agent" ? "project-only" : "user-config-allowed",
      flags: provider === "claude-kimi-agent"
        ? ["--bare", "--setting-sources project", "--no-session-persistence", "--tools \"\"", "--output-format json"]
        : ["--no-session-persistence", "--tools \"\"", "--output-format json"],
      envInjected: provider === "claude-kimi-agent"
        ? ["ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "ENABLE_TOOL_SEARCH", "proxy vars if configured"]
        : ["ENABLE_TOOL_SEARCH", "proxy vars if configured"],
    } : null,
  };
}

function buildProxyDiagnosticBlock(settings, diagnostics, env) {
  return {
    present: Boolean(diagnostics.proxyPresent),
    source: diagnostics.proxySource || "none",
    appliedToRequest: Boolean(diagnostics.proxyAppliedToAgent),
    transport: sanitizeProxyTransport(diagnostics.proxyTransport || {}),
    pageProxyPresent: Boolean(String(settings.proxyUrl || "").trim()),
    environment: {
      PAPERLENS_PROXY_URL: Boolean(env.PAPERLENS_PROXY_URL),
      HTTP_PROXY: Boolean(env.HTTP_PROXY || env.http_proxy),
      HTTPS_PROXY: Boolean(env.HTTPS_PROXY || env.https_proxy),
      ALL_PROXY: Boolean(env.ALL_PROXY || env.all_proxy),
      NO_PROXY: Boolean(env.NO_PROXY || env.no_proxy),
    },
  };
}

function sanitizeProxyTransport(transport = {}) {
  return {
    ...transport,
    effectiveProxy: redactProxyUrl(transport.effectiveProxy || ""),
  };
}

export function buildModelDiagnosticRecommendations(report) {
  const items = [];
  const provider = report.provider.provider;
  const isClaudeProvider = report.claude.required;

  if (isClaudeProvider && !report.claude.available) {
    items.push("安装 Claude Code CLI，或设置 PAPERLENS_CLAUDE_CLI 为 claude 可执行文件的绝对路径。");
  }

  if (provider === "claude-kimi-agent" && !report.key.present) {
    items.push("Kimi Code Direct 需要页面输入完整 Kimi Code Key；控制台列表里的脱敏 sk-ki... 不能使用。");
  }

  if (provider === "claude-kimi-agent" && report.key.present && !report.key.formatOk) {
    items.push("当前 Key 格式不像 Kimi Code Key，应以 sk-kimi- 开头。");
  }

  if (report.key.refPresent && report.key.refMatchesProvider === false) {
    items.push("本地保存的 Key 引用与当前 Provider/Base URL 不匹配，请重新输入 API Key。");
  }

  if (report.runtime.isDocker && provider === "claude-local") {
    items.push("当前在 Docker 中运行，Claude Code 本机配置不会自动读取宿主机 ~/.claude；请在容器内配置认证或改用页面 Key Provider。");
  }

  if (report.runtime.isDocker && !report.proxy.present) {
    items.push("如果容器需要走宿主机代理，Proxy URL 通常写 http://host.docker.internal:端口，而不是 127.0.0.1。");
  }

  if (report.proxy.present && !report.proxy.appliedToRequest && !report.proxy.transport?.noProxyBypassed) {
    items.push("已检测到代理但当前请求没有应用代理；检查代理协议是否为 http/https/socks5。");
  }

  if (isClaudeProvider && Number(report.budget.cliMaxBudgetUsd || 0) <= 50) {
    items.push("Claude Code CLI 预算上限偏低；如果长任务提示 Budget has been exceeded，可以提高 Agent Budget USD 后重试。");
  }

  if (provider === "kimi-code") {
    items.push("Kimi Code Key 如果在普通 Chat Completion 受限，论文阅读建议改用 Kimi Code Direct 或 Kimi 开放平台。");
  }

  if (!items.length) {
    items.push("表面配置正常；下一步点击“测试连接”，若失败，把这个诊断包和错误信息一起查看。");
  }

  return items;
}

export function summarizeCommandPath(commandPath = "") {
  return String(commandPath || "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((item) => redactLocalPath(item))
    .slice(0, 24);
}

export function redactLocalPath(value = "", homeDir = "") {
  const text = String(value || "");
  const home = homeDir || process.env.HOME || "";
  if (home && text.startsWith(home)) {
    return `~${text.slice(home.length)}`;
  }

  return text;
}

export function redactUrl(value = "") {
  const text = String(value || "");
  if (!text || text.startsWith("local:")) {
    return text;
  }

  try {
    const url = new URL(text);
    if (url.username) {
      url.username = "***";
    }
    if (url.password) {
      url.password = "***";
    }
    for (const key of [...url.searchParams.keys()]) {
      if (/key|token|secret|password/i.test(key)) {
        url.searchParams.set(key, "***");
      }
    }
    return url.toString();
  } catch {
    return text.replace(/(api[_-]?key|token|secret|password)=([^&\s]+)/ig, "$1=***");
  }
}

export function redactProxyUrl(proxyUrl = "") {
  if (!proxyUrl) {
    return "";
  }

  try {
    const url = new URL(proxyUrl);
    if (url.username) {
      url.username = "***";
    }
    if (url.password) {
      url.password = "***";
    }
    return url.toString();
  } catch {
    return String(proxyUrl).replace(/\/\/([^:@/]+):([^@/]+)@/, "//***:***@");
  }
}

export function resolveBaseUrlForProvider(provider, baseUrl) {
  if (provider === "claude-kimi-agent") {
    return "local:claude-kimi";
  }

  if (provider === "claude-local") {
    return "local:claude-config";
  }

  return baseUrl;
}

export function normalizeAnalysisProfile(profile) {
  return profile === "fast" ? "fast" : "quality";
}

export function normalizeModelName(model) {
  const compact = String(model || "").toLowerCase().replace(/[\s_.-]+/g, "");
  const aliases = new Map([
    ["kimi26", "kimi-k2.6"],
    ["kimik26", "kimi-k2.6"],
    ["k26", "kimi-k2.6"],
  ]);

  return aliases.get(compact) || model;
}

export function normalizeApiKey(apiKey) {
  const withoutBearer = String(apiKey || "")
    .replace(/^bearer\s+/i, "")
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, "")
    .replace(/[，,。.;；\s]+$/g, "")
    .trim();
  const match = withoutBearer.match(/(sk-[A-Za-z0-9._-]+)/);

  return match?.[1] || withoutBearer;
}

export function getApiKeyPrefix(apiKey) {
  if (String(apiKey || "").startsWith("sk-kimi-")) {
    return "sk-kimi";
  }

  if (String(apiKey || "").startsWith("sk-")) {
    return "sk";
  }

  return apiKey ? "unknown" : "missing";
}
