import assert from "node:assert/strict";
import {
  buildOpenAiCompatibleProviderRequest,
  buildOpenAiCompatibleRequestBody,
  extractChatCompletionTextContent,
  formatModelError,
  getChatCompletionsEndpoint,
  getProviderPayloadOptions,
  parseProviderError,
} from "../lib/openai-compatible-provider.js";

assert.equal(
  getChatCompletionsEndpoint("https://api.deepseek.com/v1/"),
  "https://api.deepseek.com/v1/chat/completions",
);
assert.equal(
  getChatCompletionsEndpoint("https://example.com/v1/chat/completions"),
  "https://example.com/v1/chat/completions",
);

assert.deepEqual(getProviderPayloadOptions({ baseUrl: "https://api.deepseek.com/v1" }), {
  thinking: {
    type: "disabled",
  },
});
assert.deepEqual(getProviderPayloadOptions({ baseUrl: "https://api.openai.com/v1" }), {});

const messages = [{ role: "user", content: "ping" }];
assert.deepEqual(
  buildOpenAiCompatibleRequestBody(
    { model: "deepseek-chat", baseUrl: "https://api.deepseek.com/v1" },
    messages,
    { maxTokens: 64 },
  ),
  {
    model: "deepseek-chat",
    messages,
    temperature: 0.2,
    thinking: {
      type: "disabled",
    },
    max_tokens: 64,
  },
);

const abortController = new AbortController();
assert.deepEqual(
  buildOpenAiCompatibleProviderRequest(
    {
      model: "gpt-4.1-mini",
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1",
      proxyUrl: "http://127.0.0.1:7897",
    },
    messages,
    { maxTokens: 32, signal: abortController.signal },
  ),
  {
    endpoint: "https://api.openai.com/v1/chat/completions",
    requestOptions: {
      apiKey: "sk-test",
      body: {
        model: "gpt-4.1-mini",
        messages,
        temperature: 0.2,
        max_tokens: 32,
      },
      proxyUrl: "http://127.0.0.1:7897",
      signal: abortController.signal,
    },
  },
);

assert.equal(
  extractChatCompletionTextContent({ choices: [{ message: { content: "连接成功。" } }] }),
  "连接成功。",
);
assert.equal(
  extractChatCompletionTextContent({ choices: [{ message: { reasoning_content: "推理文本" } }] }),
  "推理文本",
);
assert.equal(extractChatCompletionTextContent({ choices: [] }), "");

assert.deepEqual(
  parseProviderError(JSON.stringify({ error: { message: "Budget has been exceeded", type: "insufficient_quota", code: "quota" } })),
  {
    message: "Budget has been exceeded",
    type: "insufficient_quota",
    code: "quota",
  },
);
assert.deepEqual(parseProviderError("not json"), { message: "", type: "", code: "" });

assert.match(
  formatModelError(402, JSON.stringify({ error: { message: "Budget has been exceeded", type: "insufficient_quota" } })),
  /会员权益或额度不可用.*Budget has been exceeded.*insufficient_quota/,
);
assert.match(
  formatModelError(403, JSON.stringify({ error: { message: "agent only", type: "access_terminated_error" } })),
  /访问受限.*Coding Agent/,
);
assert.match(
  formatModelError(429, JSON.stringify({ error: { message: "rate limited", type: "rate_limit" } })),
  /请求被限流或额度不足.*rate limited.*rate_limit/,
);
assert.match(
  formatModelError(400, "plain provider error body"),
  /模型请求失败，HTTP 400。plain provider error body/,
);
