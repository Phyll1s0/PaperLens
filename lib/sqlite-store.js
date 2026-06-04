import { mkdir } from "node:fs/promises";
import path from "node:path";

const SCHEMA_VERSION = 1;

export async function openPaperLensSqliteStore(options = {}) {
  const dbPath = path.resolve(options.dbPath || "data/paperlens.sqlite");
  await mkdir(path.dirname(dbPath), { recursive: true });

  let sqlite;
  try {
    sqlite = await import("node:sqlite");
  } catch (error) {
    throw new Error([
      "当前 Node.js 不支持 node:sqlite，无法启用 PAPERLENS_STORAGE=sqlite。",
      "请使用 Node.js 22.5+ 或 24+，或继续使用默认 JSON 存储。",
      `原始错误：${error.message}`,
    ].join(" "));
  }

  const db = new sqlite.DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(buildSchemaSql());

  const store = {
    dbPath,
    schemaVersion: SCHEMA_VERSION,
    close() {
      db.close();
    },
    loadPaper(id) {
      const row = db.prepare("SELECT json FROM papers WHERE id = ?").get(id);
      if (!row) {
        const error = new Error("Paper not found.");
        error.code = "ENOENT";
        throw error;
      }
      return parseJson(row.json, {});
    },
    listPapers() {
      return db.prepare("SELECT json FROM papers ORDER BY favorite DESC, updated_at DESC, created_at DESC").all()
        .map((row) => parseJson(row.json, {}))
        .filter((paper) => paper?.id);
    },
    savePaper(paper) {
      savePaperRecord(db, paper);
    },
    loadJobsPayload() {
      const jobs = db.prepare("SELECT json FROM jobs ORDER BY created_at ASC, id ASC").all()
        .map((row) => parseJson(row.json, null))
        .filter(Boolean);
      const meta = db.prepare("SELECT value FROM meta WHERE key = 'jobs_updated_at'").get();
      return {
        version: 1,
        updatedAt: meta?.value || "",
        jobs,
      };
    },
    saveJobsPayload(payload = {}) {
      saveJobsPayload(db, payload);
    },
    getStats() {
      return {
        papers: Number(db.prepare("SELECT COUNT(*) AS count FROM papers").get()?.count || 0),
        paragraphs: Number(db.prepare("SELECT COUNT(*) AS count FROM paragraphs").get()?.count || 0),
        jobs: Number(db.prepare("SELECT COUNT(*) AS count FROM jobs").get()?.count || 0),
      };
    },
  };

  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
  return store;
}

export function serializePaperForSqlite(paper = {}) {
  const paragraphs = Array.isArray(paper.paragraphs) ? paper.paragraphs : [];
  const analyzedCount = paragraphs.filter((paragraph) => paragraph.translation || paragraph.explanation).length;
  return {
    id: String(paper.id || ""),
    title: String(paper.title || ""),
    filename: String(paper.filename || ""),
    pageCount: Number(paper.pageCount || 0),
    status: String(paper.status || ""),
    segmentationMode: String(paper.segmentationMode || ""),
    favorite: paper.favorite ? 1 : 0,
    tagsJson: JSON.stringify(Array.isArray(paper.tags) ? paper.tags : []),
    readingProgressJson: JSON.stringify(paper.readingProgress || {}),
    exportHistoryJson: JSON.stringify(Array.isArray(paper.exportHistory) ? paper.exportHistory : []),
    paragraphCount: paragraphs.length,
    analyzedCount,
    createdAt: String(paper.createdAt || ""),
    updatedAt: String(paper.updatedAt || paper.createdAt || new Date().toISOString()),
    json: JSON.stringify(paper),
  };
}

export function serializeParagraphForSqlite(paperId, paragraph = {}, index = 0) {
  return {
    paperId,
    id: String(paragraph.id || `paragraph_${index + 1}`),
    orderIndex: Number.isFinite(Number(paragraph.order)) ? Number(paragraph.order) : index,
    sectionId: String(paragraph.sectionId || ""),
    kind: String(paragraph.kind || paragraph.type || ""),
    hidden: paragraph.hidden ? 1 : 0,
    pageNumber: Number(paragraph.pageNumber || paragraph.page || 0) || null,
    sourceText: String(paragraph.sourceText || paragraph.text || ""),
    translation: String(paragraph.translation || ""),
    explanation: String(paragraph.explanation || ""),
    status: String(paragraph.status || ""),
    json: JSON.stringify(paragraph),
  };
}

