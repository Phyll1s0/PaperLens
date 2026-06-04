import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import {
  extractPdfWithPoppler,
  readPngSize,
} from "../lib/pdf-extraction.js";
import {
  buildArtifactCropSvg,
  enhancePagesWithVisualStructure,
  extractPageArtifacts,
} from "../lib/visual-artifacts.js";
import {
  buildVisualRebuildStats,
} from "../lib/visual-rebuild-summary.js";

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.dirname(path.dirname(__filename));
const fixturePath = path.join(ROOT_DIR, "tests", "fixtures", "minimal-paper.pdf");
const assetPublicBase = "/assets/visual-fixture";
const tempDir = await mkdtemp(path.join(os.tmpdir(), "paperlens-visual-fixture-"));
const requirePoppler = parseBooleanEnv(process.env.PAPERLENS_REQUIRE_POPPLER);

try {
  const assetDir = path.join(tempDir, "assets");
  const extraction = await extractPdfWithPoppler(fixturePath, assetDir, assetPublicBase, {
    rootDir: ROOT_DIR,
    runCommandText: async (command, args) => {
      if (command === "pdftotext") {
        assert.equal(args.at(-2), fixturePath);
        return buildFixtureBboxXml();
      }

      if (command === "pdftoppm") {
        const outputPrefix = args.at(-1);
        await writeFile(`${outputPrefix}-1.png`, makeFixturePng(300, 200, [
          { x: 64, y: 58, width: 64, height: 38 },
          { x: 172, y: 58, width: 64, height: 38 },
        ]));
        return "";
      }

      throw new Error(`Unexpected command: ${command}`);
    },
  });

  assert.equal(extraction.pageCount, 1);
  assert.equal(extraction.pages[0].imagePath, `${assetPublicBase}/page-001.png`);
  assert.deepEqual(readPngSize(await readFile(path.join(assetDir, "page-001.png"))), {
    width: 300,
    height: 200,
  });

  const pages = enhancePagesWithVisualStructure(extraction.pages, {
    assetDir,
    assetPublicBase,
  });
  const page = pages[0];
  assert.equal(page.visualStructureVersion, 5);
  assert.ok(page.visualRegions.length >= 4);

  const figureRegion = page.visualRegions.find((region) => region.source === "caption-anchor");
  assert.equal(figureRegion?.visualType, "figure");
  assert.equal(figureRegion?.label, "Figure 1");
  assert.equal(figureRegion?.pixelRefined, true);
  assert.equal(figureRegion?.cropQuality?.confidence, "high");
  const splitRegions = page.visualRegions.filter((region) => region.source === "caption-split");
  assert.equal(splitRegions.length, 2);
  assert.deepEqual(splitRegions.map((region) => region.label), ["Figure 1a", "Figure 1b"]);
  assert.equal(splitRegions.every((region) => region.splitCandidate), true);
  assert.equal(splitRegions.every((region) => region.parentVisualRegionId === figureRegion.id), true);

  const artifacts = extractPageArtifacts(pages, {
    assetDir,
    assetPublicBase,
  });
  const figure = artifacts.find((artifact) => artifact.type === "caption");
  const splitArtifacts = artifacts.filter((artifact) => artifact.splitCandidate);
  const formula = artifacts.find((artifact) => artifact.type === "formula");
  assert.equal(figure?.label, "Figure 1");
  assert.equal(figure?.imagePath, `${assetPublicBase}/page-001.png`);
  assert.equal(figure?.crop?.pixelRefined, true);
  assert.equal(splitArtifacts.length, 2);
  assert.deepEqual(splitArtifacts.map((artifact) => artifact.label), ["Figure 1a", "Figure 1b"]);
  assert.equal(splitArtifacts.every((artifact) => artifact.parentArtifactId === figure.id), true);
  assert.equal(splitArtifacts.every((artifact) => artifact.cropQuality?.splitCandidate), true);
  assert.equal(formula?.formulaRole, "display-formula");
  assert.equal(formula?.cropQuality?.confidence, "low");
  assert.equal(formula?.cropQuality?.oversized, true);

  const svg = buildArtifactCropSvg(figure, "http://127.0.0.1:3000");
  assert.match(svg, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(svg, /<svg\b[^>]*role="img"[^>]*aria-label="Figure 1"/);
  assert.match(svg, /<image href="http:\/\/127\.0\.0\.1:3000\/assets\/visual-fixture\/page-001\.png"/);
  assert.doesNotMatch(svg, /viewBox="0 0 300 200"/);

  const stats = buildVisualRebuildStats({
    extractionPages: pages,
    pageImages: [
      {
        pageNumber: 1,
        imagePath: `${assetPublicBase}/page-001.png`,
      },
    ],
    pageArtifacts: artifacts,
  }, pages, 0);
  assert.equal(stats.pages, 1);
  assert.equal(stats.pagesWithImages, 1);
  assert.ok(stats.visualRegions >= 4);
  assert.ok(stats.artifacts >= 4);
  assert.equal(stats.pixelRefined, 3);
  assert.equal(stats.splitCandidates, 2);
  assert.equal(stats.lowConfidence, 1);
  assert.equal(stats.oversized, 1);

  const missingPopplerCommands = await listMissingCommands(["pdftotext", "pdftoppm"]);
  if (missingPopplerCommands.length === 0) {
    const realAssetDir = path.join(tempDir, "real-assets");
    const realExtraction = await extractPdfWithPoppler(fixturePath, realAssetDir, "/assets/real-fixture", {
      pdfEngine: "poppler",
      rootDir: ROOT_DIR,
    });
    assert.equal(realExtraction.pageCount, 1);
    assert.match(realExtraction.pages[0].imagePath || "", /\/assets\/real-fixture\/page-001\.png$/);
    assert.ok(readPngSize(await readFile(path.join(realAssetDir, "page-001.png"))));
  } else if (requirePoppler) {
    assert.fail(`PAPERLENS_REQUIRE_POPPLER is set, but these commands are missing: ${missingPopplerCommands.join(", ")}`);
  } else {
    console.log("SKIP visual-artifacts real poppler render: pdftotext or pdftoppm is not installed");
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function parseBooleanEnv(value) {
  return /^(1|true|yes|on)$/i.test(String(value || ""));
}

function buildFixtureBboxXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<doc>
  <page width="300.000000" height="200.000000">
    <flow>
      <block xMin="20.0" yMin="15.0" xMax="275.0" yMax="35.0">
        <line xMin="20.0" yMin="15.0" xMax="275.0" yMax="35.0">
          <word>This</word><word>paragraph</word><word>keeps</word><word>a</word><word>text</word><word>boundary.</word>
        </line>
      </block>
      <block xMin="60.0" yMin="58.0" xMax="240.0" yMax="96.0">
        <line xMin="60.0" yMin="58.0" xMax="240.0" yMax="74.0">
          <word>(a)</word><word>Input</word><word>Query</word><word>Chunk</word>
        </line>
        <line xMin="60.0" yMin="78.0" xMax="240.0" yMax="96.0">
          <word>(b)</word><word>Output</word><word>Summary</word><word>Checker</word>
        </line>
      </block>
      <block xMin="55.0" yMin="107.0" xMax="245.0" yMax="122.0">
        <line xMin="55.0" yMin="107.0" xMax="245.0" yMax="122.0">
          <word>Figure</word><word>1.</word><word>PaperLens</word><word>visual</word><word>chain</word><word>fixture.</word>
        </line>
      </block>
      <block xMin="40.0" yMin="133.0" xMax="250.0" yMax="184.0">
        <line xMin="40.0" yMin="133.0" xMax="250.0" yMax="154.0">
          <word>y</word><word>=</word><word>W</word><word>x</word><word>+</word><word>b</word><word>+</word><word>θ</word>
        </line>
        <line xMin="220.0" yMin="163.0" xMax="250.0" yMax="184.0">
          <word>(1)</word>
        </line>
      </block>
    </flow>
  </page>
</doc>`;
}

function makeFixturePng(width, height, inkRects = []) {
  const channels = 3;
  const rowBytes = width * channels;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (rowBytes + 1);
    raw[rowStart] = 0;
    raw.fill(255, rowStart + 1, rowStart + 1 + rowBytes);
  }

  for (const rect of inkRects) {
    const left = Math.max(0, Math.trunc(rect.x));
    const top = Math.max(0, Math.trunc(rect.y));
    const right = Math.min(width, Math.trunc(rect.x + rect.width));
    const bottom = Math.min(height, Math.trunc(rect.y + rect.height));
    for (let y = top; y < bottom; y += 1) {
      const rowStart = y * (rowBytes + 1) + 1;
      for (let x = left; x < right; x += 1) {
        raw[rowStart + x * channels] = 0;
        raw[rowStart + x * channels + 1] = 0;
        raw[rowStart + x * channels + 2] = 0;
      }
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", Buffer.from([
      width >>> 24,
      width >>> 16,
      width >>> 8,
      width,
      height >>> 24,
      height >>> 16,
      height >>> 8,
      height,
      8,
      2,
      0,
      0,
      0,
    ])),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, typeBuffer, data, Buffer.alloc(4)]);
}

async function commandExists(command) {
  return new Promise((resolve) => {
    execFile("which", [command], (error) => {
      resolve(!error);
    });
  });
}

async function listMissingCommands(commands) {
  const results = await Promise.all(commands.map(async (command) => ({
    command,
    exists: await commandExists(command),
  })));
  return results
    .filter((result) => !result.exists)
    .map((result) => result.command);
}
