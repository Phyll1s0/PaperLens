import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractPdfText,
  parsePopplerBboxLayout,
} from "../lib/pdf-extraction.js";

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.dirname(path.dirname(__filename));
const fixturePath = path.join(ROOT_DIR, "tests", "fixtures", "minimal-paper.pdf");

const fixture = await readFile(fixturePath);
assert.equal(fixture.subarray(0, 5).toString("utf8"), "%PDF-");
assert.match(fixture.toString("latin1"), /PaperLens Fixture/);

const pages = parsePopplerBboxLayout(`<?xml version="1.0" encoding="UTF-8"?>
<doc>
  <page width="300.000000" height="200.000000">
    <flow>
      <block xMin="72.0" yMin="40.0" xMax="235.0" yMax="62.0">
        <line>
          <word xMin="72.0" yMin="40.0" xMax="120.0" yMax="62.0">PaperLens</word>
          <word xMin="124.0" yMin="40.0" xMax="170.0" yMax="62.0">Fixture</word>
        </line>
      </block>
      <block xMin="72.0" yMin="68.0" xMax="245.0" yMax="90.0">
        <line>
          <word>Alpha</word>
          <word>&amp;</word>
          <word>Beta</word>
          <word>&lt;Gamma&gt;</word>
        </line>
      </block>
      <block xMin="72.0" yMin="96.0" xMax="225.0" yMax="118.0">
        <line>
          <word>Page</word>
          <word>1</word>
          <word>minimal</word>
          <word>PDF</word>
        </line>
      </block>
    </flow>
  </page>
</doc>`);

assert.equal(pages.length, 1);
assert.equal(pages[0].pageNumber, 1);
assert.equal(pages[0].width, 300);
assert.equal(pages[0].height, 200);
assert.equal(pages[0].imagePath, null);
assert.equal(pages[0].text, "PaperLens Fixture\n\nAlpha & Beta <Gamma>\n\nPage 1 minimal PDF");
assert.deepEqual(pages[0].blocks.map((block) => ({
  text: block.text,
  x: block.x,
  y: block.y,
  width: block.width,
  height: block.height,
  lineCount: block.lineCount,
})), [
  { text: "PaperLens Fixture", x: 72, y: 40, width: 163, height: 22, lineCount: 1 },
  { text: "Alpha & Beta <Gamma>", x: 72, y: 68, width: 173, height: 22, lineCount: 1 },
  { text: "Page 1 minimal PDF", x: 72, y: 96, width: 153, height: 22, lineCount: 1 },
]);

if (await commandExists("pdftotext")) {
  const extraction = await extractPdfText(fixturePath, "", "", {
    pdfEngine: "poppler",
    rootDir: ROOT_DIR,
  });
  assert.equal(extraction.pageCount, 1);
  assert.equal(extraction.pages.length, 1);
  assert.match(extraction.pages[0].text, /PaperLens Fixture/);
  assert.match(extraction.pages[0].text, /Alpha & Beta <Gamma>/);
  assert.match(extraction.pages[0].text, /Page 1 minimal PDF/);
} else {
  console.log("SKIP pdf-extraction poppler fixture run: pdftotext is not installed");
}

async function commandExists(command) {
  return new Promise((resolve) => {
    execFile("which", [command], (error) => {
      resolve(!error);
    });
  });
}
