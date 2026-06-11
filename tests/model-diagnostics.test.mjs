import assert from "node:assert/strict";
import {
  buildModelDiagnosticReport,
  normalizeApiKey,
  redactProxyUrl,
  redactUrl,
} from "../lib/model-diagnostics.js";

const runtime = {
  isDocker: false,
  platform: "darwin",
  arch: "arm64",
  nodeVersion: "v25.9.0",
  host: "127.0.0.1",
  port: 3000,
  cwd: "/Users/alice/Code/PaperLens",
};

const paperLens = {
  packageVersion: "0.1.0",
  serviceSchemaVersion: 2,
  serviceStartedAt: "2026-06-04T00:00:00.000Z",
  generatedAt: "2026-06-04T00:01:00.000Z",
};

assert.equal(normalizeApiKey("Bearer 'sk-kimi-abc123' ;"), "sk-kimi-abc123");
assert.equal(redactUrl("https://user:pass@example.com/v1?api_key=secret&token=tok&safe=1"), "https://***:***@example.com/v1?api_key=***&token=***&safe=1");
assert.equal(redactProxyUrl("http://proxy-user:proxy-pass@127.0.0.1:7897"), "http://***:***@127.0.0.1:7897/");

const kimiKey = "sk-kimi-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890";
const kimiReport = buildModelDiagnosticReport({
  provider: "claude-kimi-agent",
  baseUrl: "https://should-be-ignored.example/v1",
  model: "kimi for coding",
  apiKey: `Bearer ${kimiKey}`,
  agentBudgetUsd: 500,
  analysisProfile: "fast",
}, {
  ...paperLens,
  runtime,
  homeDir: "/Users/alice",
  diagnostics: {
    endpoint: "https://api.kimi.com/coding/v1/messages",
    model: "kimi for coding",
    keyFormatOk: true,
    proxyPresent: false,
    proxySource: "none",
    proxyAppliedToAgent: false,
    proxyTransport: { mode: "direct" },
  },
  commandPath: "/Users/alice/bin:/usr/bin",
  env: {},
  usesKimiCodeDirect: true,
});

assert.equal(kimiReport.generatedAt, paperLens.generatedAt);
assert.equal(kimiReport.runtime.cwd, "~/Code/PaperLens");
assert.equal(kimiReport.provider.resolvedBaseUrl, "local:claude-kimi");
assert.equal(kimiReport.provider.analysisProfile, "fast");
assert.equal(kimiReport.key.present, true);
assert.equal(kimiReport.key.source, "page");
assert.equal(kimiReport.key.prefix, "sk-kimi");
assert.equal(kimiReport.key.length, kimiKey.length);
assert.equal(kimiReport.key.formatOk, true);
assert.equal(kimiReport.claude.required, false);
assert.equal(kimiReport.claude.invocation, null);
assert.match(kimiReport.budget.note, /不使用 Claude Code CLI/);
assert.equal(JSON.stringify(kimiReport).includes(kimiKey), false);
assert.deepEqual(kimiReport.recommendations, ["表面配置正常；下一步点击“测试连接”，若失败，把这个诊断包和错误信息一起查看。"]);

const envKimiKey = "sk-" + "kimi-" + "EnvOnlyAbCdEfGhIjKlMnOpQrStUvWxYz123456";
const envKimiReport = buildModelDiagnosticReport({
  provider: "claude-kimi-agent",
  baseUrl: "local:claude-kimi",
  model: "kimi-for-coding",
}, {
  ...paperLens,
  runtime,
  diagnostics: {
    endpoint: "https://api.kimi.com/coding/v1/messages",
    model: "kimi-for-coding",
    keyPresent: true,
    keySource: "env",
    keyEnv: true,
    keyPrefix: "sk-kimi",
    keyLength: envKimiKey.length,
    keyFormatOk: true,
    proxyPresent: false,
    proxySource: "none",
    proxyAppliedToAgent: false,
    proxyTransport: { mode: "direct" },
  },
  environmentKey: {
    configured: true,
    keyPrefix: "sk-kimi",
    keyLength: envKimiKey.length,
    keyFormatOk: true,
  },
  env: {
    PAPERLENS_KIMI_API_KEY: envKimiKey,
  },
  usesKimiCodeDirect: true,
});

assert.equal(envKimiReport.key.present, true);
assert.equal(envKimiReport.key.source, "env");
assert.equal(envKimiReport.key.prefix, "sk-kimi");
assert.equal(envKimiReport.key.length, envKimiKey.length);
assert.equal(JSON.stringify(envKimiReport).includes(envKimiKey), false);

