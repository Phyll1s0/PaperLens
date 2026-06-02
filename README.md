# PaperLens

PaperLens 是一个本地优先的论文精读 Web 应用原型。它可以上传 PDF、提取段落、保留原文，并通过 OpenAI-compatible 模型生成翻译、讲解和段落级追问回答；完成后可以下载包含原文、翻译、讲解、术语和相关图表的 Markdown 笔记或 Word 文档。

## 启动

### 快速开始

本机运行：

```bash
npm run setup
npm run dev
```

打开：

```text
http://127.0.0.1:3000
```

`npm run setup` 会创建缺失的本地目录、从 `.env.example` 生成 `.env`，并检查 Node、Docker、Poppler 和 Claude Code CLI 是否可用。只想检查环境而不写文件，可以运行：

```bash
npm run setup -- --check
```

Docker 运行：

```bash
npm run docker:up
npm run docker:logs
```

### 可选配置

如果网络需要代理，先复制配置模板：

```bash
cp .env.example .env
```

本机运行或 macOS launchd 使用宿主机代理地址：

```text
PAPERLENS_PROXY_URL=http://127.0.0.1:7897
```

Docker Desktop 里容器访问宿主机代理要写成：

```text
PAPERLENS_PROXY_URL=http://host.docker.internal:7897
```

不需要代理就保持 `PAPERLENS_PROXY_URL=` 为空。

`npm start`、本机后台脚本、macOS launchd 和 Docker Compose 都会读取这份 `.env`。

也可以不写 `.env`，直接在网页的模型设置里填 `Proxy URL`。这个值只保存在当前浏览器会话中，适合每个使用者按自己的代理端口临时配置。

扫描版 PDF 可以在页面里点击“本机 OCR 并重新解析”。PaperLens 会调用本机 `ocrmypdf` 和 `tesseract`，生成可搜索 PDF 后自动重新提取段落、页面结构和图表裁剪。本机需要先安装：

```bash
brew install ocrmypdf tesseract tesseract-lang
```

默认 OCR 语言是英文：

```text
PAPERLENS_OCR_LANGUAGE=eng
```

中英文混排论文可改成：

```text
PAPERLENS_OCR_LANGUAGE=eng+chi_sim
```

### 本机前台运行

```bash
npm run dev
```

打开：

```text
http://127.0.0.1:3000
```

### 本机后台运行

如果不想终端关闭后服务也停掉，可以用：

```bash
npm run service:start
npm run service:status
npm run service:stop
```

日志写入：

```text
.cache/paperlens.log
```

macOS 上更稳定的方式是安装 launchd 服务，它会在服务退出后自动拉起：

```bash
npm run launchd:install
npm run launchd:status
npm run launchd:uninstall
```

launchd 日志写入：

```text
.cache/paperlens.launchd.log
.cache/paperlens.launchd.err.log
```

### Docker 稳定运行

