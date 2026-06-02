import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.dirname(path.dirname(__filename));
const args = new Set(process.argv.slice(2));
const checkOnly = args.has("--check");
const force = args.has("--force");
const envPath = path.join(ROOT_DIR, ".env");
const envExamplePath = path.join(ROOT_DIR, ".env.example");

const checks = [];

function main() {
  printHeader();
  ensureRuntime();
  ensureDirectories();
  ensureEnvFile();
  checkCommand("npm", ["--version"], "npm");
  checkCommand("docker", ["--version"], "Docker");
  checkCommand("pdftotext", ["-v"], "Poppler pdftotext");
  checkCommand("pdftoppm", ["-v"], "Poppler pdftoppm");
  checkCommand("claude", ["--version"], "Claude Code CLI");
  printSummary();
}

function printHeader() {
  console.log("PaperLens setup");
  console.log(`Workspace: ${ROOT_DIR}`);
  if (checkOnly) {
    console.log("Mode: check only");
  }
}

function ensureRuntime() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 20) {
    checks.push({ label: "Node.js >= 20", ok: false, note: `current ${process.version}` });
    return;
  }

  checks.push({ label: "Node.js >= 20", ok: true, note: process.version });
}

function ensureDirectories() {
  const dirs = ["uploads", "data", "paper-assets", ".cache"];
  for (const dir of dirs) {
    const target = path.join(ROOT_DIR, dir);
    if (!checkOnly) {
      mkdirSync(target, { recursive: true });
    }
    checks.push({
      label: `${dir}/`,
      ok: checkOnly ? existsSync(target) : true,
      note: checkOnly && !existsSync(target) ? "will be created by npm run setup" : "ready",
    });
  }
}

function ensureEnvFile() {
  if (!existsSync(envExamplePath)) {
    checks.push({ label: ".env.example", ok: false, note: "missing" });
    return;
  }

  if (existsSync(envPath) && !force) {
    checks.push({ label: ".env", ok: true, note: "already exists" });
    return;
  }

  if (checkOnly) {
    checks.push({
      label: ".env",
      ok: existsSync(envPath),
      note: existsSync(envPath) ? "already exists" : "will be created by npm run setup",
    });
    return;
  }

  const template = readFileSync(envExamplePath, "utf8");
  writeFileSync(envPath, template, { mode: 0o600 });
  checks.push({ label: ".env", ok: true, note: force ? "rewritten from template" : "created from template" });
}

function checkCommand(command, versionArgs, label) {
  const result = spawnSync(command, versionArgs, {
    cwd: ROOT_DIR,
    encoding: "utf8",
    shell: false,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`.split("\n")[0].trim();
  checks.push({
    label,
    ok: result.status === 0,
    note: result.status === 0 ? output || "available" : "not found or not configured",
  });
}

function printSummary() {
  console.log("");
  for (const check of checks) {
    console.log(`${check.ok ? "OK " : "WARN"} ${check.label}: ${check.note}`);
  }

  console.log("");
  console.log("Next:");
  console.log("  npm run dev");
  console.log("  open http://127.0.0.1:3000");
  console.log("");
  console.log("Docker:");
  console.log("  docker compose up -d --build");
  console.log("");
  console.log("Optional:");
  console.log("  edit .env for PAPERLENS_PROXY_URL or PAPERLENS_CLAUDE_CLI");
}

main();