const envDeepSeekKey = "sk-" + "deepseek-env-only-test-key-123456";
const envDeepSeekReport = buildModelDiagnosticReport({
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
}, {
  ...paperLens,
  runtime,
  diagnostics: {
    endpoint: "https://api.deepseek.com/chat/completions",
    model: "deepseek-v4-flash",
    keyPresent: true,
    keySource: "env",
    keyEnv: true,
    keyPrefix: "sk",
    keyLength: envDeepSeekKey.length,
    keyFormatOk: true,
    proxyPresent: false,
    proxySource: "none",
    proxyAppliedToAgent: false,
    proxyTransport: { mode: "direct" },
  },
  environmentKey: {
    configured: true,
    provider: "deepseek",
    keyPrefix: "sk",
    keyLength: envDeepSeekKey.length,
    keyFormatOk: true,
    expectedPrefix: "sk",
  },
  env: {
    PAPERLENS_DEEPSEEK_API_KEY: envDeepSeekKey,
  },
});

assert.equal(envDeepSeekReport.key.present, true);
assert.equal(envDeepSeekReport.key.source, "env");
assert.equal(envDeepSeekReport.key.prefix, "sk");
assert.equal(envDeepSeekReport.key.expectedPrefix, "sk");
assert.equal(JSON.stringify(envDeepSeekReport).includes(envDeepSeekKey), false);

const savedKeyReport = buildModelDiagnosticReport({
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  apiKeyRef: "key_1",
}, {
  ...paperLens,
  runtime,
  diagnostics: {
    endpoint: "https://api.deepseek.com/chat/completions",
    model: "deepseek-v4-flash",
    keyFormatOk: true,
    proxyPresent: false,
    proxySource: "none",
    proxyAppliedToAgent: false,
    proxyTransport: { mode: "direct" },
  },
  savedKey: {
    id: "key_1",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    keyPrefix: "sk",
    keyLength: 51,
  },
  keyRefMatches: false,
  env: {},
});

assert.equal(savedKeyReport.key.source, "server-ref");
assert.equal(savedKeyReport.key.saved, true);
assert.equal(savedKeyReport.key.refMatchesProvider, false);
assert.ok(savedKeyReport.recommendations.some((item) => item.includes("Key 引用与当前 Provider/Base URL 不匹配")));

const proxyReport = buildModelDiagnosticReport({
  provider: "custom",
  baseUrl: "https://user:pass@example.com/v1?token=provider-token&safe=1",
  model: "gpt-custom",
  apiKey: "sk-test-proxy",
  proxyUrl: "http://proxy-user:proxy-pass@127.0.0.1:7897",
}, {
  ...paperLens,
  runtime,
  diagnostics: {
    endpoint: "https://user:pass@example.com/v1/chat/completions?token=provider-token",
    model: "gpt-custom",
    keyFormatOk: true,
    proxyPresent: true,
    proxySource: "page",
    proxyAppliedToAgent: true,
    proxyTransport: {
      mode: "http-connect",
      protocol: "http",
      supported: true,
      effectiveProxy: "http://proxy-user:proxy-pass@127.0.0.1:7897",
    },
  },
  env: {
    HTTP_PROXY: "http://env-user:env-pass@127.0.0.1:8888",
    NO_PROXY: "localhost",
  },
});

const proxyJson = JSON.stringify(proxyReport);
assert.equal(proxyReport.provider.rawBaseUrl, "https://***:***@example.com/v1?token=***&safe=1");
assert.equal(proxyReport.proxy.transport.effectiveProxy, "http://***:***@127.0.0.1:7897/");
assert.equal(proxyReport.proxy.environment.HTTP_PROXY, true);
assert.equal(proxyReport.proxy.environment.NO_PROXY, true);
assert.equal(proxyJson.includes("provider-token"), false);
assert.equal(proxyJson.includes("proxy-user"), false);
assert.equal(proxyJson.includes("proxy-pass"), false);
assert.equal(proxyJson.includes("env-user"), false);
assert.equal(proxyJson.includes("env-pass"), false);

const claudeDockerReport = buildModelDiagnosticReport({
  provider: "claude-local",
  baseUrl: "local:claude-config",
  model: "sonnet",
  agentBudgetUsd: 50,
}, {
  ...paperLens,
  runtime: { ...runtime, isDocker: true },
  diagnostics: {
    endpoint: "local claude CLI configured auth",
    model: "sonnet",
    keyFormatOk: true,
    claudeCommand: "claude",
    claudeCommandSource: "missing",
    claudeAvailable: false,
    claudeVerified: false,
    proxyPresent: false,
    proxySource: "none",
    proxyAppliedToAgent: false,
    proxyTransport: { mode: "cli-env" },
  },
  commandPath: "/usr/local/bin:/usr/bin",
  env: {},
  usesKimiCodeDirect: false,
});

assert.equal(claudeDockerReport.claude.required, true);
assert.equal(claudeDockerReport.claude.available, false);
assert.deepEqual(claudeDockerReport.claude.invocation.flags, ["--no-session-persistence", "--tools \"\"", "--output-format json"]);
assert.ok(claudeDockerReport.recommendations.some((item) => item.includes("安装 Claude Code CLI")));
assert.ok(claudeDockerReport.recommendations.some((item) => item.includes("Docker 中运行")));
assert.ok(claudeDockerReport.recommendations.some((item) => item.includes("host.docker.internal")));
assert.ok(claudeDockerReport.recommendations.some((item) => item.includes("预算上限偏低")));
