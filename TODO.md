# PaperLens TODO

Updated: 2026-06-04

## Current Problems

- [ ] 测试覆盖仍需扩展：已有 Provider/Kimi/导出/Job/PDF/富文本/分段噪声/分段验证/模型诊断/视觉重建摘要/真实 PDF 视觉 fixture 测试，后续还缺上传 API 端到端和带 Poppler 的 CI 视觉回归。
- [ ] 视觉结构仍不够可控：复杂双栏、多图组合、跨页图、公式/代码混排时，自动裁剪仍可能过大、误分类，后续还需要更智能的自动识别。
- [ ] 精读分段入口仍需继续增强：已加入 Paper Memory 预读，但复杂双栏论文里，PDF block 排序、章节地图、References、表格主体、流程图文字、跨页自然段仍可能被误收或误合并；混合 block 还需要更精细的按行/按列重建。
- [ ] 跨页定位体验仍需升级：段落跨页、图表跨页和相关图表跳转需要更明确的页码锚点与整页定位反馈。

## Next

1. [ ] 精读分段入口继续增强：基于 Paper Memory 继续改善复杂双栏论文里的 PDF block 排序、章节地图、References、表格主体、流程图文字和跨页自然段。
2. [ ] 跨页定位体验升级：段落跨页、图表跨页和相关图表跳转需要更明确的页码锚点与整页定位反馈。

## Later

- [ ] OCR 质量升级：自动检测 PDF 语言、页倾斜/低清晰度、OCR 后文本密度，并允许用户选择 OCR 语言后重跑。
- [ ] SQLite 持久化迁移：把论文、段落、Job、导出历史迁移到 SQLite，提供迁移脚本和回滚方案。
- [ ] 应用端打包：评估 Electron/Tauri/一键启动包，让非开发者下载后能直接运行。
- [ ] 部署模式升级：整理本地、Docker、内网分享、公网部署的差异和安全默认值。
- [ ] 视觉结构模型化：在启发式和像素裁剪之外，探索版面检测模型或可插拔视觉分析 Provider。

## Done

