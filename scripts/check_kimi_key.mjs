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

const response = await fetch("https://api.moonshot.cn/v1/chat/completions", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "authorization": `Bearer ${apiKey}`,
  },
  body: JSON.stringify({
    model: "kimi-k2.6",
    messages: [
      { role: "system", content: "你是连接测试助手。只回复四个字。" },
      { role: "user", content: "请回复：连接成功" },
    ],
    temperature: 0,
    max_tokens: 16,
  }),
});

const text = await response.text();
let data;

try {
  data = JSON.parse(text);
} catch {
  data = { raw: text.slice(0, 1000) };
}

const safe = {
  ok: response.ok,
  status: response.status,
  statusText: response.statusText,
  model: "kimi-k2.6",
  endpoint: "https://api.moonshot.cn/v1/chat/completions",
  result: response.ok
    ? data.choices?.[0]?.message?.content || data
    : {
        message: data.error?.message || data.message || data.raw || "",
        type: data.error?.type || data.type || "",
        code: data.error?.code || data.code || "",
      },
};

console.log(JSON.stringify(safe, null, 2));
process.exit(response.ok ? 0 : 1);
