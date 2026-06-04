import assert from "node:assert/strict";
import {
  buildHeuristicPaperMemory,
  buildPaperMemoryScanInput,
  formatPaperMemoryForPrompt,
  mergePaperMemoryChunks,
  normalizePaperMemory,
} from "../lib/paper-memory.js";

const pages = [
  {
    pageNumber: 1,
    width: 300,
    height: 200,
    blocks: [
      {
        text: "Our pre-trained model is publicly available at https://github.com/example/PaperLens.",
        x: 20,
        y: 30,
        width: 240,
        height: 18,
        lineCount: 1,
      },
      {
        text: "Figure 1. Architecture overview with tokenization and decoder stages.",
        x: 50,
        y: 92,
        width: 210,
        height: 16,
        lineCount: 1,
      },
      {
        text: "y = W x + b + θ (1)",
        x: 60,
        y: 122,
        width: 150,
        height: 28,
        lineCount: 2,
      },
      {
        text: "Let D-dimensional vector xt ∈ RD denote the K-line observation at discrete time t.",
        x: 20,
        y: 162,
        width: 240,
        height: 18,
        lineCount: 1,
      },
    ],
  },
];

const scanInput = buildPaperMemoryScanInput(pages);
assert.match(scanInput, /hasUrl=1/);
assert.match(scanInput, /https:\/\/github\.com\/example\/PaperLens/);
assert.match(scanInput, /type=caption/);
assert.match(scanInput, /type=formula/);
assert.match(scanInput, /math=display-formula/);
assert.match(scanInput, /math=inline-math/);

const normalized = normalizePaperMemory({
  summary: "A model paper.",
  mainThread: "Tokenize, pre-train, evaluate.",
  keyTerms: ["Tokenization", "Tokenization", "Decoder"],
  importantFormulas: [
    { label: "Equation 1", pageNumber: 1, text: "y = W x + b + θ", purpose: "Prediction head." },
  ],
  importantVisuals: [
    { label: "Figure 1", pageNumber: 1, type: "figure", description: "Pipeline overview." },
  ],
  resources: [
    { type: "code", url: "https://github.com/example/PaperLens", pageNumber: 1, whyImportant: "Official code." },
  ],
  nonReadingGuidance: ["Do not segment author emails."],
  segmentationGuidance: ["Keep formulas as related material, not paragraphs."],
});
assert.deepEqual(normalized.keyTerms, ["Tokenization", "Decoder"]);
assert.equal(normalized.importantFormulas[0].label, "Equation 1");
assert.equal(normalized.resources[0].type, "code");

const merged = mergePaperMemoryChunks([
  normalized,
  {
    source: "ai",
    summary: "Duplicate resource should merge.",
    keyTerms: ["Decoder", "Exposure bias"],
    resources: ["https://github.com/example/PaperLens"],
  },
]);
assert.equal(merged.resources.length, 1);
assert.deepEqual(merged.keyTerms, ["Tokenization", "Decoder", "Exposure bias"]);

const heuristic = buildHeuristicPaperMemory({
  title: "PaperLens Memory Fixture",
  pageArtifacts: [
    {
      type: "formula",
      label: "Equation 1",
      pageNumber: 1,
      text: "y = W x + b + θ",
    },
    {
      type: "caption",
      label: "Figure 1",
      visualType: "figure",
      pageNumber: 1,
      text: "Figure 1. Architecture overview.",
    },
  ],
}, pages, {
  summary: "A paper about model memory.",
  keywords: ["Paper Memory"],
  nonBodyZones: [
    { type: "references", label: "References", startPage: 9, endPage: 10 },
  ],
});
assert.equal(heuristic.resources[0].url, "https://github.com/example/PaperLens");
assert.equal(heuristic.importantFormulas[0].text, "y = W x + b + θ");
assert.equal(heuristic.importantVisuals[0].label, "Figure 1");
assert.match(heuristic.nonReadingGuidance.join(" "), /References p\.9-10/);

const prompt = formatPaperMemoryForPrompt(heuristic, pages);
assert.match(prompt, /重要资源链接/);
assert.match(prompt, /重要公式/);
assert.match(prompt, /Figure 1/);
