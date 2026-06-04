import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  openPaperLensSqliteStore,
} from "../lib/sqlite-store.js";

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.dirname(path.dirname(__filename));
const DATA_DIR = path.resolve(process.env.PAPERLENS_DATA_DIR || path.join(ROOT_DIR, "data"));
const SQLITE_PATH = path.resolve(process.env.PAPERLENS_SQLITE_PATH || path.join(DATA_DIR, "paperlens.sqlite"));

await mkdir(DATA_DIR, { recursive: true });

const store = await openPaperLensSqliteStore({ dbPath: SQLITE_PATH });
let papers = 0;
let paragraphs = 0;
let skipped = 0;

try {
  const files = await readdir(DATA_DIR).catch(() => []);
  for (const file of files) {
    if (!file.endsWith(".json") || file === "jobs.json" || file === "secrets.json") {
      continue;
    }

    const filePath = path.join(DATA_DIR, file);
    try {
      const paper = JSON.parse(await readFile(filePath, "utf8"));
      if (!paper?.id || !Array.isArray(paper.paragraphs)) {
        skipped += 1;
        continue;
      }
      store.savePaper(paper);
      papers += 1;
      paragraphs += paper.paragraphs.length;
    } catch (error) {
      skipped += 1;
      console.warn(`SKIP ${file}: ${error.message}`);
    }
  }

  const jobsPath = path.join(DATA_DIR, "jobs.json");
  let jobs = 0;
  try {
    const jobsPayload = JSON.parse(await readFile(jobsPath, "utf8"));
    store.saveJobsPayload(jobsPayload);
    jobs = Array.isArray(jobsPayload.jobs) ? jobsPayload.jobs.length : 0;
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`SKIP jobs.json: ${error.message}`);
    }
    store.saveJobsPayload({ version: 1, updatedAt: new Date().toISOString(), jobs: [] });
  }

  const secretsPath = path.join(DATA_DIR, "secrets.json");
  try {
    await copyFile(secretsPath, `${SQLITE_PATH}.secrets-json-copy`);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`SKIP secrets copy: ${error.message}`);
    }
  }

  const stats = store.getStats();
  console.log(JSON.stringify({
    ok: true,
    sqlitePath: SQLITE_PATH,
    imported: {
      papers,
      paragraphs,
      jobs,
      skipped,
    },
    sqliteStats: stats,
    next: "Set PAPERLENS_STORAGE=sqlite and restart PaperLens to use this database.",
  }, null, 2));
} finally {
  store.close();
}
