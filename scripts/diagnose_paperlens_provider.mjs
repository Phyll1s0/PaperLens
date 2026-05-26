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

const response = await fetch("http://127.0.0.1:3000/api/model/ping", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    settings: {
      provider: "claude-kimi-agent",
      // This intentionally wrong baseUrl verifies the server honors provider
      // and forces the local Claude Code bridge.
      baseUrl: "https://api.deepseek.com",
      model: "kimi-for-coding",
      apiKey,
      agentBudgetUsd: 500,
    },
  }),
});

const body = await response.json().catch(() => ({}));

console.log(JSON.stringify({
  ok: response.ok,
  status: response.status,
  error: body.error,
  answer: body.answer,
  diagnostics: body.diagnostics,
}, null, 2));

process.exit(response.ok ? 0 : 1);
