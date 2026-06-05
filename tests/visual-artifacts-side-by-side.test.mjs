import assert from "node:assert/strict";
import {
  classifyPageArtifact,
  enhancePagesWithVisualStructure,
  extractPageArtifacts,
} from "../lib/visual-artifacts.js";

const page = {
  pageNumber: 9,
  width: 612,
  height: 792,
  blocks: [
    {
      x: 54,
      y: 46,
      width: 307,
      height: 10,
      column: 1,
      lineCount: 1,
      text: "M2XFP: A Metadata-Augmented Microscaling Data Format for Efficient Low-bit Quantization",
    },
    {
      x: 92,
      y: 77,
      width: 182,
      height: 32,
      column: 1,
      lineCount: 6,
      text: "Weight Buffer M2XFP Core Controller DMA L1 cache Dot Product Unit Array",
    },
    {
      x: 58,
      y: 76,
      width: 228,
      height: 72,
      column: 1,
      lineCount: 10,
      text: "Activation Buffer Top-1 Decode Unit Compute Engine Output Buffer Network on-chip Quantization Engine Encoding Unit Off-chip Memory DRAM Vector Unit Scaling Normalize Unit",
    },
    {
      x: 105,
      y: 161,
      width: 136,
      height: 14,
      column: 1,
      lineCount: 1,
      text: "Figure 9. Architecture Overview.",
    },
    {
      x: 385,
      y: 46,
      width: 172,
      height: 10,
      column: 2,
      lineCount: 1,
      text: "ASPLOS 26 March 22-26 2026 Pittsburgh PA USA",
    },
    {
      x: 324,
      y: 74,
      width: 228,
      height: 44,
      column: 2,
      lineCount: 18,
      text: "val[3:0] Top-1 Decode Unit FP4[3:0] val[3:0] Comp. val[3:0] idx[2:0] metadata[1:0] Packer Comparator MUX",
    },
    {
      x: 323,
      y: 153,
      width: 229,
      height: 49,
      column: 2,
      lineCount: 19,
      text: "FP4-to-UINT Lookup Table Comparator val[3:0] MUX FP4-Decimal FP4-Binary UINT-Binary +6.0 0111 1111",
    },
    {
      x: 318,
      y: 244,
      width: 241,
      height: 37,
      column: 2,
      lineCount: 3,
      text: "Figure 10. Microarchitecture of the Top-1 Decode Unit, consisting of an FP4-to-UINT lookup table, a three-level comparator tree, and supporting logic.",
    },
  ],
};

const artifacts = extractPageArtifacts(enhancePagesWithVisualStructure([page]));
const figure9 = artifacts.find((artifact) => artifact.label === "Figure 9");
const figure10 = artifacts.find((artifact) => artifact.label === "Figure 10");

assert.ok(figure9?.crop, "Figure 9 crop should exist");
assert.ok(figure10?.crop, "Figure 10 crop should exist");
assert.ok(figure9.crop.width < 300, "left figure crop must not include right-column figure");
assert.ok(figure10.crop.width < 300, "right figure crop must stay inside right column");
assert.ok(figure9.crop.x < 100);
assert.ok(figure10.crop.x > 300);

const nearestFallbackPage = {
  pageNumber: 14,
  width: 612,
  height: 792,
  blocks: [
    {
      x: 72,
      y: 82,
      width: 172,
      height: 54,
      column: 1,
      lineCount: 8,
      text: "Input Output Query Token Layer Model Summary Pipeline",
    },
    {
      x: 88,
      y: 218,
      width: 132,
      height: 46,
      column: 1,
      lineCount: 6,
      text: "Encoder Decoder Query Token Latency Throughput",
    },
    {
      x: 246,
      y: 220,
      width: 128,
      height: 44,
      column: 1,
      lineCount: 6,
      text: "Scheduler Worker Final Summary Output Score",
    },
    {
      x: 82,
      y: 304,
      width: 276,
      height: 24,
      column: 1,
      lineCount: 2,
      text: "Figure 20. Runtime pipeline overview.",
    },
    {
      x: 80,
      y: 372,
      width: 220,
      height: 84,
      column: 1,
      lineCount: 8,
      text: "This paragraph discusses the pipeline in prose. It should not become part of the crop.",
    },
  ],
};

