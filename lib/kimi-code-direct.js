export const KIMI_CODE_ANTHROPIC_ENDPOINT = "https://api.kimi.com/coding/v1/messages";
export const KIMI_CODE_ANTHROPIC_VERSION = "2023-06-01";

export function buildAnthropicMessages(messages = []) {
  const systemParts = [];
  const anthropicMessages = [];

  for (const message of messages) {
    const role = String(message?.role || "user").toLowerCase();
    const content = String(message?.content || "");
    if (!content) {
      continue;
    }

    if (role === "system") {
      systemParts.push(content);
      continue;
    }

    const normalizedRole = role === "assistant" ? "assistant" : "user";
    const previous = anthropicMessages.at(-1);
    if (previous?.role === normalizedRole) {
      previous.content = `${previous.content}\n\n${content}`;
    } else {
      anthropicMessages.push({
        role: normalizedRole,
        content,
      });
    }
  }

  if (!anthropicMessages.length) {
    anthropicMessages.push({
      role: "user",
      content: "请继续。",
    });
  }

  return {
    system: systemParts.join("\n\n") || undefined,
    anthropicMessages,
  };
}

export function buildKimiCodeAnthropicRequestBody(settings = {}, messages = [], options = {}) {
  const { system, anthropicMessages } = buildAnthropicMessages(messages);

  return {
    model: settings.model || "kimi-for-coding",
    max_tokens: Number(options.maxTokens || 12_000),
    temperature: 0.2,
    system,
    messages: anthropicMessages,
  };
}

export function buildKimiCodeAnthropicHeaders(apiKey) {
  return {
    "anthropic-version": KIMI_CODE_ANTHROPIC_VERSION,
    "x-api-key": apiKey,
  };
}

export function extractAnthropicTextContent(data) {
  if (typeof data?.content === "string") {
    return data.content;
  }

  if (Array.isArray(data?.content)) {
    return data.content
      .map((block) => {
        if (typeof block === "string") {
          return block;
        }
        return block?.text || block?.content || "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  const message = data?.choices?.[0]?.message;
  return message?.content || message?.reasoning_content || data?.result || "";
}