Docker 版本使用 Linux Poppler 提取 PDF，并启用 `restart: unless-stopped`，更适合长期运行和部署：

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f paperlens
```

也可以使用 npm 快捷命令：

```bash
npm run docker:up
npm run docker:logs
npm run docker:down
```

停止：

```bash
docker compose down
```

Docker 会用 named volumes 持久化 `uploads/`、`data/`、`paper-assets/` 和 `.cache/`。

Docker Compose 会自动读取 `.env` 中的 `PAPERLENS_PROXY_URL` 和 `PAPERLENS_OCR_LANGUAGE`。Docker 镜像会安装 OCRmyPDF、Tesseract 英文/简体中文语言包和 Claude Code CLI，因此扫描版 PDF OCR 与 `Claude Code + Kimi Code Key` Provider 都可以在容器内运行。`Claude Code 本机配置` Provider 仍然依赖容器内自己的环境变量或配置，不会自动读取宿主机的 `~/.claude`。

默认端口是 `3000`。如果宿主机端口被占用，可在 `.env` 设置：

```text
PAPERLENS_PORT=3010
```

## 当前能力

- 上传 PDF。
- Docker/Linux 使用 Poppler 提取文本和页面快照；macOS 本机自动回退 PDFKit。
- 扫描版 PDF 支持本机 OCR Job，完成后自动重新提取文本、段落和视觉结构。
- 论文库支持收藏、标签、全文搜索、阅读进度和导出历史。
- 自动切分段落并生成基础目录。
- 可在上传后使用 AI 重新分段。
- AI 分段会带上一窗口摘要和尾段作为上下文，并保存章节摘要、关键词和跨页续接线索。
- 可在上传后自动逐段生成翻译、讲解和关键词，并显示后端持久化 Job 进度。
- 自动分析会按 Provider 分流批处理；Claude Code Agent 低并发大批次，DeepSeek/OpenAI-compatible 更偏吞吐，并会缓存已完成段落。
- 分析任务支持刷新后恢复、任务历史查看和失败段落小批次重跑。
- 在浏览器会话中保存模型配置和本地 key id，不保存完整 API Key。
- 后端只在本地私有 `data/secrets.json` 保存完整 API Key，任务文件只保存 key id。
- 对单个段落生成翻译、讲解和关键词。
- 段落分析会结合邻近段落、相关图表 caption 和前文术语。
- 段落分析上下文窗口会额外结合全文关键词、章节摘要和同引用窗口。
- 公式和代码块会保留页面原始截图裁剪，支持点击放大查看。
- 对单个段落进行追问，并结合附近段落回答。

## 模型配置

支持 OpenAI-compatible `/chat/completions` 接口：

- DeepSeek Base URL：`https://api.deepseek.com`
- DeepSeek Model：`deepseek-v4-flash` 或 `deepseek-v4-pro`
- Claude Code + Kimi Code Key：本机 `claude` CLI + 页面输入的 Kimi Code Key，Base URL 显示为 `local:claude-kimi`
- Claude Code 本机配置：使用本机 Claude Code 已登录/已配置的认证，不读取页面 API Key
- Kimi Code Base URL：`https://api.kimi.com/coding/v1`
- Kimi Code Model：`kimi-for-coding`
- Kimi 开放平台 Base URL：`https://api.moonshot.cn/v1`
- Kimi 开放平台 K2.6 Model：`kimi-k2.6`
- OpenAI Base URL 示例：`https://api.openai.com/v1`
- OpenAI Model 示例：`gpt-4.1-mini`
- API Key 提交成功后会写入本机私有 `data/secrets.json`，浏览器只保存本地 key id；`data/` 已被 `.gitignore` 忽略。

注意：`www.kimi.com/code/console` 生成的是 Kimi Code Key，它和 Kimi 开放平台 Key 不通用。Kimi Code Key 使用 `https://api.kimi.com/coding/v1` 和 `kimi-for-coding`，但官方可能限制它只给 Coding Agent 使用。论文阅读这类普通应用建议使用 Kimi 开放平台 Key。

如果要在 PaperLens 中使用 Kimi Code Key，可以选择 `Claude Code + Kimi Code Key` Provider。它不会直接从网页伪装调用 Kimi Code API，而是让后端调用本机已安装的 Claude Code CLI，并通过 Anthropic-compatible endpoint `https://api.kimi.com/coding/` 访问 Kimi Code。为降低风险，PaperLens 调用时会使用 `--bare`、`--setting-sources project`、`--no-session-persistence`、`--tools ""`，只传入文本任务，并避免本机用户级 Claude settings 覆盖页面输入的 key。

如果网页提示找不到 `claude` CLI，请确认本机能运行 `claude --version`。macOS launchd 服务会把 `/opt/homebrew/bin`、`/usr/local/bin`、`~/.local/bin` 加入 PATH；如果你的 Claude Code 安装在其他位置，可以设置 `PAPERLENS_CLAUDE_CLI=/path/to/claude`。

