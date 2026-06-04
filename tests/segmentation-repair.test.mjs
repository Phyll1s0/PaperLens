import assert from "node:assert/strict";
import {
  isLikelyBibliographyEntryText,
  isLikelyPageNumberOrRunningHeaderText,
  isLikelyPublicationMetadataText,
  isLikelyPdfExtractionGarbageText,
  isLikelyReferencesHeadingBlock,
  isReferencesSectionTitleText,
  shouldMergeSegmentedText,
  startsLikeTextContinuation,
  stripPublicationMetadataFragments,
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

const asplosHeader = "ASPLOS ’26, March 22–26, 2026, Pittsburgh, PA, USA";
assert.equal(isLikelyPublicationMetadataText(asplosHeader), true);
assert.equal(
  stripPublicationMetadataFragments(asplosHeader),
  "",
);
assert.equal(
  stripPublicationMetadataFragments(`State-of-the-art deployments involve hundreds of billions of parameters, such as ${asplosHeader}`),
  "State-of-the-art deployments involve hundreds of billions of parameters,",
);
assert.equal(
  stripPublicationMetadataFragments(`The design introduces minimal metadata ${asplosHeader} val[3:0] Top-1 Decode Unit`),
  "The design introduces minimal metadata val[3:0] Top-1 Decode Unit",
);
assert.equal(
  isLikelyPublicationMetadataText("Existing low-bit formats often suffer from substantial accuracy degradation."),
  false,
);

assert.equal(
  isLikelyBibliographyEntryText("[1] Ebtesam Almazrouei, Hamza Alobeidli, Abdulaziz Alshamsi, Alessandro Cappelli, Ruxandra Cojocaru, and Daniel Hesslow. The Falcon Series of Open Language Models. arXiv:2311.16867."),
  true,
);
assert.equal(
  isLikelyBibliographyEntryText("https://arxiv.org/abs/2110.14168 [9] Jack Cook, Junxian Guo, and others. Compression for language models."),
  true,
);
assert.equal(
  isLikelyBibliographyEntryText("2023. GPTQ: Accurate Post-Training Quantization for Generative Pre-trained Transformers. arXiv:2210.17323 [cs.LG]."),
  true,
);
assert.equal(
  isLikelyBibliographyEntryText("We compare quantization methods [9] and report perplexity in Table 2."),
  false,
);

assert.equal(isReferencesSectionTitleText("References"), true);
assert.equal(isReferencesSectionTitleText("1 References"), true);
assert.equal(isReferencesSectionTitleText("1. References"), true);
assert.equal(isReferencesSectionTitleText("Bibliography:"), true);
assert.equal(isReferencesSectionTitleText("References are discussed in Section 2."), false);
assert.equal(isLikelyReferencesHeadingBlock({ text: "References", lineCount: 1, width: 64 }), true);
assert.equal(isLikelyReferencesHeadingBlock({ text: "References", lineCount: 3, width: 64 }), false);
assert.equal(isLikelyReferencesHeadingBlock({ text: "References are discussed in Section 2.", lineCount: 1, width: 260 }), false);

assert.equal(isLikelyPageNumberOrRunningHeaderText("Page 2 of 17"), true);
assert.equal(isLikelyPageNumberOrRunningHeaderText("12"), true);
assert.equal(isLikelyPageNumberOrRunningHeaderText("Preprint version"), true);
assert.equal(isLikelyPageNumberOrRunningHeaderText("The preprint version improves several baselines."), false);

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
