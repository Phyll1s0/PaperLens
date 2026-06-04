import assert from "node:assert/strict";
import {
  inferHeuristicStructureSectionsFromPages,
  isLikelyStructureSectionHeading,
  normalizeStructureHeadingText,
} from "../lib/segmentation-structure.js";

const m2xfpPages = [
  {
    pageNumber: 1,
    blocks: [
      {
        text: "M2XFP: A Metadata-Augmented Microscaling Data Format for Efficient Low-bit Quantization",
        y: 65,
        lineCount: 2,
      },
      {
        text: "Weiming Hu weiminghu@sjtu.edu.cn Shanghai Jiao Tong University Shanghai, China Chen Zhang chenzhang.sjtu@sjtu.edu.cn Shanghai Jiao Tong University Shanghai, China",
        y: 125,
        lineCount: 18,
      },
      { text: "Abstract", y: 406, lineCount: 1 },
      {
        text: "Existing low-bit Microscaling formats often suffer from accuracy degradation.",
        y: 423,
        lineCount: 4,
      },
      { text: "1 Introduction", y: 652, lineCount: 1 },
      {
        text: "Large language models have grown rapidly in scale and capability.",
        y: 668,
        lineCount: 4,
      },
    ],
  },
  {
    pageNumber: 2,
    blocks: [
      { text: "ASPLOS '26, March 22-26, 2026, Pittsburgh, PA, USA", y: 48, lineCount: 1 },
      { text: "This paper makes the following contributions.", y: 238, lineCount: 19 },
      { text: "2 Background", y: 481, lineCount: 1 },
      { text: "2.1 Model Quantization", y: 498, lineCount: 1 },
      { text: "Quantization is a widely used technique for improving efficiency.", y: 512, lineCount: 10 },
    ],
  },
  {
    pageNumber: 3,
    blocks: [
      { text: "Figure 1. Microscaling data format.", y: 166, lineCount: 1 },
      { text: "2.2 Microscaling Data Format", y: 260, lineCount: 1 },
      { text: "Recently, NVIDIA introduced NVFP, replacing the E8M0 scaling factor.", y: 286, lineCount: 11 },
    ],
  },
  {
    pageNumber: 9,
    blocks: [
      { text: "5.1 Architecture Overview", y: 120, lineCount: 1 },
      { text: "5.2 Memory Organization", y: 180, lineCount: 1 },
      { text: "5 Architecture", y: 420, lineCount: 1 },
    ],
  },
  {
    pageNumber: 10,
    blocks: [
      { text: "References", y: 100, lineCount: 1, width: 72 },
    ],
  },
];

const sections = inferHeuristicStructureSectionsFromPages(m2xfpPages, {
  firstPage: 1,
  lastPage: 10,
  referencesStartPage: 10,
  bodyEndPage: 9,
});

assert.deepEqual(
  sections.map((section) => section.title),
  [
    "Abstract",
    "1 Introduction",
    "2 Background",
    "2.1 Model Quantization",
    "2.2 Microscaling Data Format",
    "5 Architecture",
    "5.1 Architecture Overview",
    "5.2 Memory Organization",
  ],
);
assert.equal(sections[0].startPage, 1);
assert.equal(sections.at(-1).endPage, 9);

assert.equal(
  isLikelyStructureSectionHeading("M2XFP: A Metadata-Augmented Microscaling Data Format for Efficient Low-bit Quantization", {
    pageNumber: 1,
    y: 65,
    lineCount: 2,
  }),
  false,
);
assert.equal(isLikelyStructureSectionHeading("Figure 1. Microscaling data format.", { pageNumber: 3, y: 166 }), false);
assert.equal(isLikelyStructureSectionHeading("6.4 Analysis and Discussion", { pageNumber: 13, y: 320 }), true);
assert.equal(isLikelyStructureSectionHeading("A Appendix", { pageNumber: 15, y: 100 }), true);
assert.equal(isLikelyStructureSectionHeading("2022. A time series is worth 64 words: Long-term forecast-", { pageNumber: 8, y: 220 }), false);
assert.equal(isLikelyStructureSectionHeading("10 Kronossmall Kronosbase Kronoslarge Original 10 Original 10 Original", { pageNumber: 6, y: 180 }), false);
assert.equal(isLikelyStructureSectionHeading("5 Figure 5 summarizes the results on Benchmark II in terms of", { pageNumber: 12, y: 120 }), false);
assert.equal(isLikelyStructureSectionHeading("Method", { pageNumber: 12, y: 420 }), false);
assert.equal(
  normalizeStructureHeadingText("3 Method arXiv:2508.02739v1 [q-fin.ST] 2 Aug 2025"),
  "3 Method",
);
