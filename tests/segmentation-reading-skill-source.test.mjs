import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../server.js", import.meta.url), "utf8");

assert.match(source, /const SEGMENTATION_READING_SKILL = \[/);
assert.match(source, /只处理页面文本里真实出现的内容/);
assert.match(source, /超过 1200 字符时，必须按真实语义边界拆开/);
assert.match(source, /页眉、会议名、作者名不能触发跨页合并/);
assert.match(source, /SEGMENTATION_READING_SKILL,\n\s+"只输出合法 JSON/);

