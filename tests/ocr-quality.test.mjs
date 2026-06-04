import assert from "node:assert/strict";
import {
  buildOcrQualityReport,
  detectPdfLanguage,
  normalizeOcrLanguage,
  resolveOcrLanguage,
} from "../lib/ocr-quality.js";

assert.equal(normalizeOcrLanguage(" ENG + zh-cn "), "eng+chi_sim");
assert.equal(normalizeOcrLanguage("auto"), "auto");
assert.equal(normalizeOcrLanguage("eng\u0000+chi_sim", "eng"), "eng");
assert.equal(normalizeOcrLanguage("bad value !", "eng+chi_sim"), "eng+chi_sim");

const englishPaper = {
  pageCount: 2,
  extractionPages: [{
    pageNumber: 1,
    text: "This paper presents a robust optical character recognition pipeline for scientific documents. ".repeat(8),
  }],
  paragraphs: [{
    id: "p1",
    sourceText: "This paper presents a robust optical character recognition pipeline for scientific documents.",
  }],
};
assert.equal(detectPdfLanguage(englishPaper).language, "eng");

const mixedPaper = {
  pageCount: 1,
  extractionPages: [{
    pageNumber: 1,
    text: "本文介绍一个 paper reading 系统，用于 scientific PDF OCR 和 中文 英文 混排 识别。".repeat(10),
  }],
  paragraphs: [{
    id: "p1",
    sourceText: "本文介绍一个 paper reading 系统，用于 scientific PDF OCR 和 中文 英文 混排 识别。",
  }],
  ocr: {
    recommendedLanguage: "eng+chi_sim",
  },
};
assert.equal(detectPdfLanguage(mixedPaper).language, "eng+chi_sim");
assert.equal(resolveOcrLanguage("auto", mixedPaper, "eng"), "eng+chi_sim");

const poorScan = {
  pageCount: 3,
  extractionPages: [
    { pageNumber: 1, text: "" },
    { pageNumber: 2, text: "tiny" },
    { pageNumber: 3, text: "" },
  ],
  pageImages: [
    { pageNumber: 1, imagePath: "/assets/p1.png", imageWidth: 640, imageHeight: 820 },
    { pageNumber: 2, imagePath: "/assets/p2.png", imageWidth: 1600, imageHeight: 2200 },
  ],
  paragraphs: [],
};

const report = buildOcrQualityReport(poorScan, {
  selectedLanguage: "eng",
  toolOutput: "deskew applied; rotate pages; low resolution image warning",
});
assert.equal(report.version, 1);
assert.equal(report.textDensity.charsPerPage, 1);
assert.equal(report.pageImageQuality.lowResolutionPages[0], 1);
assert.equal(report.toolSignals.skew, true);
assert.equal(report.toolSignals.rotation, true);
assert.equal(report.toolSignals.lowQuality, true);
assert.ok(report.score < 60);
assert.deepEqual(
  report.warnings.map((warning) => warning.code),
  [
    "low-text-density",
    "no-readable-paragraphs",
    "low-resolution-page-image",
    "deskew-applied",
    "rotation-detected",
    "tool-low-quality",
  ],
);