const nearestFigure = extractPageArtifacts(enhancePagesWithVisualStructure([nearestFallbackPage]))
  .find((artifact) => artifact.label === "Figure 20");

assert.ok(nearestFigure?.crop, "nearest fallback figure crop should exist");
assert.ok(nearestFigure.crop.y > 190, "fallback figure crop must ignore earlier visual blocks");
assert.ok(nearestFigure.crop.width > 280, "fallback figure crop should keep side-by-side nearest panels together");
assert.ok(nearestFigure.crop.height < 90, "fallback figure crop should stay tight around nearest visual cluster");

const captionAboveFigurePage = {
  pageNumber: 16,
  width: 612,
  height: 792,
  blocks: [
    {
      x: 80,
      y: 106,
      width: 300,
      height: 44,
      column: 1,
      lineCount: 4,
      text: "This paragraph appears before the figure caption. It should not be included in the visual crop.",
    },
    {
      x: 82,
      y: 178,
      width: 300,
      height: 24,
      column: 1,
      lineCount: 2,
      text: "Figure 21. Caption placed above its architecture diagram.",
    },
    {
      x: 92,
      y: 230,
      width: 120,
      height: 48,
      column: 1,
      lineCount: 5,
      text: "Input Router Token Buffer Output",
    },
    {
      x: 232,
      y: 230,
      width: 148,
      height: 48,
      column: 1,
      lineCount: 5,
      text: "Encoder Decoder Summary Checker",
    },
    {
      x: 84,
      y: 332,
      width: 260,
      height: 80,
      column: 1,
      lineCount: 7,
      text: "After the figure, the paper returns to normal prose. This should stay outside the crop.",
    },
  ],
};

const captionAboveFigure = extractPageArtifacts(enhancePagesWithVisualStructure([captionAboveFigurePage]))
  .find((artifact) => artifact.label === "Figure 21");

assert.ok(captionAboveFigure?.crop, "caption-above figure crop should exist");
assert.ok(captionAboveFigure.crop.y > 205, "caption-above figure crop should start below the caption");
assert.ok(captionAboveFigure.crop.y + captionAboveFigure.crop.height < 310, "caption-above figure crop should stop before later prose");
assert.ok(captionAboveFigure.crop.width > 280, "caption-above figure crop should keep adjacent diagram panels together");

const nearestTableFallbackPage = {
  pageNumber: 15,
  width: 612,
  height: 792,
  blocks: [
    {
      x: 78,
      y: 92,
      width: 270,
      height: 22,
      column: 1,
      lineCount: 2,
      text: "Table 9. Ablation results on three datasets.",
    },
    {
      x: 82,
      y: 138,
      width: 230,
      height: 50,
      column: 1,
      lineCount: 4,
      text: "Method Dataset Accuracy Latency Baseline 70.2 12.1 Ours 74.6 10.4",
    },
    {
      x: 82,
      y: 356,
      width: 232,
      height: 66,
      column: 1,
      lineCount: 5,
      text: "Method Model Params Throughput Memory Small 1.2 88 4.1 Large 7.0 52 8.9",
    },
  ],
};

const nearestTable = extractPageArtifacts(enhancePagesWithVisualStructure([nearestTableFallbackPage]))
  .find((artifact) => artifact.label === "Table 9");

assert.ok(nearestTable?.crop, "nearest fallback table crop should exist");
assert.ok(nearestTable.crop.y < 130, "table fallback crop should start near the caption/table pair");
assert.ok(nearestTable.crop.y + nearestTable.crop.height < 230, "table fallback crop must ignore far later table-like blocks");

const textLayoutSplitPage = {
  pageNumber: 12,
  width: 612,
  height: 792,
  blocks: [
    {
      x: 82,
      y: 136,
      width: 172,
      height: 96,
      lineCount: 4,
      text: "(a) Encoder panel Input Query Chunk Patch Tokens",
    },
    {
      x: 340,
      y: 138,
      width: 168,
      height: 94,
      lineCount: 4,
      text: "(b) Decoder panel Output Summary Checker Final",
    },
    {
      x: 92,
      y: 292,
      width: 420,
      height: 26,
      lineCount: 2,
      text: "Figure 12. Two-panel architecture overview.",
    },
  ],
};

