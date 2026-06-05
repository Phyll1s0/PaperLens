import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.dirname(path.dirname(__filename));
const tempDir = await mkdtemp(path.join(os.tmpdir(), "paperlens-local-package-"));

try {
  const config = JSON.parse(await execFileText(process.execPath, [
    "scripts/paperlens-app.mjs",
    "--print-config",
    "--no-open",
  ], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PORT: "4567",
    },
  }));
  assert.equal(config.port, 4567);
  assert.equal(config.openBrowser, false);
  assert.match(config.url, /127\.0\.0\.1:4567/);

  const output = JSON.parse(await execFileText(process.execPath, ["scripts/package-local-app.mjs"], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PAPERLENS_PACKAGE_OUT_DIR: tempDir,
    },
    maxBuffer: 10 * 1024 * 1024,
  }));

  assert.equal(output.ok, true);
  assert.equal(output.packageDir, path.join(tempDir, "PaperLens-local"));
  await stat(path.join(output.packageDir, "PaperLens.command"));
  await stat(path.join(output.packageDir, "PaperLens.cmd"));
  await stat(path.join(output.packageDir, "PaperLens.sh"));
  await stat(path.join(output.packageDir, "scripts", "paperlens-app.mjs"));
  await stat(path.join(output.packageDir, "public", "index.html"));
  await stat(path.join(output.packageDir, "docs", "README.md"));
  await stat(path.join(output.packageDir, "docs", "USAGE.md"));
  await stat(path.join(output.packageDir, "docs", "GETTING_STARTED.md"));
  await stat(path.join(output.packageDir, "docs", "PDF_STRATEGY.md"));

  await assert.rejects(() => stat(path.join(output.packageDir, "data")));
  await assert.rejects(() => stat(path.join(output.packageDir, "uploads")));
  await assert.rejects(() => stat(path.join(output.packageDir, "paper-assets")));
  await assert.rejects(() => stat(path.join(output.packageDir, ".env")));
  await assert.rejects(() => stat(path.join(output.packageDir, "TODO.md")));
  await assert.rejects(() => stat(path.join(output.packageDir, "tests")));

  const startHere = await readFile(path.join(output.packageDir, "README-START-HERE.txt"), "utf8");
  assert.match(startHere, /Node\.js 20/);
  assert.match(startHere, /PaperLens\.command/);
  assert.match(startHere, /docs\/USAGE\.md/);
  assert.match(startHere, /docs\/GETTING_STARTED\.md/);
  assert.match(startHere, /docs\/PDF_STRATEGY\.md/);
  assert.match(startHere, /docs\/README\.md/);

  if (output.archiveCreated) {
    await stat(output.archivePath);
    assert.match(output.archiveSha256, /^[a-f0-9]{64}$/);
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function execFileText(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}
