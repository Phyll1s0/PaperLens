import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.dirname(path.dirname(__filename));

loadDotEnv(path.join(ROOT_DIR, ".env"));

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3000);
const healthHost = host === "0.0.0.0" ? "127.0.0.1" : host;
const url = `http://${healthHost}:${port}`;

if (await checkHealth()) {
  console.log(`PaperLens is already running: ${url}`);
  process.exit(0);
}

console.log("Starting PaperLens...");

const child = spawn(process.execPath, ["server.js"], {
  cwd: ROOT_DIR,
  stdio: "inherit",
  env: process.env,
});

let stopped = false;

const stop = () => {
  if (stopped) {
    return;
  }
  stopped = true;
  child.kill("SIGTERM");
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

waitForHealth()
  .then(() => {
    console.log("");
    console.log(`PaperLens is ready: ${url}`);
    console.log("Press Ctrl+C to stop.");
  })
  .catch((error) => {
    console.error(`PaperLens did not become healthy: ${error.message}`);
  });

child.on("exit", (code, signal) => {
  if (signal) {
    process.exit(0);
  }
  process.exit(code || 0);
});

async function waitForHealth() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 12_000) {
    if (await checkHealth()) {
      return;
    }
    await sleep(350);
  }
  throw new Error(`${url}/api/health did not respond in time`);
}

function checkHealth() {
  return new Promise((resolve) => {
    const request = http.get({
      hostname: healthHost,
      port,
      path: "/api/health",
      timeout: 800,
    }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(false));
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
