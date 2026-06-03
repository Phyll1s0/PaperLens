import assert from "node:assert/strict";
import {
  KIMI_CODE_ANTHROPIC_VERSION,
  buildAnthropicMessages,
  buildKimiCodeAnthropicHeaders,
  buildKimiCodeAnthropicRequestBody,
  extractAnthropicTextContent,
} from "../lib/kimi-code-direct.js";

const normalized = buildAnthropicMessages([
  { role: "system", content: "S1" },
  { role: "system", content: "S2" },
  { role: "user", content: "U1" },
  { role: "user", content: "U2" },
  { role: "assistant", content: "A1" },
  { role: "user", content: "U3" },
]);

assert.equal(normalized.system, "S1\n\nS2");
assert.deepEqual(normalized.anthropicMessages, [
  { role: "user", content: "U1\n\nU2" },
  { role: "assistant", content: "A1" },
  { role: "user", content: "U3" },
]);

assert.deepEqual(buildAnthropicMessages([{ role: "system", content: "" }]), {
  system: undefined,
  anthropicMessages: [{ role: "user", content: "请继续。" }],
});

assert.deepEqual(
  buildKimiCodeAnthropicRequestBody(
    { model: "kimi-for-coding" },
    [
      { role: "system", content: "Read carefully." },
      { role: "user", content: "Explain this paragraph." },
    ],
    { maxTokens: 4096 },
  ),
  {
    model: "kimi-for-coding",
    max_tokens: 4096,
    temperature: 0.2,
    system: "Read carefully.",
    messages: [{ role: "user", content: "Explain this paragraph." }],
  },
);

assert.deepEqual(buildKimiCodeAnthropicHeaders("sk-kimi-test"), {
  "anthropic-version": KIMI_CODE_ANTHROPIC_VERSION,
  "x-api-key": "sk-kimi-test",
});

assert.equal(extractAnthropicTextContent({ content: "plain" }), "plain");
assert.equal(
  extractAnthropicTextContent({
    content: [
      { type: "text", text: "hello" },
      { content: "world" },
    ],
  }),
  "hello\nworld",
);
assert.equal(extractAnthropicTextContent({ choices: [{ message: { content: "chat" } }] }), "chat");
assert.equal(extractAnthropicTextContent({ choices: [{ message: { reasoning_content: "reason" } }] }), "reason");
assert.equal(extractAnthropicTextContent({ result: "fallback" }), "fallback");
