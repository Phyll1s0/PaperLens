import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.dirname(path.dirname(__filename));
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "paperlens-portable-data-"));

const sourceData = path.join(tempRoot, "source-data");
const sourceUploads = path.join(tempRoot, "source-uploads");
const sourceAssets = path.join(tempRoot, "source-assets");
const targetData = path.join(tempRoot, "target-data");
const targetUploads = path.join(tempRoot, "target-uploads");
const targetAssets = path.join(tempRoot, "target-assets");
const cacheDir = path.join(tempRoot, "cache");
const outputDir = path.join(tempRoot, "exported-data");

await mkdir(sourceData, { recursive: true });
await mkdir(sourceUploads, { recursive: true });
await mkdir(sourceAssets, { recursive: true });
await mkdir(targetData, { recursive: true });
await mkdir(targetUploads, { recursive: true });
await mkdir(targetAssets, { recursive: true });

await writeFile(path.join(sourceData, "paper_test.json"), `${JSON.stringify({
  id: "paper_test",
  paragraphs: [{ id: "p1", sourceText: "hello" }],
})}\n`);
await writeFile(path.join(sourceData, "jobs.json"), "{\"jobs\":[]}\n");
await writeFile(path.join(sourceData, "secrets.json"), "{\"source\":\"secret\"}\n");
await writeFile(path.join(sourceUploads, "paper.pdf"), "pdf bytes");
await writeFile(path.join(sourceAssets, "page-001.png"), "png bytes");
await writeFile(path.join(targetData, "secrets.json"), "{\"target\":\"secret\"}\n");
await writeFile(path.join(targetUploads, "old.pdf"), "old");

const baseEnv = {
  ...process.env,
  PAPERLENS_DATA_DIR: sourceData,
  PAPERLENS_UPLOADS_DIR: sourceUploads,
  PAPERLENS_PAPER_ASSETS_DIR: sourceAssets,
  PAPERLENS_CACHE_DIR: cacheDir,
};

const exportOutput = JSON.parse(execFileSync("node", [
  "scripts/export-portable-data.mjs",
  "--output",
  outputDir,
  "--no-archive",
], {
  cwd: ROOT_DIR,
  env: baseEnv,
  encoding: "utf8",
}));

assert.equal(exportOutput.ok, true);
assert.equal(exportOutput.includeSecrets, false);
assert.equal(exportOutput.archivePath, "");
assert.equal(await exists(path.join(outputDir, "paperlens-data-manifest.json")), true);
assert.equal(await exists(path.join(outputDir, "data", "paper_test.json")), true);
assert.equal(await exists(path.join(outputDir, "data", "secrets.json")), false);

const importEnv = {
  ...process.env,
  PAPERLENS_DATA_DIR: targetData,
  PAPERLENS_UPLOADS_DIR: targetUploads,
  PAPERLENS_PAPER_ASSETS_DIR: targetAssets,
  PAPERLENS_CACHE_DIR: cacheDir,
};

const dryRun = JSON.parse(execFileSync("node", [
  "scripts/import-portable-data.mjs",
  outputDir,
], {
  cwd: ROOT_DIR,
  env: importEnv,
  encoding: "utf8",
}));
assert.equal(dryRun.dryRun, true);

const importOutput = JSON.parse(execFileSync("node", [
  "scripts/import-portable-data.mjs",
  outputDir,
  "--yes",
], {
  cwd: ROOT_DIR,
  env: importEnv,
  encoding: "utf8",
}));

assert.equal(importOutput.ok, true);
assert.equal(await exists(path.join(targetData, "paper_test.json")), true);
assert.equal(await readFile(path.join(targetData, "secrets.json"), "utf8"), "{\"target\":\"secret\"}\n");
assert.equal(await readFile(path.join(targetUploads, "paper.pdf"), "utf8"), "pdf bytes");
assert.equal(await readFile(path.join(targetAssets, "page-001.png"), "utf8"), "png bytes");
assert.equal(await exists(path.join(importOutput.backupDir, "uploads", "old.pdf")), true);

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
