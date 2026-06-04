import assert from "node:assert/strict";
import {
  rebuildReadableBlocksFromLineClusters,
} from "../lib/segmentation-line-rebuild.js";

const twoColumnBlock = {
  text: [
    "The left column introduces the tokenizer and explains why the coarse codebook preserves trend information.",
    "It then describes how the fine codebook captures local residual variation for later decoding.",
    "The right column discusses the decoder and reports how uncertainty is calibrated during generation.",
    "It finally connects the sampling procedure to the downstream forecasting benchmark.",
  ].join(" "),
  x: 48,
  y: 100,
  width: 512,
  height: 88,
  lineCount: 4,
  lines: [
    line("The left column introduces the tokenizer and explains why the coarse codebook preserves trend information.", 54, 100, 220, 14),
    line("It then describes how the fine codebook captures local residual variation for later decoding.", 54, 118, 220, 14),
    line("The right column discusses the decoder and reports how uncertainty is calibrated during generation.", 330, 100, 220, 14),
    line("It finally connects the sampling procedure to the downstream forecasting benchmark.", 330, 118, 220, 14),
  ],
};

const twoColumnSegments = rebuildReadableBlocksFromLineClusters(twoColumnBlock, { pageNumber: 3, width: 600, height: 800 });
assert.equal(twoColumnSegments.length, 2);
assert.match(twoColumnSegments[0].text, /left column introduces/);
assert.doesNotMatch(twoColumnSegments[0].text, /right column/);
assert.match(twoColumnSegments[1].text, /right column discusses/);
assert.equal(twoColumnSegments[0].x, 54);
assert.equal(twoColumnSegments[0].height, 32);
assert.equal(twoColumnSegments[0].rebuiltFromLineCluster, true);

const formulaMixedBlock = {
  text: [
    "The model defines the objective before presenting the exact optimization expression.",
    "L(theta) = sum_t log p(y_t | y_<t) + lambda ||theta||_2",
    "where y_t denotes the target token and theta denotes the model parameters used by the decoder.",
    "The decoder then predicts future tokens autoregressively with the reconstructed context.",
  ].join(" "),
  x: 54,
  y: 220,
  width: 500,
  height: 92,
  lineCount: 4,
  lines: [
    line("The model defines the objective before presenting the exact optimization expression.", 54, 220, 430, 14),
    line("L(theta) = sum_t log p(y_t | y_<t) + lambda ||theta||_2", 120, 242, 340, 14),
    line("where y_t denotes the target token and theta denotes the model parameters used by the decoder.", 54, 268, 430, 14),
    line("The decoder then predicts future tokens autoregressively with the reconstructed context.", 54, 286, 430, 14),
  ],
};

const formulaSegments = rebuildReadableBlocksFromLineClusters(formulaMixedBlock, { pageNumber: 4, width: 600, height: 800 });
assert.equal(formulaSegments.length, 2);
assert.match(formulaSegments[0].text, /defines the objective/);
assert.doesNotMatch(formulaSegments[0].text, /L\\(theta\\)/);
assert.match(formulaSegments[1].text, /where y_t denotes/);
assert.equal(formulaSegments[1].y, 268);

const normalBlock = {
  text: "This normal paragraph has line coordinates but should remain a single block because it has no column split, formula island, or paragraph-sized gap.",
  x: 54,
  y: 100,
  width: 420,
  height: 50,
  lineCount: 3,
  lines: [
    line("This normal paragraph has line coordinates but should remain a single block", 54, 100, 420, 14),
    line("because it has no column split, formula island, or paragraph-sized gap.", 54, 118, 410, 14),
    line("The final line simply completes the same paragraph.", 54, 136, 300, 14),
  ],
};

assert.deepEqual(
  rebuildReadableBlocksFromLineClusters(normalBlock, { pageNumber: 5, width: 600, height: 800 }),
  [],
);

function line(text, x, y, width, height) {
  return { text, x, y, width, height };
}