const splitArtifacts = extractPageArtifacts(enhancePagesWithVisualStructure([textLayoutSplitPage]))
  .filter((artifact) => artifact.splitCandidate);

assert.equal(splitArtifacts.length, 2, "text-layout split should create two split candidates without page pixels");
assert.deepEqual(splitArtifacts.map((artifact) => artifact.label), ["Figure 12a", "Figure 12b"]);
assert.equal(splitArtifacts.every((artifact) => artifact.splitOrientation === "vertical"), true);
assert.equal(splitArtifacts.every((artifact) => artifact.splitMethod === "text-layout"), true);
assert.ok(splitArtifacts[0].crop.x < splitArtifacts[1].crop.x);
assert.ok(splitArtifacts.every((artifact) => artifact.cropQuality?.score > 0));

const captionLabelSplitPage = {
  pageNumber: 4,
  width: 612,
  height: 792,
  blocks: [
    {
      x: 320,
      y: 82,
      width: 232,
      height: 76,
      column: 2,
      lineCount: 18,
      text: "FP4 FP16 SMX4 MXFP4 NVFP4 Perplexity LLaMA-7B LLaMA3-8B group-256 group-128 group-64 Equivalent Bit Width",
    },
    {
      x: 318,
      y: 166,
      width: 240,
      height: 54,
      column: 2,
      lineCount: 8,
      text: "Figure 3. Perplexity of 4-bit dequantization. Figure 4. Perplexity decreases with group-wise maximum preservation.",
    },
  ],
};

const captionLabelArtifacts = extractPageArtifacts(enhancePagesWithVisualStructure([captionLabelSplitPage]));
const captionLabelSplits = captionLabelArtifacts.filter((artifact) => artifact.splitCandidate);

assert.equal(captionLabelSplits.length, 2, "merged Figure 3/Figure 4 captions should create label-bound split artifacts");
assert.deepEqual(captionLabelSplits.map((artifact) => artifact.label), ["Figure 3", "Figure 4"]);
assert.deepEqual(captionLabelSplits.map((artifact) => artifact.splitMethod), ["caption-label", "caption-label"]);
assert.ok(/^Figure 3\./.test(captionLabelSplits[0].text));
assert.ok(/^Figure 4\./.test(captionLabelSplits[1].text));
assert.ok(captionLabelSplits[0].crop.x < captionLabelSplits[1].crop.x);
assert.ok(captionLabelSplits.every((artifact) => artifact.crop.width < 130));
assert.equal(captionLabelArtifacts.some((artifact) => !artifact.splitCandidate && /Figure 3\..*Figure 4\./.test(artifact.text)), false);

const frontMatterBlock = {
  x: 70,
  y: 60,
  width: 470,
  height: 360,
  lineCount: 36,
  text: [
    "M2XFP: A Metadata-Augmented Microscaling Data Format for Efficient Low-bit Quantization",
    "Zihan Zhang zihan@sjtu.edu.cn Shanghai Jiao Tong University Shanghai, China",
    "Haoyan Zhang haoyan@sjtu.edu.cn Shanghai Qi Zhi Institute Shanghai, China",
    "CCS Concepts: Computer systems organization; Neural networks.",
    "Our code is available at https://github.com/SJTU-ReArch-Group/M2XFP_ASPLOS26.",
  ].join(" "),
};

assert.equal(classifyPageArtifact(frontMatterBlock, { pageNumber: 1 }), "");
assert.equal(
  classifyPageArtifact(
    { x: 80, y: 420, width: 360, height: 28, lineCount: 2, text: "Figure 1. Overview of the quantization pipeline." },
    { pageNumber: 1 },
  ),
  "caption",
);

const frontMatterArtifacts = extractPageArtifacts(enhancePagesWithVisualStructure([{
  pageNumber: 1,
  width: 612,
  height: 792,
  blocks: [
    frontMatterBlock,
    {
      x: 120,
      y: 450,
      width: 290,
      height: 54,
      lineCount: 3,
      text: "Input Quantization Engine Output",
    },
    {
      x: 112,
      y: 520,
      width: 330,
      height: 24,
      lineCount: 2,
      text: "Figure 1. Overview of the quantization pipeline.",
    },
  ],
}]));

