import assert from "node:assert/strict";
import {
  cleanupRescuedBodyText,
  rebuildReadableSegmentsFromBlockLines,
  rescueReadableSegmentsFromMixedBlock,
} from "../lib/segmentation-block-rescue.js";

const mixedM2xfpBlock = {
  pageNumber: 1,
  lineCount: 40,
  text: [
    "Zihan Zhang Haoyan Zhang tiancaizhangdaxian@sjtu.edu.cn h.y.zhang-zdy@sjtu.edu.cn",
    "Shanghai Jiao Tong University Shanghai, China Shanghai Qi Zhi Institute Shanghai, China",
    "Cong Guo Yu Feng guocong@sjtu.edu.cn y-feng@sjtu.edu.cn Shanghai Jiao Tong University Shanghai, China",
    "Guanglin Li Guipeng Hu liguanglin10@huawei.com huguipeng@huawei.com Computing Product Line, Huawei Shanghai, China",
    "Jingwen Leng leng-jw@sjtu.edu.cn Shanghai Jiao Tong University Shanghai, China Shanghai Qi Zhi Institute Shanghai, China",
    "37.30% reduction relative to the latest NVFP4 on LLM benchmarks.",
    "Furthermore, our design delivers up to 1.91x speedup and 1.75x energy savings over state-of-the-art accelerators.",
    "Our code is available at https://github.com/SJTU-ReArch-Group/M2XFP_ASPLOS26.",
    "CCS Concepts: Computer systems organization -> Systolic arrays.",
  ].join(" "),
};

const rescued = rescueReadableSegmentsFromMixedBlock(mixedM2xfpBlock);
assert.equal(rescued.length, 1);
assert.match(rescued[0].text, /37\.30% reduction/);
assert.match(rescued[0].text, /1\.91x speedup/);
assert.equal(/@sjtu|@huawei|github|CCS Concepts/i.test(rescued[0].text), false);
assert.equal(rescued[0].reason, "mixed-block-body-tail");
assert.ok(rescued[0].startOffset > 0);

assert.deepEqual(
  rescueReadableSegmentsFromMixedBlock({
    pageNumber: 1,
    text: "Alice alice@example.com University Lab Bob bob@example.edu Institute China",
  }),
  [],
);

assert.deepEqual(
  rescueReadableSegmentsFromMixedBlock({
    pageNumber: 3,
    text: "Our code is available at https://example.com/project. CCS Concepts: Computing methodologies.",
  }),
  [],
);

assert.equal(
  cleanupRescuedBodyText("Furthermore, the result improves accuracy. Our code is available at https://example.com."),
  "Furthermore, the result improves accuracy.",
);

const lineBasedMixedBlock = {
  pageNumber: 1,
  text: [
    "Alice alice@example.com University Lab",
    "Shanghai Jiao Tong University Shanghai, China",
    "37.30% reduction relative to the latest NVFP4 on LLM benchmarks.",
    "Furthermore, our design delivers up to 1.91x speedup and 1.75x energy savings over state-of-the-art accelerators.",
    "Our code is available at https://example.com/project.",
    "Evaluation results demonstrate that the rebuilt line segment remains separate from metadata.",
    "This second sentence should become a second rescued segment.",
  ].join(" "),
  lines: [
    line("Alice alice@example.com University Lab", 40, 100, 240, 12),
    line("Shanghai Jiao Tong University Shanghai, China", 40, 116, 250, 12),
    line("37.30% reduction relative to the latest NVFP4 on LLM benchmarks.", 40, 160, 310, 12),
    line("Furthermore, our design delivers up to 1.91x speedup and 1.75x energy savings over state-of-the-art accelerators.", 40, 176, 430, 12),
    line("Our code is available at https://example.com/project.", 40, 210, 260, 12),
    line("Evaluation results demonstrate that the rebuilt line segment remains separate from metadata.", 40, 240, 380, 12),
    line("This second sentence should become a second rescued segment.", 40, 256, 300, 12),
  ],
};

const lineSegments = rebuildReadableSegmentsFromBlockLines(lineBasedMixedBlock);
assert.equal(lineSegments.length, 2);
assert.equal(lineSegments[0].reason, "mixed-block-line-rebuild");
assert.match(lineSegments[0].text, /37\.30% reduction/);
assert.match(lineSegments[0].text, /1\.91x speedup/);
assert.equal(lineSegments[0].box.y, 160);
assert.equal(lineSegments[0].box.height, 28);
assert.equal(lineSegments[0].lineCount, 2);
assert.equal(/example.com|alice@example/i.test(lineSegments[0].text), false);
assert.match(lineSegments[1].text, /Evaluation results/);
assert.equal(lineSegments[1].box.y, 240);

const preferredLineSegments = rescueReadableSegmentsFromMixedBlock(lineBasedMixedBlock);
assert.deepEqual(preferredLineSegments.map((segment) => segment.reason), [
  "mixed-block-line-rebuild",
  "mixed-block-line-rebuild",
]);

function line(text, x, y, width, height) {
  return { text, x, y, width, height };
}
