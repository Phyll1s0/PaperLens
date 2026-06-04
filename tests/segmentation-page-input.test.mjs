import assert from "node:assert/strict";
import {
  buildSegmentationPageText,
  extractTextBlocks,
  formatSegmentationPageBlock,
  getReadablePageBlocks,
} from "../lib/segmentation-page-input.js";

const twoColumnPage = {
  pageNumber: 2,
  width: 600,
  height: 800,
  blocks: [
    {
      text: "2 Method",
      x: 54,
      y: 70,
      width: 492,
      height: 20,
      column: 0,
      lineCount: 1,
    },
    {
      text: "The right column begins with a later paragraph that should not be read before the left column.",
      x: 330,
      y: 116,
      width: 220,
      height: 48,
      column: 2,
      lineCount: 2,
    },
    {
      text: "The left column first explains the tokenization pipeline and introduces the coarse prediction stage.",
      x: 54,
      y: 112,
      width: 220,
      height: 48,
      column: 1,
      lineCount: 2,
    },
    {
      text: "The right column then discusses decoding and uncertainty calibration for the forecasting model.",
      x: 330,
      y: 176,
      width: 220,
      height: 48,
      column: 2,
      lineCount: 2,
    },
    {
      text: "The left column continues with a concrete training objective before the layout reaches the next column.",
      x: 54,
      y: 172,
      width: 220,
      height: 48,
      column: 1,
      lineCount: 2,
    },
    {
      text: "Figure 2. Architecture overview for the model.",
      x: 54,
      y: 320,
      width: 260,
      height: 20,
      column: 1,
      lineCount: 1,
    },
    {
      text: "Dataset Horizon MAE RMSE MAPE Chronos 24 0.31 0.52 8.4 Kronos 24 0.29 0.48 7.9",
      x: 330,
      y: 300,
      width: 220,
      height: 72,
      column: 2,
      lineCount: 4,
    },
    {
      text: "https://github.com/example/project",
      x: 330,
      y: 392,
      width: 220,
      height: 18,
      column: 2,
      lineCount: 1,
    },
  ],
};

{
  const input = buildSegmentationPageText(twoColumnPage);
  assert.ok(input.includes("2 Method"));
  assert.ok(input.includes("col=1"));
  assert.ok(input.includes("col=2"));
  assert.equal(input.includes("Figure 2."), false);
  assert.equal(input.includes("Dataset Horizon"), false);
  assert.equal(input.includes("github.com/example/project"), false);

  const leftFirst = input.indexOf("The left column first");
  const leftContinue = input.indexOf("The left column continues");
  const rightBegins = input.indexOf("The right column begins");
  const rightThen = input.indexOf("The right column then");
  assert.ok(leftFirst > input.indexOf("2 Method"));
  assert.ok(leftContinue > leftFirst);
  assert.ok(rightBegins > leftContinue);
  assert.ok(rightThen > rightBegins);
}

{
  const page = {
    pageNumber: 3,
    width: 600,
    height: 800,
    blocks: [
      {
        text: "Raw PDF\nText Blocks\nNoise Filter\nAI Segmenter\nParagraph Queue",
        x: 64,
        y: 220,
        width: 150,
        height: 124,
        column: 1,
        lineCount: 5,
      },
      {
        text: "The segmentation pipeline uses page-level evidence to avoid sending figure labels into the reading queue.",
        x: 54,
        y: 370,
        width: 492,
        height: 44,
        column: 0,
        lineCount: 2,
      },
    ],
  };
  const input = buildSegmentationPageText(page);
  assert.equal(input.includes("Raw PDF"), false);
  assert.equal(input.includes("AI Segmenter"), false);
  assert.ok(input.includes("page-level evidence"));
}

{
  const page = {
    pageNumber: 3,
    width: 600,
    height: 800,
    blocks: [
      {
        text: "Let D-dimensional vector xt ∈ RD denote the K-line observation at discrete time t, comprising D key financial indicators.",
        x: 54,
        y: 150,
        width: 492,
        height: 44,
        column: 0,
        lineCount: 2,
      },
      {
        text: "This sentence follows the inline mathematical definition and remains ordinary prose.",
        x: 500,
        y: 210,
        width: 260,
        height: 36,
        column: 0,
        lineCount: 2,
      },
    ],
  };
  const input = buildSegmentationPageText(page);
  assert.ok(input.includes("math=inline-math"));
  assert.ok(input.includes("Let D-dimensional vector"));
  assert.match(
    formatSegmentationPageBlock(page, { text: "(4)", x: 500, y: 210, width: 26, height: 14, lineCount: 1 }, 2),
    /math=equation-number/,
  );
}

{
  const page = {
    pageNumber: 4,
    width: 600,
    height: 800,
    blocks: [
      {
        text: [
          "The left paragraph describes the coarse tokenization step used by the forecasting model.",
          "It remains in the left column and should be reconstructed as one candidate block.",
          "The right paragraph explains decoder calibration and uncertainty handling for prediction.",
          "It remains in the right column and should not be concatenated after the left line.",
        ].join(" "),
        x: 48,
        y: 100,
        width: 512,
        height: 88,
        lineCount: 4,
        lines: [
          { text: "The left paragraph describes the coarse tokenization step used by the forecasting model.", x: 54, y: 100, width: 220, height: 14 },
          { text: "It remains in the left column and should be reconstructed as one candidate block.", x: 54, y: 118, width: 220, height: 14 },
          { text: "The right paragraph explains decoder calibration and uncertainty handling for prediction.", x: 330, y: 100, width: 220, height: 14 },
          { text: "It remains in the right column and should not be concatenated after the left line.", x: 330, y: 118, width: 220, height: 14 },
        ],
      },
    ],
  };
  const blocks = getReadablePageBlocks(page);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].rebuiltFromLineCluster, true);
  assert.match(blocks[0].text, /left paragraph/);
  assert.doesNotMatch(blocks[0].text, /right paragraph/);
  assert.match(blocks[1].text, /right paragraph/);

  const input = buildSegmentationPageText(page);
  assert.ok(input.includes("cluster=1"));
  assert.ok(input.includes("cluster=2"));
  assert.ok(input.includes("x=0.09"));
  assert.ok(input.indexOf("left paragraph") < input.indexOf("right paragraph"));
}

{
  const page = {
    pageNumber: 1,
    width: 600,
    height: 800,
    blocks: [
      {
        text: "Alice Research alice@example.com Bob University bob@example.edu\nWe propose a memory-aware segmentation pipeline that preserves reading paragraphs after front-matter noise.",
        x: 54,
        y: 112,
        width: 492,
        height: 92,
        column: 0,
        lineCount: 2,
        lines: [
          { text: "Alice Research alice@example.com Bob University bob@example.edu", x: 54, y: 112, width: 492, height: 18 },
          { text: "We propose a memory-aware segmentation pipeline that preserves reading paragraphs after front-matter noise.", x: 54, y: 136, width: 492, height: 18 },
        ],
      },
    ],
  };
  const blocks = getReadablePageBlocks(page);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].rescuedFromMixedBlock, true);
  assert.match(blocks[0].text, /memory-aware segmentation pipeline/);
  assert.doesNotMatch(blocks[0].text, /alice@example/);
}

{
  const blocks = extractTextBlocks("Abstract\nThis line starts a paragraph that is split\nacross line breaks.\n\n1 Introduction\nThe next paragraph survives.");
  assert.deepEqual(blocks, [
    "Abstract\nThis line starts a paragraph that is split\nacross line breaks.",
    "1 Introduction\nThe next paragraph survives.",
  ]);
}