assert.equal(frontMatterArtifacts.some((artifact) => /sjtu\.edu\.cn|CCS Concepts/i.test(artifact.text)), false);
assert.equal(frontMatterArtifacts.some((artifact) => artifact.label === "Figure 1"), true);

const formulaIslandPage = {
  pageNumber: 6,
  width: 612,
  height: 792,
  imagePath: "/assets/test/page-006.png",
  blocks: [
    {
      x: 317.5,
      y: 605.9,
      width: 242.2,
      height: 112.2,
      column: 2,
      lineCount: 10,
      text: ", (1) Qmax xi = round xi where s is the shared scaling factor and Qmax is the representable maximum.",
    },
    {
      x: 317.9,
      y: 530.1,
      width: 241.7,
      height: 80.4,
      column: 2,
      lineCount: 9,
      text: "EBW= (k x Belem)+Bmeta +Bscale k = Belem + (2) Here, k is the number of scalar elements per block.",
    },
    {
      x: 80,
      y: 116,
      width: 412,
      height: 126,
      column: 0,
      lineCount: 11,
      rawText: "Algorithm 1: Top-1 metadata selection\nInput: values x\n1: s <- max(x)\n2: for i in values do\n3: q_i <- round(x_i / s)\n4: return q_i",
      text: "Algorithm 1: Top-1 metadata selection Input: values x 1: s <- max(x) 2: for i in values do 3: q_i <- round(x_i / s) 4: return q_i",
    },
    {
      x: 78,
      y: 292,
      width: 418,
      height: 34,
      column: 0,
      lineCount: 3,
      text: "Model Type FP4 INT4 h = 1 h = 2 Accuracy 70.2 71.8 Latency 12.1 13.4",
    },
  ],
};

const formulaIslandArtifacts = extractPageArtifacts(enhancePagesWithVisualStructure([formulaIslandPage]));
const formulaIslands = formulaIslandArtifacts.filter((artifact) => artifact.visualSource === "formula-island");

assert.equal(formulaIslands.length, 2, "mixed formula/prose blocks should create formula-island artifacts");
assert.ok(formulaIslands.some((artifact) => /^\(1\)\s+Qmax xi = round xi$/.test(artifact.text)));
assert.ok(formulaIslands.some((artifact) => /^EBW=/.test(artifact.text) && !/\bHere\b/i.test(artifact.text)));
assert.equal(formulaIslands.every((artifact) => artifact.type === "formula"), true);
assert.equal(formulaIslands.every((artifact) => artifact.renderMode === "image-latex"), true);
assert.equal(formulaIslands.every((artifact) => artifact.crop?.height < 60), true);
assert.equal(formulaIslandArtifacts.some((artifact) => /Algorithm 1/i.test(artifact.text) && artifact.type === "formula"), false);
assert.equal(formulaIslandArtifacts.some((artifact) => /Accuracy 70\.2/i.test(artifact.text) && artifact.type === "formula"), false);

const embeddedFormulaIslandPage = {
  pageNumber: 9,
  width: 612,
  height: 792,
  imagePath: "/assets/test/page-009.png",
  blocks: [
    {
      x: 54,
      y: 350,
      width: 244,
      height: 126,
      column: 1,
      lineCount: 14,
      text: "The optimal parameters are chosen via hierarchical MSE minimization: b* Wk* (4), {k_i*}= arg min b in {-1,0,1} ∑ i in sg W_i,b-W_i where W_i,b is the rounded candidate and sg is the subgroup.",
    },
    {
      x: 318,
      y: 112,
      width: 242,
      height: 70,
      column: 2,
      lineCount: 8,
      text: "The shared scale is computed as S=2 floor log2(xmax/P) where P is the maximum power-of-two value. This inline math should remain prose.",
    },
    {
      x: 318,
      y: 256,
      width: 230,
      height: 40,
      column: 2,
      lineCount: 4,
      text: "Model Type FP4 INT4 b=0 b=1 Accuracy 70.2 71.8 Latency 12.1 13.4",
    },
  ],
};

