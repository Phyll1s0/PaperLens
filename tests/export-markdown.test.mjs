import assert from "node:assert/strict";
import {
  buildPaperMarkdownExport,
  getExportArtifactCropUrl,
} from "../lib/export-markdown.js";

const paper = {
  id: "paper fixture/1",
  title: "# Paper *Title*",
  filename: "fixture.pdf",
  pageCount: 3,
  sections: [{ id: "intro", title: "Intro.Section" }],
  paragraphs: [
    {
      id: "heading-1",
      kind: "heading",
      sourceText: "## Existing Heading",
    },
    {
      id: "p1",
      order: 0,
      kind: "paragraph",
      sectionId: "intro",
      pageNumber: 1,
      pageEndNumber: 2,
      sourceText: "Original text with Figure 1.",
      translation: "Translated text.",
      explanation: "Explained text.",
      keyTerms: ["Kronos", "kronos", "MAE"],
      relatedArtifactIds: ["fig-1", "formula-low", "formula-medium", "hidden-fig", "missing-fig"],
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
      label: "Figure 1",
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
    {
      id: "formula-medium",
      type: "formula",
      visualType: "formula",
      label: "Equation 2",
      imagePath: "/assets/paper_fixture/page-002.png",
      text: "WQL = 1 WQLαj. j=1",
      crop: { x: 2, y: 6, width: 5, height: 2, pageWidth: 10, pageHeight: 12 },
    },
  ],
};

const markdown = buildPaperMarkdownExport(paper, "http://127.0.0.1:3000/", {
  now: () => new Date("2026-06-03T00:00:00.000Z"),
});

assert.match(markdown, /^# Paper \\\*Title\\\*/);
assert.match(markdown, /- 文件：fixture\.pdf/);
assert.match(markdown, /- 页数：3/);
assert.match(markdown, /- 段落数：2/);
assert.match(markdown, /- 导出时间：2026-06-03T00:00:00\.000Z/);
assert.match(markdown, /## Existing Heading/);
assert.match(markdown, /## Intro\\.Section/);
assert.match(markdown, /### P1 · p\.1-2/);
assert.match(markdown, /\*\*原文\*\*\n\nOriginal text with Figure 1\./);
assert.match(markdown, /\*\*翻译\*\*\n\nTranslated text\./);
assert.match(markdown, /\*\*讲解\*\*\n\nExplained text\./);
assert.match(markdown, /\*\*术语：\*\* `Kronos` `MAE`/);
assert.match(markdown, /- Figure 1：\/assets\/paper_fixture\/page-001\.png/);
assert.match(markdown, /!\[Figure 1\]\(http:\/\/127\.0\.0\.1:3000\/api\/papers\/paper%20fixture%2F1\/artifacts\/fig-1\/crop\.svg\)/);
assert.match(markdown, /Figure 1: Caption\nwith wrapped spacing\./);
assert.match(markdown, /- Equation 1：\/assets\/paper_fixture\/page-001\.png/);
assert.match(markdown, /!\[Equation 1\]\(http:\/\/127\.0\.0\.1:3000\/api\/papers\/paper%20fixture%2F1\/artifacts\/formula-low\/crop\.svg\)/);
assert.match(markdown, /识别文本（低置信，仅供核对）：`y 1 : L : = \{ y 1 , ⋯ , y L \}`/);
assert.doesNotMatch(markdown, /\\\[y 1 : L/);
assert.match(markdown, /!\[Equation 2\]\(http:\/\/127\.0\.0\.1:3000\/api\/papers\/paper%20fixture%2F1\/artifacts\/formula-medium\/crop\.svg\)/);
assert.match(markdown, /识别文本（图片优先，供核对）：`WQL = 1 WQLαj\. j=1`/);
assert.doesNotMatch(markdown, /\\\[WQL = 1 WQLαj/);
assert.match(markdown, /### P2 · p\.3/);
assert.match(markdown, /\*\*翻译\*\*\n\n尚未生成/);
assert.match(markdown, /\*\*术语：\*\* `Alpha` `Beta`/);
assert.doesNotMatch(markdown, /hidden-fig|Figure 2|missing-fig|Noise paragraph/);

assert.equal(
  getExportArtifactCropUrl(paper, paper.pageArtifacts[0], "http://localhost:3000"),
  "http://localhost:3000/api/papers/paper%20fixture%2F1/artifacts/fig-1/crop.svg",
);
assert.equal(getExportArtifactCropUrl(paper, { ...paper.pageArtifacts[0], crop: null }, ""), "");
