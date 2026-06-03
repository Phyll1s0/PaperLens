import assert from "node:assert/strict";
import {
  isLikelyPdfExtractionGarbageText,
  shouldMergeSegmentedText,
  startsLikeTextContinuation,
} from "../lib/segmentation-repair.js";

assert.equal(
  isLikelyPdfExtractionGarbageText('Original Time Series <latexit sha1_base64="abc">AAAy'.padEnd(260, "A")),
  true,
);
assert.equal(isLikelyPdfExtractionGarbageText("\u0000L\u0000o\u0000s\u0000s\u0000 graph labels"), true);
assert.equal(
  isLikelyPdfExtractionGarbageText("Chronos tokenizes time series values using scaling and quantization into a fixed vocabulary."),
  false,
);

assert.equal(startsLikeTextContinuation("for forecasting, the field has yet to converge"), true);
assert.equal(startsLikeTextContinuation("(GPT4TS) are only compared based on MASE."), true);
assert.equal(startsLikeTextContinuation("Introduction"), false);

assert.equal(
  shouldMergeSegmentedText(
    "Time series forecasting has traditionally been dominated by statistical models and recent neural models ".repeat(12).trim(),
    "for forecasting, the field has yet to converge on a unified general-purpose model.",
  ),
  true,
);
assert.equal(
  shouldMergeSegmentedText("This paragraph is complete.", "The next paragraph starts a new idea."),
  false,
);
assert.equal(
  shouldMergeSegmentedText("A clean paragraph without a closing sentence", "\u0000g\u0000a\u0000r\u0000b\u0000a\u0000g\u0000e"),
  false,
);