const embeddedFormulaArtifacts = extractPageArtifacts(enhancePagesWithVisualStructure([embeddedFormulaIslandPage]));
const embeddedLineIslands = embeddedFormulaArtifacts.filter((artifact) => artifact.visualSource === "formula-line-island");

assert.equal(embeddedLineIslands.length, 1, "embedded display-like formulas should be recovered once");
assert.match(embeddedLineIslands[0].text, /\barg min\b/);
assert.equal(embeddedLineIslands[0].label, "Equation 4");
assert.equal(embeddedLineIslands[0].renderMode, "image-latex");
assert.ok(embeddedLineIslands[0].crop?.y > 370, "embedded formula crop should follow the formula line, not the block top");
assert.equal(embeddedFormulaArtifacts.some((artifact) => /computed as S=2/i.test(artifact.text) && artifact.type === "formula"), false);
assert.equal(embeddedFormulaArtifacts.some((artifact) => /Accuracy 70\.2/i.test(artifact.text) && artifact.type === "formula"), false);

const algorithmPage = {
  pageNumber: 8,
  width: 612,
  height: 792,
  blocks: [
    {
      x: 309.13,
      y: 71.1,
      width: 225.75,
      height: 50.27,
      column: 2,
      lineCount: 6,
      text: "Algorithm 1 The M2XFP Quantization Process for each subgroup is: 1: Input: High-precision data group XFP16 of size k. 2: Output: Final MXFP4 XFP4 and metadata Xmeta.",
    },
    {
      x: 320.62,
      y: 123.32,
      width: 239.17,
      height: 187.98,
      column: 2,
      lineCount: 16,
      text: "3: xmax ←find maximum absolute value in XFP16 4: S ←2⌊log2 (amax/FP4_max_pow2)⌋ 5: XFP4 ←quantize_to_E2M1(XFP16,S) 6: for each subgroup do 7: idxtop1 ←argmax(abs(XFP4)) 8: xFP6 ←quantize_to_E3M2(XFP16[idxtop1]) 9: xmeta ←metadata(xFP6)",
    },
    {
      x: 320.62,
      y: 314.6,
      width: 237.65,
      height: 56.48,
      column: 2,
      lineCount: 4,
      text: "13: fp6_bits ←FloatToBits(|xFP6|) ⊲ 6-bit information 14: fp4_bits ←FloatToBits(|xFP4[idxtop1]|) ⊲ 4-bit information 15: encoded ←fp6_bits + 1",
    },
    {
      x: 320.62,
      y: 375.49,
      width: 237.64,
      height: 96.35,
      column: 2,
      lineCount: 8,
      text: "16: range_min ←fp4_bits00 17: range_max ←fp4_bits11 18: clamp ←Clamp(encoded, range_min, range_max) 19: xmeta ←encoded - fp4_bits",
    },
    {
      x: 320.62,
      y: 481.98,
      width: 187.12,
      height: 38.48,
      column: 2,
      lineCount: 4,
      text: "20: Append xFP4 to XFP4 and xmeta to Xmeta 21: end for 22: return XFP4, Xmeta",
    },
    {
      x: 309.13,
      y: 2.38,
      width: 248.87,
      height: 715.77,
      column: 2,
      lineCount: 6,
      text: "Encoding Procedure. To implement this encoding, we first add a bias of 1 to the FP6 binary value, then clamp the final 2-bit extra mantissa metadata. This paragraph overlaps the algorithm column in the PDF text extraction but is not part of the pseudo-code.",
    },
  ],
};

const algorithmArtifacts = extractPageArtifacts(enhancePagesWithVisualStructure([algorithmPage]));
const algorithmArtifact = algorithmArtifacts.find((artifact) => artifact.type === "code" && /Algorithm 1/.test(artifact.text));

assert.ok(algorithmArtifact, "algorithm pseudo-code should remain a code artifact");
assert.equal(/Encoding Procedure/i.test(algorithmArtifact.text), false);
assert.equal(algorithmArtifact.crop?.algorithmLike, true);
assert.equal(algorithmArtifact.cropQuality?.oversized, false);
assert.ok(algorithmArtifact.crop?.height < 540, "algorithm crop should not include the overlapping prose block");
