import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(path.join(rootDir, file), "utf8");

const readme = await read("README.md");
const docsIndex = await read("docs/README.md");
const usage = await read("docs/USAGE.md");
const gettingStarted = await read("docs/GETTING_STARTED.md");
const installation = await read("docs/INSTALLATION.md");
const configuration = await read("docs/CONFIGURATION.md");
const pdfStrategy = await read("docs/PDF_STRATEGY.md");
const troubleshooting = await read("docs/TROUBLESHOOTING.md");
const migration = await read("docs/MIGRATION.md");
const visualProvider = await read("docs/VISUAL_PROVIDER.md");
const deployment = await read("docs/DEPLOYMENT.md");
const appSource = await read("public/app.js");
const packageJson = JSON.parse(await read("package.json"));

assert.ok(readme.split(/\r?\n/).length <= 120, "README should stay concise and link to docs for detail");
assert.match(readme, /\[文档目录\]\(docs\/README\.md\)/);
assert.match(readme, /\[具体怎么用\]\(docs\/USAGE\.md\)/);
assert.match(readme, /\(docs\/GETTING_STARTED\.md\)/);
assert.match(readme, /git clone https:\/\/github\.com\/Phyll1s0\/PaperLens\.git/);
assert.match(readme, /npm run data:export/);

assert.equal(packageJson.scripts["data:export"], "node scripts/export-portable-data.mjs");
assert.equal(packageJson.scripts["data:import"], "node scripts/import-portable-data.mjs");

assert.match(docsIndex, /\[具体怎么用\]\(USAGE\.md\)/);
assert.match(docsIndex, /\[安装和运行\]\(INSTALLATION\.md\)/);
assert.match(docsIndex, /\[PDF 解析策略\]\(PDF_STRATEGY\.md\)/);
assert.match(docsIndex, /\[迁移和备份\]\(MIGRATION\.md\)/);

assert.match(usage, /# 如何用 PaperLens 精读一篇论文/);
assert.match(usage, /测试连接/);
assert.match(usage, /质量报告/);
assert.match(usage, /分段调试/);
assert.match(usage, /下载Word/);

assert.match(gettingStarted, /# PaperLens Getting Started/);
assert.match(gettingStarted, /Kimi Code Direct/);
assert.match(gettingStarted, /DeepSeek/);
assert.match(gettingStarted, /不需要 Claude CLI/);
assert.match(gettingStarted, /npm run data:export/);
assert.match(gettingStarted, /npm run data:import -- \/path\/to\/paperlens-data-时间戳\.tar\.gz --yes/);
assert.match(gettingStarted, /质量报告/);
assert.match(gettingStarted, /分段调试/);

assert.match(installation, /PaperLens-local\.tar\.gz/);
assert.match(installation, /普通用户第一次使用不需要先装齐所有可选工具/);
assert.match(configuration, /PAPERLENS_PROXY_URL/);
assert.match(configuration, /PAPERLENS_OCR_LANGUAGE/);
assert.match(pdfStrategy, /# PDF 解析策略/);
assert.match(pdfStrategy, /AI-first PDF/);
assert.match(pdfStrategy, /Poppler、OCRmyPDF、Tesseract、Docker 和 Claude CLI 都应该是“增强能力”/);
assert.match(troubleshooting, /页面打不开/);
assert.match(migration, /npm run data:export/);
assert.match(migration, /PAPERLENS_STORAGE=sqlite/);
assert.match(visualProvider, /PAPERLENS_VISUAL_PROVIDER/);
assert.match(deployment, /PAPERLENS_DEPLOYMENT_MODE=public/);

assert.match(appSource, /function getProviderGuideSteps/);
assert.match(appSource, /选择入口/);
assert.match(appSource, /填写 Key/);
assert.match(appSource, /代理可选/);
assert.match(appSource, /测试后再上传/);