- [x] 服务状态脚本修复：`npm run service:status` 会通过 health + 端口监听识别真实 PaperLens PID，自动修复 stale PID 文件；补上 `npm run service:restart`，启动/重启后回显真正监听 3000 的服务进程。
- [x] 精读 Paper Memory 预读：精读 AI 分段前先按原始 PDF blocks 预读整篇论文，合成 `paperMemory`，保留关键公式、图表、代码、资源链接和非正文提示；后续分段和精读讲解会引用这份记忆，快速模式不增加额外 AI 预读。
- [x] 真实 PDF 视觉 fixture 回归：抽出 `lib/visual-artifacts.js`，让上传/重建/裁剪 SVG 使用同一条可测链路；新增 fixture 覆盖页面图生成、视觉块识别、低置信公式摘要、像素收紧图表和 crop SVG 输出。
- [x] 视觉重建摘要回归测试：抽出 `lib/visual-rebuild-summary.js`，覆盖低置信/过大裁剪摘要、隐藏图表统计、人工裁剪保留和“只改裁剪框”重建不丢失。
- [x] 视觉裁剪编辑器：图表/公式/代码块新增“裁剪”入口；放大查看器可直接进入编辑器，支持在整页图上拖动/框选/四角缩放和 x/y/w/h 精调，保存后后端更新 crop SVG、标记 manual crop，并在视觉重建时保留人工裁剪。
- [x] 长任务预算保护：新增任务级 `Task Budget USD`，分析前显示预计 token、耗时、费用和预算状态；后端创建分析任务/补跑失败项时强制拦截超预算请求，并把预算估算写入 Job 轮询和历史。
- [x] 章节地图入口升级：新增 `lib/segmentation-structure.js`，本地 layout fallback 会从 PDF heading 识别多章节结构；过滤标题、作者、图注、坐标轴、年份参考文献等伪 heading，并让本地段落按实际 heading 顺序生成 sections。
- [x] 模型诊断报告回归测试：抽出 `lib/model-diagnostics.js`，覆盖 Kimi Code Direct、Claude 本机配置、保存 Key 引用错配、代理/URL 脱敏、预算和 Docker 建议，确保诊断包不泄露完整 API Key。
- [x] 分段调试视图二期：调试报告保留页图信息；前端支持点击 PDF block 在页图上框选定位，对比 PDF block 与当前段落，并下载完整调试 JSON。
- [x] 视觉重建回归集：抽出 `lib/visual-crop-quality.js`，固化裁剪归一化、低置信/过大裁剪、像素精修置信度、`Figure 1.` / `Table 1.`、公式/代码/表格误分类样例。
- [x] 混合 block 重建二期：Poppler 和 Swift PDF 提取会保存 block 内 line 坐标；混合作者/机构/元数据 block 优先按 line 重建多个正文片段，并把精确 bbox 传给段落来源和调试面板。
- [x] 真实 PDF 分段 fixture 扩展：新增 M2XFP/Chronos/Kronos 最小 JSON fixture 和回归测试，覆盖复杂双栏、混合作者块、OpenReview/代码链接、running header、图表 caption、模型配置表、章节 heading 和跨页续写线索。
- [x] 混合 PDF block 正文救回一期：当作者/机构/元数据 block 内夹着摘要或正文尾句时，先救回可读正文片段，再交给本地分段和 AI 分段窗口，避免整块误删正文。
- [x] 分段调试视图一期：新增 `/api/papers/:id/segmentation-debug` 和前端“分段调试”面板，展示 PDF block 页码/坐标、清洗后文本、保留/丢弃理由、heading 候选、段落来源和 fallback 元信息。
- [x] 分段入口清洗一期：PDF block 进入精读前会剥离嵌入正文的 arXiv stamp/会议元数据，过滤首页标题、作者多邮箱块和版权/ACM 元数据；论文标题改从原始首页 block 推断；页面明确标出 layout 本地兜底。
- [x] 精读分段样例集一期：抽出 `lib/segmentation-validation.js`，让服务和测试共用分段验证/噪声巡检；覆盖 Chronos 跨页续段、Kronos 章节边界、M2XFP 表格主体、caption、References 和重复页眉噪声。
- [x] 分段噪声回归基础：抽出 References/参考文献条目/页码页眉判断到 `lib/segmentation-repair.js`，覆盖 arXiv/URL 引用、References heading 和 running header，避免它们误入正文精读。
- [x] 图表/公式展示修复：图表卡片和放大预览改为直接使用后端裁剪 SVG，避免整页图 CSS 位移导致白图/错位；caption 识别兼容 `Figure 1.` / `Table 1.`；公式 artifact 渲染增加数学 Unicode 字母和常见下标词归一。
- [x] 视觉质量摘要：论文顶部统计显示图表/公式/代码裁剪数量，并在存在缺裁剪、低置信或过大裁剪时提示“裁剪待查”，便于判断是否需要重建图表。
- [x] Job Queue 恢复回归测试：抽出 `lib/job-recovery.js`，让服务启动恢复和测试共用任务状态规则；覆盖 running/canceling/queued/done/error/canceled、运行中 item 清理、外部活跃 worker 跳过和中断任务重新入队。
- [x] 最小 PDF fixture 回归测试：抽出 `lib/pdf-extraction.js`，让上传/OCR 重提取和测试共用 PDF 提取逻辑；新增最小 PDF fixture，覆盖 Poppler bbox XML 解析、实体转义、区块坐标，并在本机 Poppler 可用时跑真实 PDF 提取。
- [x] Word 导出回归测试：抽出 `lib/export-docx.js`，让 `.docx` 下载 API 和测试共用导出逻辑；覆盖 docx zip 结构、document XML、媒体关系、图片文件、隐藏图表过滤和 XML 转义。
- [x] Markdown 导出回归测试：抽出 `lib/export-markdown.js`，让 Markdown 下载 API 和测试共用导出逻辑；覆盖章节、页码、术语去重、尚未生成段落、隐藏图表过滤和裁剪图片链接。
- [x] 导出 QA 回归测试：抽出 `lib/export-qa.js`，让 API 和测试共用导出检查逻辑；覆盖隐藏图表引用、缺失图表引用、缺失裁剪、缺失图片、低置信裁剪和 LaTeX 风险。
- [x] Markdown 表格与公式展示升级：问答/讲解中的 Markdown 表格会渲染为真实表格，并兼容模型把表格行压成一行的情况；公式 artifact 展示层增加 LaTeX 化归一，优先用 display math 呈现。
- [x] Markdown 阅读块统一：原文、翻译、讲解、追问问答、视觉材料说明统一走块级 Markdown 渲染，支持标题、段落、列表、引用、分隔线、代码围栏和公式块；局部刷新会保留当前视口，避免提问后跳回顶部。
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
