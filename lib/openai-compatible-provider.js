export function getChatCompletionsEndpoint(baseUrl) {
  const clean = String(baseUrl || "").replace(/\/+$/, "");
  if (clean.endsWith("/chat/completions")) {
    return clean;
  }

  return `${clean}/chat/completions`;
}

export function getProviderPayloadOptions(settings = {}) {
  if (String(settings.baseUrl || "").includes("api.deepseek.com")) {
    return {
      thinking: {
        type: "disabled",
      },
    };
  }

  return {};
}

export function buildOpenAiCompatibleRequestBody(settings = {}, messages = [], options = {}) {
  return {
    model: settings.model,
    messages,
    temperature: 0.2,
    ...getProviderPayloadOptions(settings),
    ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
  };
}

export function buildOpenAiCompatibleProviderRequest(settings = {}, messages = [], options = {}) {
  const endpoint = options.endpoint || getChatCompletionsEndpoint(settings.baseUrl);
  const body = buildOpenAiCompatibleRequestBody(settings, messages, options);

  return {
    endpoint,
    requestOptions: {
      apiKey: settings.apiKey,
      body,
      proxyUrl: settings.proxyUrl,
      signal: options.signal,
    },
  };
}

export function extractChatCompletionTextContent(data) {
  const message = data?.choices?.[0]?.message;
  return message?.content || message?.reasoning_content || "";
}

export function parseProviderError(body) {
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

export function formatModelError(status, body) {
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

  return `模型请求失败，HTTP ${status}。${providerMessage ? `供应商信息：${providerMessage}${providerType}` : String(body || "").slice(0, 400)}`;
}
