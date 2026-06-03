# PaperLens TODO

Updated: 2026-06-03

## Current Problems

- [ ] 测试覆盖不足：核心路径仍以 `node --check`、health 和手工 API 测试为主，缺少 PDF fixture、Job Queue、导出 QA、LaTeX 渲染和 Provider 诊断回归测试。
- [ ] 长任务预算还不够透明：分析前缺少每篇论文预计 token、预计时间、预计费用/额度和任务级预算上限。
- [ ] 视觉结构仍不够可控：复杂双栏、多图组合、跨页图、公式/代码混排时，自动裁剪仍可能过大、误分类，用户还不能手动修正。

## Next

1. [ ] 自动化测试扩展：补最小 PDF fixture、导出 QA、Markdown/Word 导出和 Job Queue 恢复测试。
2. [ ] 长任务预算保护：每篇论文显示预计 token、预计时长、预计费用/额度，支持任务级最大预算，超限前提示。
3. [ ] 视觉裁剪编辑器：允许用户点击页面图像后手动框选/调整图片、公式、代码块，并重建相关段落引用。

## Later

- [ ] OCR 质量升级：自动检测 PDF 语言、页倾斜/低清晰度、OCR 后文本密度，并允许用户选择 OCR 语言后重跑。
- [ ] SQLite 持久化迁移：把论文、段落、Job、导出历史迁移到 SQLite，提供迁移脚本和回滚方案。
- [ ] 应用端打包：评估 Electron/Tauri/一键启动包，让非开发者下载后能直接运行。
- [ ] 部署模式升级：整理本地、Docker、内网分享、公网部署的差异和安全默认值。
- [ ] 视觉结构模型化：在启发式和像素裁剪之外，探索版面检测模型或可插拔视觉分析 Provider。

## Done

