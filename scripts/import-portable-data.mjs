import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.dirname(path.dirname(__filename));
const TIMESTAMP = formatTimestamp(new Date());
const args = parseArgs(process.argv.slice(2));
const sourceArg = args.positionals[0] || "";

if (!sourceArg) {
  fail("Usage: npm run data:import -- <export-dir-or-paperlens-data.tar.gz> [--yes] [--include-secrets]");
}

const DATA_DIR = path.resolve(process.env.PAPERLENS_DATA_DIR || path.join(ROOT_DIR, "data"));
const UPLOADS_DIR = path.resolve(process.env.PAPERLENS_UPLOADS_DIR || path.join(ROOT_DIR, "uploads"));
const ASSETS_DIR = path.resolve(process.env.PAPERLENS_PAPER_ASSETS_DIR || path.join(ROOT_DIR, "paper-assets"));
const CACHE_DIR = path.resolve(process.env.PAPERLENS_CACHE_DIR || path.join(ROOT_DIR, ".cache"));
const BACKUP_DIR = path.resolve(args.values.backup || path.join(CACHE_DIR, `paperlens-import-backup-${TIMESTAMP}`));
const includeSecrets = Boolean(args.flags["include-secrets"]);
const confirmed = Boolean(args.flags.yes);

const preparedSource = await prepareSource(path.resolve(sourceArg));
const manifestPath = path.join(preparedSource, "paperlens-data-manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest?.type !== "paperlens-portable-data") {
  fail(`Not a PaperLens portable data export: ${manifestPath}`);
}

const plan = {
  source: preparedSource,
  backupDir: BACKUP_DIR,
  includeSecrets,
  targets: {
    data: DATA_DIR,
    uploads: UPLOADS_DIR,
    paperAssets: ASSETS_DIR,
  },
  importedManifest: {
    appVersion: manifest.appVersion || "",
    exportedAt: manifest.exportedAt || "",
    includeSecrets: Boolean(manifest.includeSecrets),
    copied: manifest.copied || {},
  },
};

if (!confirmed) {
  console.log(JSON.stringify({
    ok: true,
    dryRun: true,
    plan,
    next: "Run again with --yes to import. Add --include-secrets only when this is your own trusted backup.",
  }, null, 2));
  process.exit(0);
}

await mkdir(BACKUP_DIR, { recursive: true });
await backupExistingTarget(DATA_DIR, path.join(BACKUP_DIR, "data"));
await backupExistingTarget(UPLOADS_DIR, path.join(BACKUP_DIR, "uploads"));
await backupExistingTarget(ASSETS_DIR, path.join(BACKUP_DIR, "paper-assets"));

await replaceDirectory(path.join(preparedSource, "data"), DATA_DIR, {
  skip: (relativePath) => !includeSecrets && relativePath.split(path.sep).join("/") === "secrets.json",
});
if (!includeSecrets) {
  await restoreExistingSecrets(path.join(BACKUP_DIR, "data", "secrets.json"), path.join(DATA_DIR, "secrets.json"));
}
await replaceDirectory(path.join(preparedSource, "uploads"), UPLOADS_DIR);
await replaceDirectory(path.join(preparedSource, "paper-assets"), ASSETS_DIR);

console.log(JSON.stringify({
  ok: true,
  imported: {
    source: preparedSource,
    includeSecrets,
    manifest: manifest.copied || {},
  },
  backupDir: BACKUP_DIR,
  next: [
    "Restart PaperLens.",
    "Run npm run health.",
    includeSecrets
      ? "If secrets were encrypted, keep PAPERLENS_SECRET_KEY/PAPERLENS_ACCESS_TOKEN compatible."
      : "Open the model settings page and re-enter API keys if needed.",
  ],
}, null, 2));

async function prepareSource(sourcePath) {
  const info = await stat(sourcePath).catch(() => null);
  if (!info) {
    fail(`Source not found: ${sourcePath}`);
  }
  if (info.isDirectory()) {
    return resolveExportDirectory(sourcePath);
  }
  if (info.isFile() && /\.tar\.gz$/i.test(sourcePath)) {
    const extractDir = path.join(CACHE_DIR, `paperlens-import-extract-${TIMESTAMP}`);
    await mkdir(extractDir, { recursive: true });
    const result = spawnSync("tar", ["-xzf", sourcePath, "-C", extractDir], {
      cwd: ROOT_DIR,
      encoding: "utf8",
      shell: false,
    });
    if (result.status !== 0) {
      fail(`Cannot extract archive: ${result.stderr || result.stdout || "tar failed"}`);
    }
    return resolveExportDirectory(extractDir);
  }
  fail(`Unsupported source. Use an export directory or .tar.gz file: ${sourcePath}`);
}

async function resolveExportDirectory(sourcePath) {
  if (existsSync(path.join(sourcePath, "paperlens-data-manifest.json"))) {
    return sourcePath;
  }

  const entries = await readdir(sourcePath, { withFileTypes: true }).catch(() => []);
  const candidates = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(sourcePath, entry.name))
    .filter((dir) => existsSync(path.join(dir, "paperlens-data-manifest.json")));
  if (candidates.length === 1) {
    return candidates[0];
  }
  fail(`Cannot find paperlens-data-manifest.json in ${sourcePath}`);
}

async function backupExistingTarget(sourceDir, targetDir) {
  if (!existsSync(sourceDir)) {
    return;
  }
  await copyDirectory(sourceDir, targetDir);
}

async function replaceDirectory(sourceDir, targetDir, options = {}) {
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  await copyDirectory(sourceDir, targetDir, options);
}

async function restoreExistingSecrets(sourcePath, targetPath) {
  if (!existsSync(sourcePath)) {
    return;
  }
  await mkdir(path.dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
}

async function copyDirectory(sourceDir, targetDir, options = {}) {
  if (!existsSync(sourceDir)) {
    await mkdir(targetDir, { recursive: true });
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

function parseArgs(argv) {
  const flags = {};
  const values = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (key === "backup") {
      values.backup = argv[index + 1] || "";
      index += 1;
    } else {
      flags[key] = true;
    }
  }
  return { flags, values, positionals };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function formatTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
