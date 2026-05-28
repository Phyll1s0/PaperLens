# PaperLens

PaperLens 是一个本地优先的论文精读 Web 应用原型。它可以上传 PDF、提取段落、保留原文，并通过 OpenAI-compatible 模型生成翻译、讲解和段落级追问回答。

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
- 可在上传后自动逐段生成翻译、讲解和关键词，并显示后端持久化 Job 进度。
- 分析任务支持刷新后恢复、任务历史查看和失败段落重跑。
- 在浏览器会话中保存模型配置和 API Key。
- 后端 Job 只保存本地 key id，完整 API Key 存在本地私有 `data/secrets.json`。
- 对单个段落生成翻译、讲解和关键词。
- 段落分析会结合邻近段落、相关图表 caption 和前文术语。
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
- API Key 只保存在当前浏览器 `sessionStorage`，不会写入项目文件。

注意：`www.kimi.com/code/console` 生成的是 Kimi Code Key，它和 Kimi 开放平台 Key 不通用。Kimi Code Key 使用 `https://api.kimi.com/coding/v1` 和 `kimi-for-coding`，但官方可能限制它只给 Coding Agent 使用。论文阅读这类普通应用建议使用 Kimi 开放平台 Key。

如果要在 PaperLens 中使用 Kimi Code Key，可以选择 `Claude Code + Kimi Code Key` Provider。它不会直接从网页伪装调用 Kimi Code API，而是让后端调用本机已安装的 Claude Code CLI，并通过 Anthropic-compatible endpoint `https://api.kimi.com/coding/` 访问 Kimi Code。为降低风险，PaperLens 调用时会使用 `--bare`、`--setting-sources project`、`--no-session-persistence`、`--tools ""`，只传入文本任务，并避免本机用户级 Claude settings 覆盖页面输入的 key。

如果网页提示找不到 `claude` CLI，请确认本机能运行 `claude --version`。macOS launchd 服务会把 `/opt/homebrew/bin`、`/usr/local/bin`、`~/.local/bin` 加入 PATH；如果你的 Claude Code 安装在其他位置，可以设置 `PAPERLENS_CLAUDE_CLI=/path/to/claude`。

如果你的网络必须通过代理访问模型服务，最简单是在网页模型设置里填 `Proxy URL`；也可以在 `.env` 里设置 `PAPERLENS_PROXY_URL`。本机后台脚本、macOS launchd 和 Docker Compose 都会读取它；网页模型诊断里也会显示 `Proxy: detected`。也可以直接设置 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY`。

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

不要把 API Key 写进镜像或仓库。当前页面里的 Key 只保存在浏览器 `sessionStorage`。

## 后续建议

下一步可以补强：

- 更可靠的图表、公式、代码视觉结构识别。
- 全文摘要、章节摘要和术语表。
- 向量检索，替代当前的邻近段落上下文。
- 本地 SQLite 存储，替代 JSON 文件。

更完整的执行顺序见 [ROADMAP.md](./ROADMAP.md)。
