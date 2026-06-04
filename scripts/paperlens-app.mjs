import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.dirname(path.dirname(__filename));
const REQUIRED_SERVICE_SCHEMA_VERSION = 2;
const HEALTH_TIMEOUT_MS = 15_000;

loadDotEnv(path.join(ROOT_DIR, ".env"));

const args = new Set(process.argv.slice(2));
const shouldOpenBrowser = !args.has("--no-open");
const printConfigOnly = args.has("--print-config");
const host = process.env.HOST || "127.0.0.1";
const basePort = Number(process.env.PORT || process.env.PAPERLENS_PORT || 3000);
const port = await pickPort(basePort, { allowFallback: process.env.PORT === undefined });
const healthHost = host === "0.0.0.0" ? "127.0.0.1" : host;
const appUrl = `http://${healthHost}:${port}`;

if (printConfigOnly) {
  console.log(JSON.stringify({
    rootDir: ROOT_DIR,
    host,
    port,
    url: appUrl,
    openBrowser: shouldOpenBrowser,
  }, null, 2));
  process.exit(0);
}

const existingHealth = await checkHealth(healthHost, port);
const existingProblem = getHealthProblem(existingHealth.payload);
if (existingHealth.ok && !existingProblem) {
  console.log(`PaperLens is already running: ${appUrl}`);
  if (shouldOpenBrowser) {
    await openBrowser(appUrl);
  }
  process.exit(0);
}

if (existingHealth.ok && existingProblem) {
  console.error(`PaperLens is already running on ${appUrl}, but ${existingProblem}`);
  console.error("Stop the old PaperLens process, then launch the app again.");
  process.exit(1);
}

console.log(`Starting PaperLens app at ${appUrl}...`);

const child = spawn(process.execPath, ["server.js"], {
  cwd: ROOT_DIR,
  stdio: "inherit",
  env: {
    ...process.env,
    HOST: host,
    PORT: String(port),
  },
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

try {
  await waitForHealth(healthHost, port);
  console.log("");
  console.log(`PaperLens is ready: ${appUrl}`);
  if (shouldOpenBrowser) {
    await openBrowser(appUrl);
  }
  console.log("Keep this window open while using PaperLens. Press Ctrl+C to stop.");
} catch (error) {
  console.error(`PaperLens did not become healthy: ${error.message}`);
}

child.on("exit", (code, signal) => {
  if (signal) {
    process.exit(0);
  }
  process.exit(code || 0);
});

async function waitForHealth(healthHostname, healthPort) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < HEALTH_TIMEOUT_MS) {
    const health = await checkHealth(healthHostname, healthPort);
    if (health.ok && !getHealthProblem(health.payload)) {
      return;
    }
    await sleep(350);
  }
  throw new Error(`health check timed out at http://${healthHostname}:${healthPort}/api/health`);
}

function checkHealth(healthHostname, healthPort) {
  return new Promise((resolve) => {
    const request = http.get({
      hostname: healthHostname,
      port: healthPort,
      path: "/api/health",
      timeout: 900,
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
    return "it is using an older health schema.";
  }

  if (Number(payload.serviceSchemaVersion) < REQUIRED_SERVICE_SCHEMA_VERSION) {
    return `its health schema is ${payload.serviceSchemaVersion}; expected ${REQUIRED_SERVICE_SCHEMA_VERSION}.`;
  }

  if (payload.needsRestart) {
    return payload.restartReason || "the service source changed after startup.";
  }

  return "";
}

async function pickPort(preferredPort, options = {}) {
  const port = Number.isFinite(preferredPort) && preferredPort > 0 ? Math.trunc(preferredPort) : 3000;
  if (await isPortFree(port)) {
    return port;
  }

  const existing = await checkHealth(host === "0.0.0.0" ? "127.0.0.1" : host, port);
  if (existing.ok) {
    return port;
  }

  if (!options.allowFallback) {
    return port;
  }

  for (let candidate = port + 1; candidate < port + 50; candidate += 1) {
    if (await isPortFree(candidate)) {
      return candidate;
    }
  }

  return port;
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host === "0.0.0.0" ? "127.0.0.1" : host);
  });
}

function openBrowser(url) {
  const command = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "cmd"
      : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
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