如果你的网络必须通过代理访问模型服务，最简单是在网页模型设置里填 `Proxy URL`；也可以在 `.env` 里设置 `PAPERLENS_PROXY_URL`。本机后台脚本、macOS launchd 和 Docker Compose 都会读取它；网页模型诊断里也会显示 `Proxy: detected`。也可以直接设置 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY`。

AI 分段会走三阶段：先做全文结构预扫描，生成标题、正文起点、References 起点、章节页码、非正文区域地图和 `segmentationPlan`；再按 3 页左右的窗口局部分段，每个 heading/paragraph 会尽量绑定计划章节，并带着结构地图、前序摘要和尾段上下文；最后做合并校验，统一修正章节归属、过滤作者/链接/图注/参考文献等非正文碎片，并合并跨页或断句段落。上传和打开旧论文时还会生成页面 `visualRegions`，用几何位置识别图片、表格、公式、代码等视觉区域，再用页面 PNG 的非白像素收紧裁剪边界，并优先用这些区域裁剪图表。长任务默认按“精读质量优先”优化：后端会把段落合并成批次，并发跑多个批次并安全合并写入；已完成段落会写入本地分析缓存，补跑或全量任务会优先复用相同段落的翻译/讲解；失败项重跑会自动降到小批次，批量失败后也会自适应缩小后续批次。每段讲解会覆盖段落含义、论文中的作用、关键概念/公式/图表关系和阅读难点。`.env` 可调整：`PAPERLENS_ANALYSIS_TARGET_MINUTES=20` 控制目标耗时估算，`PAPERLENS_AGENT_ANALYSIS_BATCH_SIZE=8` / `PAPERLENS_AGENT_ANALYSIS_CONCURRENCY=2` 控制 Claude Code Agent，`PAPERLENS_ANALYSIS_BATCH_SIZE=12` / `PAPERLENS_ANALYSIS_CONCURRENCY=3` 控制普通 OpenAI-compatible，`PAPERLENS_ANALYSIS_FAILED_RETRY_BATCH_SIZE=2` 控制失败补跑小批次。批次和并发越大越快，但更容易触发限流、超时或 JSON 不完整；如果想进一步提速，可以把批次调高，但讲解质量会受影响。

重跑分三种：段落卡片按钮只重跑单段；工具栏“补跑失败/未完成”只跑失败、缺翻译或缺讲解的段落，保留已经成功的结果；“重新分段并生成全部”会先重新 AI 分段，再清空并重跑全部新段落。

工具栏“下载笔记”会导出 Markdown 文件，按段落保存原文、翻译、讲解、术语和相关图表引用，适合继续整理到 Obsidian、Notion 或其他笔记系统。“下载Word”会导出 `.docx`，保留章节、段落、术语和图表裁剪预览，适合直接打印、分享或继续编辑。

侧边栏论文库可以搜索标题、标签、原文、翻译、讲解和术语；收藏论文会固定在列表上方。打开论文后可直接编辑标签，阅读时会自动保存当前段落进度，导出 Markdown 或 Word 后会写入导出历史。

## 项目结构

```text
.
├── public/
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── scripts/
│   ├── extract_pdf_text.swift
│   ├── healthcheck.mjs
│   ├── setup.mjs
│   ├── dev.mjs
│   ├── paperlens-launchd.sh
│   ├── paperlens-service.sh
│   ├── diagnose_deepseek_key.mjs
│   ├── diagnose_kimi_code_key.mjs
│   ├── diagnose_kimi_key.mjs
│   └── check_kimi_key.mjs
├── Dockerfile
├── docker-compose.yml
├── server.js
├── ROADMAP.md
├── design.md
└── ideas.md
```

本地生成内容会写入 `uploads/`、`data/`、`paper-assets/` 和 `.cache/`，这些目录不会提交到 Git。

## 部署说明

推荐先用 Docker 部署到支持长期运行容器和持久化磁盘的平台，例如 VPS、Render 或 Fly.io。容器内默认：

```text
HOST=0.0.0.0
PORT=3000
PAPERLENS_PDF_ENGINE=poppler
```

镜像内包含：

```text
poppler-utils
@anthropic-ai/claude-code
```

健康检查：

```text
GET /api/health
```

不要把 API Key 写进镜像或仓库。PaperLens 会把完整 Key 放在本机私有 `data/secrets.json`，页面和 Job 只保存本地 key id。

## 后续建议

下一步可以补强：

- 更可靠的图表、公式、代码视觉结构识别。
- 全文摘要、章节摘要和术语表。
- 向量检索，替代当前的邻近段落上下文。
- 本地 SQLite 存储，替代 JSON 文件。

更完整的执行顺序见 [ROADMAP.md](./ROADMAP.md)。
