import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPaperSegmentationDebugReport,
} from "../lib/segmentation-debug.js";
import {
  endsWithSentence,
  shouldMergeSegmentedText,
  stripPublicationMetadataFragments,
} from "../lib/segmentation-repair.js";

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.dirname(path.dirname(__filename));
const fixturePath = path.join(ROOT_DIR, "tests", "fixtures", "real-segmentation-cases.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));

assert.equal(fixture.version, 1);
assert.equal(fixture.cases.length, 3);

for (const item of fixture.cases) {
  const report = buildPaperSegmentationDebugReport({
    id: item.id,
    title: item.title,
    filename: item.filename,
    extractionPages: item.pages,
    paragraphs: [],
    sections: [],
  }, {
    now: () => new Date("2026-06-04T00:00:00.000Z"),
  });

  assert.equal(report.summary.pages, item.pages.length, item.id);
  assert.ok(report.summary.extractionBlocks >= 10, item.id);

  for (const expected of item.expect.dropped || []) {
    const block = findDebugBlock(report, expected.page, expected.includes);
    assert.equal(block.decision, "drop", `${item.id}: ${expected.includes}`);
    assert.ok(
      block.reasons.includes(expected.reason),
      `${item.id}: expected ${expected.reason} for ${expected.includes}, got ${block.reasons.join(", ")}`,
    );
  }

  for (const expected of item.expect.rescued || []) {
    const block = findDebugBlock(report, expected.page, expected.includes, { rescued: true });
    assert.ok(block.rescuedSegments.some((segment) => segment.preview.includes(expected.includes)), `${item.id}: rescue ${expected.includes}`);
  }

  for (const title of item.expect.headings || []) {
    assert.ok(
      report.pages.some((page) => page.blocks.some((block) =>
        block.decision === "keep" &&
        block.tags.includes("heading-candidate") &&
        block.tags.includes(title))),
      `${item.id}: missing heading ${title}`,
    );
  }

  for (const expected of item.expect.cleanNotIncludes || []) {
    const block = findDebugBlock(report, expected.page, expected.includes);
    assert.ok(block.cleanText.includes(expected.includes), `${item.id}: clean block ${expected.includes}`);
    assert.equal(block.cleanText.includes(expected.notIncludes), false, `${item.id}: should strip ${expected.notIncludes}`);
  }

  for (const pair of item.expect.continuationPairs || []) {
    const left = normalizeFixtureText(findFixtureBlock(item, pair.left).text);
    const right = normalizeFixtureText(findFixtureBlock(item, pair.right).text);
    assert.equal(
      shouldMergeSegmentedText(left, right, { sameSection: true }),
      true,
      `${item.id}: expected continuation merge ${pair.left.includes} -> ${pair.right.includes}`,
    );
  }

  for (const pair of item.expect.openEndedContinuations || []) {
    const left = normalizeFixtureText(findFixtureBlock(item, pair.left).text);
    const right = normalizeFixtureText(findFixtureBlock(item, pair.right).text);
    assert.equal(endsWithSentence(left), false, `${item.id}: left side should be open-ended`);
    assert.ok(right.length > 80, `${item.id}: right continuation should be substantive`);
  }
}

function findDebugBlock(report, pageNumber, needle, options = {}) {
  const page = report.pages.find((item) => Number(item.pageNumber) === Number(pageNumber));
  assert.ok(page, `missing debug page ${pageNumber}`);
  const block = page.blocks.find((candidate) => {
    const haystack = [
      candidate.preview,
      candidate.rawPreview,
      candidate.cleanText,
      ...(candidate.rescuedSegments || []).map((segment) => segment.preview),
    ].join(" ");
    if (!haystack.includes(needle)) {
      return false;
    }
    return !options.rescued || (candidate.rescuedSegments || []).length > 0;
  });
  assert.ok(block, `missing debug block "${needle}" on page ${pageNumber}`);
  return block;
}

function findFixtureBlock(item, target) {
  const page = item.pages.find((candidate) => Number(candidate.pageNumber) === Number(target.page));
  assert.ok(page, `${item.id}: missing fixture page ${target.page}`);
  const block = page.blocks.find((candidate) => String(candidate.text || "").includes(target.includes));
  assert.ok(block, `${item.id}: missing fixture block ${target.includes}`);
  return block;
}

function normalizeFixtureText(text) {
  return stripPublicationMetadataFragments(text)
    .replace(/[ \t]*\n[ \t]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
