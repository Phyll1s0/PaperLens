import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  openPaperLensSqliteStore,
  serializePaperForSqlite,
  serializeParagraphForSqlite,
} from "../lib/sqlite-store.js";

if (!(await hasNodeSqlite())) {
  console.log("SKIP sqlite-store: node:sqlite is not available in this Node.js runtime");
} else {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "paperlens-sqlite-store-"));
  const dbPath = path.join(tempDir, "paperlens.sqlite");
  const store = await openPaperLensSqliteStore({ dbPath });

  try {
    const paper = {
      id: "paper_1780000000000_abcdef12",
      title: "SQLite Fixture",
      filename: "fixture.pdf",
      pageCount: 2,
      status: "ready",
      segmentationMode: "layout",
      favorite: true,
      tags: ["db", "test"],
      readingProgress: { currentParagraphId: "p2" },
      exportHistory: [{ id: "export_1", type: "markdown", createdAt: "2026-06-04T10:00:00.000Z" }],
      createdAt: "2026-06-04T09:00:00.000Z",
      updatedAt: "2026-06-04T10:00:00.000Z",
      paragraphs: [
        {
          id: "p1",
          order: 0,
          kind: "paragraph",
          pageNumber: 1,
          sourceText: "The first paragraph explains the database migration.",
          translation: "第一段翻译",
          explanation: "第一段讲解",
        },
        {
          id: "p2",
          order: 1,
          hidden: true,
          sourceText: "A hidden paragraph.",
        },
      ],
    };

    const serialized = serializePaperForSqlite(paper);
    assert.equal(serialized.id, paper.id);
    assert.equal(serialized.favorite, 1);
    assert.equal(serialized.paragraphCount, 2);
    assert.equal(serialized.analyzedCount, 1);

    const paragraph = serializeParagraphForSqlite(paper.id, paper.paragraphs[0], 0);
    assert.equal(paragraph.paperId, paper.id);
    assert.equal(paragraph.sourceText, paper.paragraphs[0].sourceText);

    store.savePaper(paper);
    assert.deepEqual(store.loadPaper(paper.id).paragraphs.map((item) => item.id), ["p1", "p2"]);
    assert.equal(store.listPapers()[0].id, paper.id);

    store.saveJobsPayload({
      version: 1,
      updatedAt: "2026-06-04T11:00:00.000Z",
      jobs: [{
        id: "job_1",
        type: "analysis",
        paperId: paper.id,
        status: "queued",
        createdAt: "2026-06-04T10:30:00.000Z",
        updatedAt: "2026-06-04T10:30:00.000Z",
      }],
    });
    assert.equal(store.loadJobsPayload().jobs[0].id, "job_1");
    assert.deepEqual(store.getStats(), {
      papers: 1,
      paragraphs: 2,
      jobs: 1,
    });
  } finally {
    store.close();
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function hasNodeSqlite() {
  try {
    await import("node:sqlite");
    return true;
  } catch {
    return false;
  }
}
