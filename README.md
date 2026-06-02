# PaperLens

PaperLens 是一个本地优先的论文精读 Web 应用原型。它可以上传 PDF、提取段落、保留原文，并通过 OpenAI-compatible 模型生成翻译、讲解和段落级追问回答；完成后可以下载包含原文、翻译、讲解、术语和相关图表的 Markdown 笔记或 Word 文档。

## 启动

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

### 本机前台运行

```bash
npm start
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

停止：

```bash
docker compose down
```

Docker 会用 named volumes 持久化 `uploads/`、`data/`、`paper-assets/` 和 `.cache/`。

Docker Compose 会自动读取 `.env` 中的 `PAPERLENS_PROXY_URL`。Docker 镜像会安装 Claude Code CLI，因此 `Claude Code + Kimi Code Key` Provider 在容器里也能用页面输入的 Kimi Code Key 调用。`Claude Code 本机配置` Provider 仍然依赖容器内自己的环境变量或配置，不会自动读取宿主机的 `~/.claude`。

## 当前能力

- 上传 PDF。
- Docker/Linux 使用 Poppler 提取文本和页面快照；macOS 本机自动回退 PDFKit。
- 自动切分段落并生成基础目录。
- 可在上传后使用 AI 重新分段。
- AI 分段会带上一窗口摘要和尾段作为上下文，并保存章节摘要、关键词和跨页续接线索。
- 可在上传后自动逐段生成翻译、讲解和关键词，并显示后端持久化 Job 进度。
- 自动分析会按批次调用模型；Claude Code Agent 默认 6 段一批，普通 OpenAI-compatible 默认 4 段一批，批量失败会自动回退单段。
- 分析任务支持刷新后恢复、任务历史查看和失败段落重跑。
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

AI 分段会先做全文结构预扫描，生成标题、正文起点、References 起点、章节页码和非正文区域地图；上传和打开旧论文时还会生成页面 `visualRegions`，用几何位置识别图片、表格、公式、代码等视觉区域，并优先用这些区域裁剪图表。随后再按 3 页左右的窗口精细分段，每个窗口都会带着结构地图和前序摘要，且会跳过被视觉结构覆盖的图内文字、公式和代码，减少作者、链接、图注、参考文献误入正文。长任务默认按“精读质量优先”优化：后端会把段落合并成批次，并发跑多个批次并安全合并写入；每段讲解会覆盖段落含义、论文中的作用、关键概念/公式/图表关系和阅读难点。`.env` 可调整：`PAPERLENS_ANALYSIS_TARGET_MINUTES=20` 控制目标耗时估算，`PAPERLENS_AGENT_ANALYSIS_BATCH_SIZE=8` / `PAPERLENS_AGENT_ANALYSIS_CONCURRENCY=2` 控制 Claude Code Agent，`PAPERLENS_ANALYSIS_BATCH_SIZE=12` / `PAPERLENS_ANALYSIS_CONCURRENCY=3` 控制普通 OpenAI-compatible。批次和并发越大越快，但更容易触发限流、超时或 JSON 不完整；如果想进一步提速，可以把批次调高，但讲解质量会受影响。

重跑分三种：段落卡片按钮只重跑单段；工具栏“补跑失败/未完成”只跑失败、缺翻译或缺讲解的段落，保留已经成功的结果；“重新分段并生成全部”会先重新 AI 分段，再清空并重跑全部新段落。

工具栏“下载笔记”会导出 Markdown 文件，按段落保存原文、翻译、讲解、术语和相关图表引用，适合继续整理到 Obsidian、Notion 或其他笔记系统。“下载Word”会导出 `.docx`，保留章节、段落、术语和图表裁剪预览，适合直接打印、分享或继续编辑。

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
