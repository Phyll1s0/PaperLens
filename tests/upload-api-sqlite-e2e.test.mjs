import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.dirname(path.dirname(__filename));
const fixturePath = path.join(ROOT_DIR, "tests", "fixtures", "minimal-paper.pdf");

if (!(await hasNodeSqlite())) {
  console.log("SKIP upload-api-sqlite-e2e: node:sqlite is not available in this Node.js runtime");
} else {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "paperlens-upload-sqlite-e2e-"));
  const sqlitePath = path.join(tempDir, "data", "paperlens.sqlite");
  let child;

  try {
    child = await startServer(tempDir, sqlitePath);
    const baseUrl = child.baseUrl;
    const health = await fetchJson(`${baseUrl}/api/health`);
    assert.equal(health.persistence.active, "sqlite");
    assert.equal(health.persistence.sqlitePath, sqlitePath);

    const formData = new FormData();
    formData.append("pdf", new Blob([await readFile(fixturePath)], { type: "application/pdf" }), "minimal-paper.pdf");
    const uploaded = await fetchJson(`${baseUrl}/api/papers/upload`, {
      method: "POST",
      body: formData,
    });
    assert.match(uploaded.id, /^paper_/);
    assert.equal(uploaded.status, "ready");

    const papers = await fetchJson(`${baseUrl}/api/papers`);
    assert.ok(papers.papers.some((paper) => paper.id === uploaded.id));

    const analysisJobResult = await fetchJson(`${baseUrl}/api/papers/${encodeURIComponent(uploaded.id)}/analysis-jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        settings: {
          provider: "openai",
          baseUrl: "https://example.invalid/v1",
          model: "gpt-4.1-mini",
          apiKey: "sk-paperlens-sqlite-e2e",
          analysisProfile: "fast",
          taskBudgetUsd: 1,
        },
        useCache: false,
      }),
    });
    assert.equal(analysisJobResult.job.status, "queued");
    await stat(sqlitePath);

    await stopServer(child.process);
    child = await startServer(tempDir, sqlitePath);
    const restoredPaper = await fetchJson(`${child.baseUrl}/api/papers/${encodeURIComponent(uploaded.id)}`);
    assert.equal(restoredPaper.id, uploaded.id);
    const restoredJob = await fetchJson(`${child.baseUrl}/api/jobs/${encodeURIComponent(analysisJobResult.job.id)}`);
    assert.equal(restoredJob.job.id, analysisJobResult.job.id);
    assert.equal(restoredJob.job.status, "queued");

    const restoredHealth = await fetchJson(`${child.baseUrl}/api/health`);
    assert.equal(restoredHealth.persistence.sqliteStats.papers, 1);
    assert.equal(restoredHealth.persistence.sqliteStats.jobs, 1);
  } finally {
    if (child?.process) {
      await stopServer(child.process);
    }
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function hasNodeSqlite() {
  try {
    await import("node:sqlite");
    return true;
  } catch {
    return false;
  }
}

async function startServer(tempDir, sqlitePath) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: "0",
      PAPERLENS_ACCESS_TOKEN: "",
      PAPERLENS_AUTH_TOKEN: "",
      PAPERLENS_RUNTIME_DIR: tempDir,
      PAPERLENS_PDF_ENGINE: "fixture",
      PAPERLENS_STORAGE: "sqlite",
      PAPERLENS_SQLITE_PATH: sqlitePath,
      PAPERLENS_DISABLE_JOB_WORKER: "1",
      PAPERLENS_JSON_BACKUP_RETENTION: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.baseUrl = await waitForServerUrl(child);
  return { process: child, baseUrl: child.baseUrl };
}

function waitForServerUrl(processHandle) {
  let stdout = "";
  let stderr = "";
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`PaperLens SQLite test server did not start.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 15_000);

    processHandle.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const match = stdout.match(/Paper reading assistant running at (http:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
    processHandle.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    processHandle.once("exit", (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`PaperLens SQLite test server exited early code=${code} signal=${signal}.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    });
  });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON from ${url}, got: ${text.slice(0, 300)}`);
  }
  if (!response.ok) {
    throw new Error(`Request failed ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function stopServer(processHandle) {
  if (processHandle.exitCode !== null) {
    return;
  }

  processHandle.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 3_000);
    processHandle.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}
