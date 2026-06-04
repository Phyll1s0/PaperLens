import assert from "node:assert/strict";
import {
  cleanupRescuedBodyText,
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