- [x] 视觉材料人工校正：图片/表格/公式/代码 artifact 支持前端改类型、修正文本文字、隐藏/恢复；隐藏项会退出 AI 上下文、导出和段落图表引用，并在视觉重建时尽量保留人工修正。
- [x] 文档同步：README、`.env.example` 和 setup 提示已更新到 Kimi Code Direct、真实论文跑通结果、碎片 LaTeX 修复、Docker/Claude CLI 关系和代理策略。
- [x] 公式 artifact 识别收紧：过滤图表坐标轴标签、超参数表格行和极短无意义公式碎片，并合并同一裁剪区域的公式片段。
- [x] 分段碎片与慢速退化修复：短续行合并放宽、PDF 图表/LaTeX 提取垃圾过滤，Kimi Code Direct 精读 batch 改为更稳的 4 段并避免 adaptiveBatchSize 永久退化到 1。
- [x] Provider mock 回归测试：抽出 OpenAI-compatible endpoint/payload/response/error 纯函数，覆盖 DeepSeek payload、额度/限流/认证错误和返回解析。
- [x] Kimi Direct 协议回归测试：抽出 Anthropic payload/header/response 纯函数并加入 `npm test`，避免 provider 改动破坏调用格式。
- [x] 自动化测试基础入口：新增 `npm test`、`scripts/test.mjs` 和首个碎片 LaTeX 回归测试，后续测试统一接入 `tests/*.test.mjs`。
- [x] Kimi Code Direct 通道：页面 Kimi Code Key 默认直连 `https://api.kimi.com/coding/v1/messages`，不依赖本机 `claude` CLI；Claude CLI 只保留为本机配置/可选后备。
- [x] 整篇论文真实跑通：TimesFM 论文使用 Kimi Code Direct 精读完成 `125/125` 段，失败 `0`，导出 QA 为 `ok`。
- [x] 碎片 LaTeX 渲染修复：展示前自动合并被换行拆碎的公式 token，例如 `y 1:L := \{ y 1, ⋯, y L \}` 会归一化为可渲染的 `$y_{1:L}:=\{y_{1},⋯,y_{L}\}$`。
- [x] Claude/Kimi 脱敏诊断包：新增 `/api/model/diagnostics` 和前端“诊断包”按钮，可复制 Provider、Key 摘要、Claude CLI、代理、预算、Docker/本机环境和建议，不返回明文 API Key。
- [x] 导出 QA 检查：新增 `/api/papers/:id/export-qa`，前端提供“导出检查”按钮和结果面板，覆盖未完成段落、坏图表引用、裁剪/资源缺失、低置信图和 LaTeX 风险。
- [x] 长任务资源保护：新增 `PAPERLENS_MAX_ANALYSIS_JOB_PARAGRAPHS`、`PAPERLENS_MAX_ANALYSIS_JOB_CHARS`、`PAPERLENS_MAX_AI_SEGMENTATION_PAGES`、`PAPERLENS_MAX_OCR_JOB_PAGES`、`PAPERLENS_MAX_VISUAL_REBUILD_*`；health 和前端状态显示当前上限。
- [x] JSON 持久化加固：论文、Job、加密 Secrets 走原子写入；论文/Job 保存后生成最近备份，读取损坏时自动从最新有效备份恢复；health 暴露 persistence 状态。
- [x] 分段编辑闭环：段落卡片支持隐藏/恢复、合并下段、用 `||` 拆分、改章节；后端保存人工覆盖，重建章节上下文和图表引用，只清空变动段落的旧分析。
- [x] Provider 代理传输升级：OpenAI-compatible 请求不再依赖普通 `fetch` 的代理能力，后端可通过 HTTP CONNECT 或 SOCKS5 tunnel 发起模型请求，诊断页显示传输模式和代理来源。
- [x] Provider 教程入口：把 Claude Code、Kimi、DeepSeek、代理和 Docker 环境差异收进模型面板教程，并给出检测与修复建议。
- [x] 部署安全基础层：可用 `PAPERLENS_ACCESS_TOKEN` 开启登录保护，API/导出/assets 需要 Cookie，health 显示公网风险，`data/secrets.json` 可加密保存。
- [x] 内置 OCR Job：扫描版 PDF 可在页面启动本机 OCR，后台队列调用 OCRmyPDF/Tesseract，完成后自动重新提取文本、段落和视觉结构。
- [x] 服务运行状态收敛：health schema v2 暴露后端版本、启动信息、源码/静态文件更新时间和 Job Queue 快照，页面会在旧进程/旧前端时显示修复命令。
- [x] 旧论文维护入口：支持批量重建视觉结构/图表裁剪，不必重新上传 PDF。
- [x] 速度与质量仪表盘：显示预计耗时、批次大小、并发、缓存命中、失败重试策略，并允许用户按“快速/精读”切换。
- [x] AI 分段质量巡检：分段后自动标记作者、链接、页眉页脚、图注、参考文献等噪声段落，避免直接进入讲解队列。
- [x] AI 分段升级：全文章节计划、局部分段、合并校验三阶段，支持跨页段落合并和上下文窗口。
- [x] PDF 视觉结构升级：生成 `visualRegions`，从几何裁剪升级到像素级非白区域检测，减少整块截图过大和图注/图片文字误归段落。
- [x] PDF 视觉资产交互升级：图片、公式、代码块裁剪支持定位整页、放大查看、下载和更清晰的相关段落入口。
- [x] LaTeX/公式渲染修复：兼容常见 `$...$`、`\(...\)`、`\[...\]`、残缺公式和解释文本中的 Markdown/LaTeX 混排。
- [x] 长任务断线恢复提示：`fail to fetch`、刷新、网络短断时明确提示后端任务仍在继续，并自动同步活跃 Job。
- [x] 开源易用性：首次配置教程、一键启动脚本、Docker Compose 模板完善。
- [x] 论文库能力：标签、收藏、全文搜索、阅读进度和导出历史。
- [x] 速度优化：缓存已完成段落、失败段落小批次、Provider 分流策略。
- [x] 导出格式升级：支持 `.docx`，保留章节、段落、图片和术语。
- [x] 导出升级：Markdown 笔记嵌入图表/公式/代码裁剪预览。
- [x] Markdown 导出原文、翻译、讲解、术语和相关图表引用。
- [x] 补跑失败/未完成段落，保留已成功结果。
- [x] 完整重跑：重新 AI 分段并重新生成全部段落。