function savePaperRecord(db, paper) {
  const serialized = serializePaperForSqlite(paper);
  if (!serialized.id) {
    throw new Error("Paper id is required for SQLite persistence.");
  }

  const paragraphs = Array.isArray(paper.paragraphs) ? paper.paragraphs : [];
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO papers (
        id, title, filename, page_count, status, segmentation_mode, favorite,
        tags_json, reading_progress_json, export_history_json,
        paragraph_count, analyzed_count, created_at, updated_at, json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        filename = excluded.filename,
        page_count = excluded.page_count,
        status = excluded.status,
        segmentation_mode = excluded.segmentation_mode,
        favorite = excluded.favorite,
        tags_json = excluded.tags_json,
        reading_progress_json = excluded.reading_progress_json,
        export_history_json = excluded.export_history_json,
        paragraph_count = excluded.paragraph_count,
        analyzed_count = excluded.analyzed_count,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        json = excluded.json
    `).run(
      serialized.id,
      serialized.title,
      serialized.filename,
      serialized.pageCount,
      serialized.status,
      serialized.segmentationMode,
      serialized.favorite,
      serialized.tagsJson,
      serialized.readingProgressJson,
      serialized.exportHistoryJson,
      serialized.paragraphCount,
      serialized.analyzedCount,
      serialized.createdAt,
      serialized.updatedAt,
      serialized.json,
    );

    db.prepare("DELETE FROM paragraphs WHERE paper_id = ?").run(serialized.id);
    const insertParagraph = db.prepare(`
      INSERT INTO paragraphs (
        paper_id, id, order_index, section_id, kind, hidden, page_number,
        source_text, translation, explanation, status, json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    paragraphs.forEach((paragraph, index) => {
      const item = serializeParagraphForSqlite(serialized.id, paragraph, index);
      insertParagraph.run(
        item.paperId,
        item.id,
        item.orderIndex,
        item.sectionId,
        item.kind,
        item.hidden,
        item.pageNumber,
        item.sourceText,
        item.translation,
        item.explanation,
        item.status,
        item.json,
      );
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function saveJobsPayload(db, payload = {}) {
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM jobs").run();
    const insertJob = db.prepare(`
      INSERT INTO jobs (
        id, type, paper_id, status, created_at, updated_at, completed_at, json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const job of jobs) {
      if (!job?.id) {
        continue;
      }
      insertJob.run(
        String(job.id),
        String(job.type || ""),
        String(job.paperId || ""),
        String(job.status || ""),
        String(job.createdAt || ""),
        String(job.updatedAt || job.createdAt || ""),
        String(job.completedAt || ""),
        JSON.stringify(job),
      );
    }
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('jobs_updated_at', ?)").run(String(payload.updatedAt || new Date().toISOString()));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function buildSchemaSql() {
  return `
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS papers (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      filename TEXT NOT NULL DEFAULT '',
      page_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT '',
      segmentation_mode TEXT NOT NULL DEFAULT '',
      favorite INTEGER NOT NULL DEFAULT 0,
      tags_json TEXT NOT NULL DEFAULT '[]',
      reading_progress_json TEXT NOT NULL DEFAULT '{}',
      export_history_json TEXT NOT NULL DEFAULT '[]',
      paragraph_count INTEGER NOT NULL DEFAULT 0,
      analyzed_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS paragraphs (
      paper_id TEXT NOT NULL,
      id TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      section_id TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT '',
      hidden INTEGER NOT NULL DEFAULT 0,
      page_number INTEGER,
      source_text TEXT NOT NULL DEFAULT '',
      translation TEXT NOT NULL DEFAULT '',
      explanation TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      json TEXT NOT NULL,
      PRIMARY KEY (paper_id, id),
      FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT '',
      paper_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      completed_at TEXT NOT NULL DEFAULT '',
      json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_papers_updated_at ON papers(updated_at);
    CREATE INDEX IF NOT EXISTS idx_papers_favorite ON papers(favorite);
    CREATE INDEX IF NOT EXISTS idx_paragraphs_paper_order ON paragraphs(paper_id, order_index);
    CREATE INDEX IF NOT EXISTS idx_jobs_paper ON jobs(paper_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, updated_at);
  `;
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}
