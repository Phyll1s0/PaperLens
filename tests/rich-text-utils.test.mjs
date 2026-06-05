import assert from "node:assert/strict";
import {
  buildSourceMarkdown,
  detectSourceLeadIn,
  isLikelyInlineMathDollarOpen,
  isLatexShardLine,
  isLikelyBrokenLatexBlock,
  normalizeBareLatexExpression,
  normalizeFormulaArtifactLatex,
  normalizeMathUnicodeAlphanumerics,
  normalizeRichTextSource,
} from "../public/rich-text-utils.js";

const fragmentedSetFormula = [
  "y",
  "1:L",
  ":",
  "=",
  "\\{",
  "y",
  "1",
  ",",
  "⋯",
  ",",
  "y",
  "L",
  "\\}",
].join("\n");

assert.equal(
  normalizeRichTextSource(fragmentedSetFormula),
  "$y_{1:L}:=\\{y_{1},⋯,y_{L}\\}$",
);

assert.equal(
  normalizeRichTextSource(`前文\n${fragmentedSetFormula}\n后文`),
  "前文\n$y_{1:L}:=\\{y_{1},⋯,y_{L}\\}$\n后文",
);

assert.equal(
  normalizeBareLatexExpression("x i = y i + 1"),
  "x_{i}=y_{i}+1",
);

assert.equal(
  isLikelyBrokenLatexBlock(["This is normal prose", "with several words", "not math"]),
  false,
);

assert.equal(isLatexShardLine("这是中文说明"), false);
assert.equal(isLatexShardLine("\\{"), true);

assert.equal(normalizeMathUnicodeAlphanumerics("𝑘×𝐵elem+𝐵meta+𝐵scale"), "k×Belem+Bmeta+Bscale");
assert.equal(isLikelyInlineMathDollarOpen("$0.5P + 0.25P$）", 0), true);
assert.equal(isLikelyInlineMathDollarOpen("$2^k$ is a power", 0), true);
assert.equal(isLikelyInlineMathDollarOpen("$X$ is a variable", 0), true);
assert.equal(isLikelyInlineMathDollarOpen("price $500 today", 6), false);
assert.equal(isLikelyInlineMathDollarOpen("$20$ is plain numeric", 0), false);
assert.equal(
  normalizeFormulaArtifactLatex("𝑘×𝐵elem + 𝐵meta + 𝐵scale"),
  "k×B_{\\mathrm{elem}}+B_{\\mathrm{meta}}+B_{\\mathrm{scale}}",
);
assert.equal(normalizeFormulaArtifactLatex("𝑝θ(x)=softmax(x)"), "p_{\\theta}(x)=\\softmax(x)");

const leadBlock = {
  lines: [
    { text: "Open Compute Project (OCP) Microscaling. Microscal-", x: 64, y: 357, width: 232, height: 14.48 },
    { text: "ing (MX) is a block floating-point format defined by the Open", x: 54, y: 369, width: 240, height: 13.77 },
  ],
};
const leadText = "Open Compute Project (OCP) Microscaling. Microscaling (MX) is a block floating-point format.";
assert.equal(detectSourceLeadIn(leadText, leadBlock)?.text, "Open Compute Project (OCP) Microscaling.");
assert.equal(
  buildSourceMarkdown(leadText, leadBlock),
  "**Open Compute Project (OCP) Microscaling.** Microscaling (MX) is a block floating-point format.",
);
assert.equal(buildSourceMarkdown("Recent advances in low-bit quantization have led to strong models. The next sentence remains plain."), "Recent advances in low-bit quantization have led to strong models. The next sentence remains plain.");
