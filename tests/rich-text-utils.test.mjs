import assert from "node:assert/strict";
import {
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
assert.equal(
  normalizeFormulaArtifactLatex("𝑘×𝐵elem + 𝐵meta + 𝐵scale"),
  "k×B_{\\mathrm{elem}}+B_{\\mathrm{meta}}+B_{\\mathrm{scale}}",
);
assert.equal(normalizeFormulaArtifactLatex("𝑝θ(x)=softmax(x)"), "p_{\\theta}(x)=\\softmax(x)");
