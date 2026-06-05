import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.dirname(path.dirname(__filename));
const PACKAGE_NAME = "PaperLens-local";
const outRoot = path.resolve(process.env.PAPERLENS_PACKAGE_OUT_DIR || path.join(ROOT_DIR, "dist"));
const packageDir = path.join(outRoot, PACKAGE_NAME);
const archivePath = path.join(outRoot, `${PACKAGE_NAME}.tar.gz`);

const excludeNames = new Set([
  ".cache",
  ".git",
  ".github",
  "data",
  "dist",
  "node_modules",
  "paper-assets",
  "tests",
  "uploads",
]);
const excludeFiles = new Set([
  ".env",
  "TODO.md",
]);
const excludeExtensions = new Set([
  ".pdf",
  ".sqlite",
  ".sqlite-shm",
  ".sqlite-wal",
  ".log",
]);

await rm(packageDir, { recursive: true, force: true });
await mkdir(packageDir, { recursive: true });

await copyProject(ROOT_DIR, packageDir);
await writeLaunchers(packageDir);
await writeStartHere(packageDir);

const archive = await createArchive();
const digest = await hashFile(archivePath).catch(() => "");

console.log(JSON.stringify({
  ok: true,
  packageDir,
  archivePath: archive.created ? archivePath : "",
  archiveCreated: archive.created,
  archiveSha256: digest,
  start: {
    macOS: "Double-click PaperLens.command",
    windows: "Double-click PaperLens.cmd",
    linux: "Run ./PaperLens.sh",
  },
}, null, 2));

async function copyProject(sourceDir, targetDir) {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (shouldExclude(entry.name)) {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await mkdir(targetPath, { recursive: true });
      await copyProject(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await copyFile(sourcePath, targetPath);
    }
  }
}

function shouldExclude(name) {
  if (excludeNames.has(name) || excludeFiles.has(name)) {
    return true;
  }
  const ext = path.extname(name).toLowerCase();
  return excludeExtensions.has(ext) || name.endsWith(".ocr.pdf");
}

async function writeLaunchers(targetDir) {
  const unixLauncher = `#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "PaperLens needs Node.js 20 or newer."
  echo "Install it from https://nodejs.org/ and run this launcher again."
  read -r -p "Press Enter to close..."
  exit 1
fi

node scripts/paperlens-app.mjs
`;
  await writeFile(path.join(targetDir, "PaperLens.command"), unixLauncher);
  await chmod(path.join(targetDir, "PaperLens.command"), 0o755);
  await writeFile(path.join(targetDir, "PaperLens.sh"), unixLauncher);
  await chmod(path.join(targetDir, "PaperLens.sh"), 0o755);

  await writeFile(path.join(targetDir, "PaperLens.cmd"), `@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo PaperLens needs Node.js 20 or newer.
  echo Install it from https://nodejs.org/ and run this launcher again.
  pause
  exit /b 1
)
node scripts\\paperlens-app.mjs
pause
`);
}

async function writeStartHere(targetDir) {
  const packageJson = JSON.parse(await readFile(path.join(ROOT_DIR, "package.json"), "utf8"));
  await writeFile(path.join(targetDir, "README-START-HERE.txt"), [
    `PaperLens ${packageJson.version || ""}`,
    "",
    "Start:",
    "- macOS: double-click PaperLens.command",
    "- Windows: double-click PaperLens.cmd",
    "- Linux: run ./PaperLens.sh",
    "",
    "Requirements:",
    "- Node.js 20 or newer",
    "- A model API Key",
    "- Optional enhancement for better PDF layout/images: Poppler",
    "- Optional enhancement for scanned PDFs: OCRmyPDF and Tesseract",
    "",
    "Private data:",
    "- This package intentionally excludes .env, data/, uploads/, paper-assets/, .cache/, PDFs, SQLite files, and logs.",
    "- API keys are only stored on the user's machine after they enter them in the app.",
    "",
    "Tutorial:",
    "- Follow docs/USAGE.md for the full paper-reading workflow.",
    "- Follow docs/GETTING_STARTED.md for first-run setup.",
    "- Follow docs/PDF_STRATEGY.md for why PDF tools are optional and how AI-first layout can fit later.",
    "- Follow docs/README.md for all documentation.",
    "- README.md contains only the short project overview and command reference.",
    "",
    "Advanced:",
    "- Edit .env to set PORT, PAPERLENS_STORAGE, proxy, OCR language, or access token.",
    "- Run npm run storage:migrate:sqlite before enabling PAPERLENS_STORAGE=sqlite.",
    "",
  ].join("\n"));
}

async function createArchive() {
  try {
    await runCommand("tar", ["-czf", archivePath, "-C", outRoot, PACKAGE_NAME]);
    return { created: true };
  } catch (error) {
    console.warn(`Archive was not created: ${error.message}`);
    return { created: false };
  }
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT_DIR,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
      }
    });
  });
}

async function hashFile(filePath) {
  await stat(filePath);
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", resolve);
  });
  return hash.digest("hex");
}
