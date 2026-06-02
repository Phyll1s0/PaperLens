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
const REQUIRED_SERVICE_SCHEMA_VERSION = 2;

const existingHealth = await checkHealth();
const existingProblem = getHealthProblem(existingHealth.payload);
if (existingHealth.ok && !existingProblem) {
  console.log(`PaperLens is already running: ${url}`);
  process.exit(0);
}

if (existingHealth.ok && existingProblem) {
  console.error(`PaperLens is already running, but ${existingProblem}`);
  console.error("Stop the old PaperLens process, then run npm run dev again.");
  console.error("If you use the background service, run npm run service:restart.");
  process.exit(1);
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
    const health = await checkHealth();
    if (health.ok && !getHealthProblem(health.payload)) {
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
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        const payload = parseJson(body);
        resolve({
          ok: response.statusCode === 200 && Boolean(payload?.ok),
          statusCode: response.statusCode,
          payload,
        });
      });
    });
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve({ ok: false, payload: null }));
  });
}

function getHealthProblem(payload) {
  if (!payload?.ok) {
    return "";
  }

  if (payload.serviceSchemaVersion === undefined) {
    return "it is using an older health schema. Restart the service after updating code.";
  }

  if (Number(payload.serviceSchemaVersion) < REQUIRED_SERVICE_SCHEMA_VERSION) {
    return `its health schema is ${payload.serviceSchemaVersion}; expected ${REQUIRED_SERVICE_SCHEMA_VERSION}. Restart the service.`;
  }

  if (payload.needsRestart) {
    return payload.restartReason || "the service source changed after startup. Restart the service.";
  }

  return "";
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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
