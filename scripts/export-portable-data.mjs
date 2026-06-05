import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.dirname(path.dirname(__filename));
const PACKAGE_JSON = JSON.parse(await readText(path.join(ROOT_DIR, "package.json"), "{}"));
const TIMESTAMP = formatTimestamp(new Date());
const args = parseArgs(process.argv.slice(2));

const DATA_DIR = path.resolve(process.env.PAPERLENS_DATA_DIR || path.join(ROOT_DIR, "data"));
const UPLOADS_DIR = path.resolve(process.env.PAPERLENS_UPLOADS_DIR || path.join(ROOT_DIR, "uploads"));
const ASSETS_DIR = path.resolve(process.env.PAPERLENS_PAPER_ASSETS_DIR || path.join(ROOT_DIR, "paper-assets"));
const DIST_DIR = path.resolve(process.env.PAPERLENS_DIST_DIR || path.join(ROOT_DIR, "dist"));
const includeSecrets = Boolean(args.flags["include-secrets"]);
const noArchive = Boolean(args.flags["no-archive"]);
const outputDir = path.resolve(args.values.output || path.join(DIST_DIR, `paperlens-data-${TIMESTAMP}`));
const archivePath = `${outputDir}.tar.gz`;

await mkdir(outputDir, { recursive: true });

const copied = {
  dataFiles: await copyDirectory(DATA_DIR, path.join(outputDir, "data"), {
    skip: (relativePath) => shouldSkipDataPath(relativePath, includeSecrets),
  }),
  uploadsFiles: await copyDirectory(UPLOADS_DIR, path.join(outputDir, "uploads")),
  paperAssetsFiles: await copyDirectory(ASSETS_DIR, path.join(outputDir, "paper-assets")),
};

const manifest = {
  type: "paperlens-portable-data",
  version: 1,
  appVersion: PACKAGE_JSON.version || "",
  exportedAt: new Date().toISOString(),
  includeSecrets,
  source: {
    rootDir: ROOT_DIR,
    dataDir: DATA_DIR,
    uploadsDir: UPLOADS_DIR,
    paperAssetsDir: ASSETS_DIR,
  },
  copied,
  restore: {
    command: "npm run data:import -- <export-dir-or-tar.gz> --yes",
    secrets: includeSecrets
      ? "secrets.json is included. Keep PAPERLENS_SECRET_KEY/PAPERLENS_ACCESS_TOKEN compatible when using encrypted secrets."
      : "secrets.json and .env are not included. Re-enter API keys in the target instance.",
  },
};

await writeFile(path.join(outputDir, "paperlens-data-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

let archiveCreated = false;
if (!noArchive) {
  archiveCreated = createTarGz(outputDir, archivePath);
}

console.log(JSON.stringify({
  ok: true,
  outputDir,
  archivePath: archiveCreated ? archivePath : "",
  includeSecrets,
  copied,
  next: [
    archiveCreated
      ? `Move ${archivePath} to another machine.`
      : `Move ${outputDir} to another machine.`,
    "On the target: clone PaperLens, run npm install && npm run setup, then import this data.",
    "Import command: npm run data:import -- <export-dir-or-tar.gz> --yes",
  ],
}, null, 2));

async function copyDirectory(sourceDir, targetDir, options = {}) {
  if (!existsSync(sourceDir)) {
    return 0;
  }

  await mkdir(targetDir, { recursive: true });
  let files = 0;
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    const relativePath = path.relative(sourceDir, sourcePath);
    if (options.skip?.(relativePath, entry)) {
      continue;
    }
    if (entry.isDirectory()) {
      files += await copyDirectory(sourcePath, targetPath, options);
    } else if (entry.isFile()) {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await copyFile(sourcePath, targetPath);
      files += 1;
    }
  }
  return files;
}

function shouldSkipDataPath(relativePath, allowSecrets) {
  const normalized = relativePath.split(path.sep).join("/");
  if (!allowSecrets && normalized === "secrets.json") {
    return true;
  }
  if (normalized.startsWith(".backups/")) {
    return true;
  }
  return normalized.endsWith(".tmp") || normalized.includes(".tmp-");
}

function createTarGz(sourceDir, targetPath) {
  const parent = path.dirname(sourceDir);
  const basename = path.basename(sourceDir);
  const result = spawnSync("tar", ["-czf", targetPath, "-C", parent, basename], {
    cwd: ROOT_DIR,
    encoding: "utf8",
    shell: false,
  });
  if (result.status === 0) {
    return true;
  }
  console.warn(`WARN archive skipped: ${result.stderr || result.stdout || "tar command failed"}`.trim());
  return false;
}

function parseArgs(argv) {
  const flags = {};
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    if (key === "output") {
      values.output = argv[index + 1] || "";
      index += 1;
    } else {
      flags[key] = true;
    }
  }
  return { flags, values };
}

async function readText(filePath, fallback) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return fallback;
  }
}

function formatTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
