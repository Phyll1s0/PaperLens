import { copyFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  openPaperLensSqliteStore,
} from "../lib/sqlite-store.js";

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.dirname(path.dirname(__filename));
const DATA_DIR = path.resolve(process.env.PAPERLENS_DATA_DIR || path.join(ROOT_DIR, "data"));
const SQLITE_PATH = path.resolve(process.env.PAPERLENS_SQLITE_PATH || path.join(DATA_DIR, "paperlens.sqlite"));
const EXPORT_DIR = path.resolve(
  process.env.PAPERLENS_JSON_EXPORT_DIR ||
    path.join(DATA_DIR, `.sqlite-rollback-${formatTimestamp(new Date())}`),
);

await mkdir(EXPORT_DIR, { recursive: true });

const store = await openPaperLensSqliteStore({ dbPath: SQLITE_PATH });
try {
  const papers = store.listPapers();
  for (const paper of papers) {
    await writeJsonAtomic(path.join(EXPORT_DIR, `${paper.id}.json`), paper);
  }

  const jobsPayload = store.loadJobsPayload();
  await writeJsonAtomic(path.join(EXPORT_DIR, "jobs.json"), jobsPayload);

  const secretsPath = path.join(DATA_DIR, "secrets.json");
  try {
    await copyFile(secretsPath, path.join(EXPORT_DIR, "secrets.json"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`SKIP secrets copy: ${error.message}`);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    sqlitePath: SQLITE_PATH,
    exportDir: EXPORT_DIR,
    exported: {
      papers: papers.length,
      jobs: Array.isArray(jobsPayload.jobs) ? jobsPayload.jobs.length : 0,
    },
    rollback: [
      "Stop PaperLens.",
      `Use this JSON directory as PAPERLENS_DATA_DIR: ${EXPORT_DIR}`,
      "Unset PAPERLENS_STORAGE or set PAPERLENS_STORAGE=json.",
      "Restart PaperLens.",
    ],
  }, null, 2));
} finally {
  store.close();
}

async function writeJsonAtomic(filePath, payload) {
  const tempPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`);
  await rename(tempPath, filePath);
}

function formatTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
