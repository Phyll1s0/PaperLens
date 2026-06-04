import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.dirname(path.dirname(__filename));
const fixturePath = path.join(ROOT_DIR, "tests", "fixtures", "minimal-paper.pdf");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "paperlens-upload-e2e-"));

let child;
try {
  child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: "0",
      PAPERLENS_ACCESS_TOKEN: "",
      PAPERLENS_AUTH_TOKEN: "",
      PAPERLENS_RUNTIME_DIR: tempDir,
      PAPERLENS_PDF_ENGINE: "fixture",
      PAPERLENS_DISABLE_JOB_WORKER: "1",
      PAPERLENS_JSON_BACKUP_RETENTION: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const baseUrl = await waitForServerUrl(child);
  const health = await fetchJson(`${baseUrl}/api/health`);
  assert.equal(health.ok, true);
  assert.equal(health.runtime.host, "127.0.0.1");
  assert.equal(health.queue.workerScheduled, false);

  const katexModule = await fetch(`${baseUrl}/vendor/katex/katex.mjs`);
  assert.equal(katexModule.status, 200);
  assert.match(katexModule.headers.get("content-type") || "", /text\/javascript/);
  const katexCss = await fetch(`${baseUrl}/vendor/katex/katex.min.css`);
  assert.equal(katexCss.status, 200);
  assert.match(katexCss.headers.get("content-type") || "", /text\/css/);

  const formData = new FormData();
  formData.append("pdf", new Blob([await readFile(fixturePath)], { type: "application/pdf" }), "minimal-paper.pdf");
  const uploaded = await fetchJson(`${baseUrl}/api/papers/upload`, {
    method: "POST",
    body: formData,
  });

  assert.match(uploaded.id, /^paper_/);
  assert.equal(uploaded.filename, "minimal-paper.pdf");
  assert.equal(uploaded.pageCount, 1);
  assert.equal(uploaded.status, "ready");
  assert.equal(uploaded.segmentationMode, "layout");
  assert.ok(uploaded.extractionPages[0].blocks.length >= 4);
  assert.ok(uploaded.paragraphs.length >= 2);
  assert.ok(uploaded.pageImages.some((page) => /page-001\.png$/.test(page.imagePath || "")));
  assert.ok(uploaded.pageArtifacts.some((artifact) => artifact.type === "caption" && artifact.crop));
  assert.ok(uploaded.pageArtifacts.some((artifact) => artifact.type === "formula"));

  const persisted = await fetchJson(`${baseUrl}/api/papers/${encodeURIComponent(uploaded.id)}`);
  assert.equal(persisted.id, uploaded.id);
  assert.equal(persisted.extractionPages[0].visualStructureVersion, 6);
  assert.equal(Boolean(persisted.segmentationPlanningSnapshot), true);

  const editableParagraphs = persisted.paragraphs.filter((paragraph) => paragraph.kind === "paragraph");
  assert.ok(editableParagraphs.length >= 2);
  const firstEditable = editableParagraphs[0];
  const secondEditable = editableParagraphs[1];
  const editResult = await fetchJson(`${baseUrl}/api/papers/${encodeURIComponent(uploaded.id)}/paragraphs/${encodeURIComponent(firstEditable.id)}/edit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "merge-next" }),
  });
  assert.deepEqual(new Set(editResult.changedParagraphIds), new Set([firstEditable.id, secondEditable.id]));
  const mergedParagraph = editResult.paper.paragraphs.find((paragraph) => paragraph.id === firstEditable.id);
  assert.ok(mergedParagraph.sourceText.includes(firstEditable.sourceText.slice(0, 20)));
  assert.ok(mergedParagraph.sourceText.includes(secondEditable.sourceText.slice(0, 20)));
  assert.equal(mergedParagraph.analysisStatus, "pending");
  assert.equal(mergedParagraph.translation, "");
  assert.equal(Boolean(editResult.paper.manualSegmentationEdits?.[0]), true);

  const pageImage = await fetch(`${baseUrl}/assets/${encodeURIComponent(uploaded.id)}/page-001.png`);
  assert.equal(pageImage.status, 200);
  assert.match(pageImage.headers.get("content-type") || "", /image\/png/);

  const figure = uploaded.pageArtifacts.find((artifact) => artifact.type === "caption" && artifact.crop);
  const crop = await fetchText(`${baseUrl}/api/papers/${encodeURIComponent(uploaded.id)}/artifacts/${encodeURIComponent(figure.id)}/crop.svg`);
  assert.match(crop, /<svg\b/);
  assert.match(crop, /<image href="data:image\/png;base64,/);
  assert.doesNotMatch(crop, /\/assets\/.+page-001\.png/);

  const analysisJobResult = await fetchJson(`${baseUrl}/api/papers/${encodeURIComponent(uploaded.id)}/analysis-jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      settings: {
        provider: "openai",
        baseUrl: "https://example.invalid/v1",
        model: "gpt-4.1-mini",
        apiKey: "sk-paperlens-upload-e2e",
        analysisProfile: "fast",
        taskBudgetUsd: 1,
      },
      useCache: false,
    }),
  });
  assert.equal(analysisJobResult.job.type, "analysis");
  assert.equal(analysisJobResult.job.status, "queued");
  assert.ok(analysisJobResult.job.total >= 1);

  const jobs = await fetchJson(`${baseUrl}/api/papers/${encodeURIComponent(uploaded.id)}/analysis-jobs`);
  assert.ok(jobs.jobs.some((job) => job.id === analysisJobResult.job.id));
  const job = await fetchJson(`${baseUrl}/api/jobs/${encodeURIComponent(analysisJobResult.job.id)}`);
  assert.equal(job.job.status, "queued");

  await stat(path.join(tempDir, "data", `${uploaded.id}.json`));
  await stat(path.join(tempDir, "uploads"));
  await stat(path.join(tempDir, "paper-assets", uploaded.id, "page-001.png"));
} finally {
  if (child) {
    await stopServer(child);
  }
  await rm(tempDir, { recursive: true, force: true });
}

function waitForServerUrl(processHandle) {
  let stdout = "";
  let stderr = "";
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`PaperLens test server did not start.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
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
      reject(new Error(`PaperLens test server exited early code=${code} signal=${signal}.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    });
  });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (error) {
    throw new Error(`Expected JSON from ${url}, got ${response.status}: ${text.slice(0, 300)} (${error.message})`);
  }
  if (!response.ok) {
    throw new Error(`Request failed ${response.status} ${url}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Request failed ${response.status} ${url}: ${text.slice(0, 300)}`);
  }
  return text;
}

function stopServer(processHandle) {
  if (processHandle.exitCode !== null || processHandle.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      processHandle.kill("SIGKILL");
      resolve();
    }, 5000);
    processHandle.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    processHandle.kill("SIGTERM");
  });
}
