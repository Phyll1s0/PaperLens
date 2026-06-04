import assert from "node:assert/strict";
import {
  buildPaperDocxExport,
} from "../lib/export-docx.js";

const tinyPng = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
  "hex",
);

const paper = {
  id: "paper_docx_fixture",
  title: "Fixture & <Paper>",
  filename: "fixture.pdf",
  pageCount: 3,
  sections: [{ id: "intro", title: "Intro & Methods" }],
  paragraphs: [
    {
      id: "heading-1",
      kind: "heading",
      sourceText: "Existing Heading",
    },
    {
      id: "p1",
      order: 0,
      kind: "paragraph",
      sectionId: "intro",
      pageNumber: 1,
      pageEndNumber: 2,
      sourceText: "Original & text with Figure 1.",
      translation: "Translated text.",
      explanation: "Explained text.",
      keyTerms: ["Kronos", "kronos", "MAE"],
      relatedArtifactIds: ["fig-1", "formula-low", "hidden-fig"],
    },
    {
      id: "p2",
      order: 1,
      kind: "paragraph",
      sectionId: "intro",
      pageNumber: 3,
      sourceText: "Second paragraph.",
      translation: "",
      explanation: "",
      keyTerms: "Alpha, Beta；Alpha",
      relatedArtifactIds: [],
    },
    {
      id: "p3",
      order: 2,
      kind: "paragraph",
      sectionId: "intro",
      pageNumber: 3,
      sourceText: "Noise paragraph should not export.",
      translation: "Noise",
      explanation: "Noise",
      analysisEligible: false,
    },
  ],
  pageArtifacts: [
    {
      id: "fig-1",
      type: "caption",
      visualType: "figure",
      label: "Figure & 1",
      imagePath: "/assets/paper_fixture/page-001.png",
      text: "Figure 1: Caption\n  with wrapped spacing.",
      crop: { x: 1, y: 2, width: 3, height: 4, pageWidth: 10, pageHeight: 12 },
    },
    {
      id: "hidden-fig",
      type: "caption",
      visualType: "figure",
      hidden: true,
      label: "Figure 2",
      imagePath: "/assets/paper_fixture/page-002.png",
      crop: { x: 1, y: 2, width: 3, height: 4, pageWidth: 10, pageHeight: 12 },
    },
    {
      id: "formula-low",
      type: "formula",
      visualType: "formula",
      label: "Equation 1",
      imagePath: "/assets/paper_fixture/page-001.png",
      text: "y 1 : L : = { y 1 , ⋯ , y L }",
      crop: { x: 2, y: 3, width: 5, height: 2, pageWidth: 10, pageHeight: 12 },
    },
  ],
};

const docx = await buildPaperDocxExport(paper, {
  now: () => new Date("2026-06-03T00:00:00.000Z"),
  readArtifactAsset: async (imagePath) =>
    imagePath === "/assets/paper_fixture/page-001.png"
      ? { data: tinyPng, ext: ".png" }
      : null,
});
const entries = readStoredZipEntries(docx);
const documentXml = entries.get("word/document.xml")?.toString("utf8") || "";
const relsXml = entries.get("word/_rels/document.xml.rels")?.toString("utf8") || "";
const contentTypesXml = entries.get("[Content_Types].xml")?.toString("utf8") || "";

assert.equal(entries.has("[Content_Types].xml"), true);
assert.equal(entries.has("_rels/.rels"), true);
assert.equal(entries.has("word/document.xml"), true);
assert.equal(entries.has("word/styles.xml"), true);
assert.equal(entries.has("word/_rels/document.xml.rels"), true);
assert.equal(Buffer.compare(entries.get("word/media/image-1.png"), tinyPng), 0);

assert.match(documentXml, /Fixture &amp; &lt;Paper&gt;/);
assert.match(documentXml, /文件：fixture\.pdf/);
assert.match(documentXml, /页数：3 · 段落数：2 · 导出时间：2026-06-03T00:00:00\.000Z/);
assert.match(documentXml, /Existing Heading/);
assert.match(documentXml, /Intro &amp; Methods/);
assert.match(documentXml, /P1 · p\.1-2/);
assert.match(documentXml, /Original &amp; text with Figure 1\./);
assert.match(documentXml, /Translated text\./);
assert.match(documentXml, /Explained text\./);
assert.match(documentXml, /术语：Kronos、MAE/);
assert.match(documentXml, /相关图表/);
assert.match(documentXml, /Figure &amp; 1/);
assert.match(documentXml, /Figure 1: Caption/);
assert.match(documentXml, /Equation 1/);
assert.match(documentXml, /识别文本（低置信，仅供核对）：y 1 : L : = \{ y 1 , ⋯ , y L \}/);
assert.match(documentXml, /<a:blip r:embed="rIdImage1"/);
assert.match(documentXml, /Second paragraph\./);
assert.match(documentXml, /尚未生成/);
assert.match(documentXml, /术语：Alpha、Beta/);
assert.doesNotMatch(documentXml, /Figure 2|Noise paragraph/);

assert.match(relsXml, /Id="rIdImage1"/);
assert.match(relsXml, /Target="media\/image-1\.png"/);
assert.match(contentTypesXml, /Extension="png" ContentType="image\/png"/);

function readStoredZipEntries(buffer) {
  const entries = new Map();
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString("utf8");
    entries.set(name, buffer.subarray(dataStart, dataStart + compressedSize));
    offset = dataStart + compressedSize;
  }

  return entries;
}
