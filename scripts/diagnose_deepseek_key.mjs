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

const endpoint = "https://api.deepseek.com";

const checks = [
  {
    name: "models",
    url: `${endpoint}/models`,
    method: "GET",
  },
  {
    name: "chat_deepseek_v4_flash",
    url: `${endpoint}/chat/completions`,
    method: "POST",
    body: {
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "只回复：ok" }],
      max_tokens: 8,
      temperature: 0,
      thinking: { type: "disabled" },
    },
  },
  {
    name: "chat_deepseek_v4_pro",
    url: `${endpoint}/chat/completions`,
    method: "POST",
    body: {
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "只回复：ok" }],
      max_tokens: 8,
      temperature: 0,
      thinking: { type: "disabled" },
    },
  },
];

const results = [];

for (const check of checks) {
  const response = await fetch(check.url, {
    method: check.method,
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${apiKey}`,
    },
    body: check.body ? JSON.stringify(check.body) : undefined,
  });

  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 600) };
  }

  results.push({
    name: check.name,
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    error: response.ok
      ? undefined
      : {
          message: data.error?.message || data.message || data.raw || "",
          type: data.error?.type || data.type || "",
          code: data.error?.code || data.code || "",
        },
    sample: response.ok
      ? {
          model: data.model,
          text: data.choices?.[0]?.message?.content,
          modelCount: Array.isArray(data.data) ? data.data.length : undefined,
        }
      : undefined,
  });
}

console.log(JSON.stringify({
  endpoint,
  keyPrefix: apiKey.startsWith("sk-") ? "sk" : "unknown",
  keyLength: apiKey.length,
  results,
}, null, 2));
