import { execFile } from "node:child_process";

const chunks = [];

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();

  await new Promise((resolve) => {
    process.stdin.on("data", (chunk) => {
      const endIndex = [...chunk].findIndex((byte) => byte === 3 || byte === 4 || byte === 10 || byte === 13);
      if (endIndex !== -1) {
        if (endIndex > 0) {
          chunks.push(chunk.subarray(0, endIndex));
        }

        process.stdin.setRawMode(false);
        process.stdin.pause();
        resolve();
        return;
      }

      chunks.push(chunk);
    });
  });
} else {
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
}

const apiKey = Buffer.concat(chunks)
  .toString("utf8")
  .replace(/^bearer\s+/i, "")
  .replace(/^["']|["']$/g, "")
  .replace(/\s+/g, "")
  .replace(/[，,。.;；\s]+$/g, "")
  .trim();

if (!apiKey) {
  console.error(JSON.stringify({ ok: false, error: "Missing API key." }, null, 2));
  process.exit(1);
}

const attempts = [
  {
    name: "auth_token_kimi_for_coding",
    env: { ANTHROPIC_AUTH_TOKEN: apiKey },
    model: "kimi-for-coding",
  },
  {
    name: "api_key_kimi_for_coding",
    env: { ANTHROPIC_API_KEY: apiKey },
    model: "kimi-for-coding",
  },
  {
    name: "auth_token_kimi_k2_5",
    env: { ANTHROPIC_AUTH_TOKEN: apiKey },
    model: "kimi-k2.5",
  },
  {
    name: "api_key_kimi_k2_5",
    env: { ANTHROPIC_API_KEY: apiKey },
    model: "kimi-k2.5",
  },
];

const results = [];

for (const attempt of attempts) {
  const result = await runClaudeAttempt(attempt);
  results.push(result);

  if (result.ok) {
    break;
  }
}

console.log(JSON.stringify({
  cli: "claude",
  baseUrl: "https://api.kimi.com/coding/",
  keyPrefix: apiKey.startsWith("sk-kimi-") ? "sk-kimi" : apiKey.startsWith("sk-") ? "sk" : "unknown",
  keyLength: apiKey.length,
  results,
}, null, 2));

function runClaudeAttempt(attempt) {
  return new Promise((resolve) => {
    execFile("claude", [
      "-p",
      "只回复：ok",
      "--bare",
      "--no-session-persistence",
      "--tools",
      "",
      "--model",
      attempt.model,
      "--output-format",
      "json",
    ], {
      cwd: process.cwd(),
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        ...attempt.env,
        ANTHROPIC_BASE_URL: "https://api.kimi.com/coding/",
        ENABLE_TOOL_SEARCH: "false",
      },
    }, (error, stdout, stderr) => {
      let parsed;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        parsed = undefined;
      }

      resolve({
        name: attempt.name,
        model: attempt.model,
        ok: !error,
        code: error?.code ?? 0,
        signal: error?.signal || "",
        stdout: parsed
          ? {
              type: parsed.type,
              subtype: parsed.subtype,
              result: parsed.result,
              error: parsed.error,
            }
          : stdout.slice(0, 1200),
        stderr: stderr.slice(0, 1200),
      });
    });
  });
}
