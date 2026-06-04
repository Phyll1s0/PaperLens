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

`npm run setup` 会创建缺失的本地目录、从 `.env.example` 生成 `.env`，并检查 Node、Docker、Poppler，以及可选的 Claude Code CLI 是否可用。默认的 Kimi Code Direct 通道不依赖 Claude CLI。只想检查环境而不写文件，可以运行：

```bash
npm run setup -- --check
```

运行最小回归测试：

```bash
npm test
```

像本地应用一样启动，并自动打开浏览器：

```bash
npm run app
```

Docker 运行：

```bash
npm run docker:up
npm run docker:logs
```

### 一键启动包

给非开发者使用时，可以生成一个不包含你的本地数据和密钥的轻量启动包：

```bash
npm run app:package
```

输出位置：

```text
dist/PaperLens-local/
dist/PaperLens-local.tar.gz
```

使用者解压后：

```text
macOS: 双击 PaperLens.command
Windows: 双击 PaperLens.cmd
Linux: 运行 ./PaperLens.sh
```

这个包会排除 `.env`、`data/`、`uploads/`、`paper-assets/`、`.cache/`、PDF、SQLite 数据库和日志。当前第一版选择轻量本地 Web 应用包，而不是 Electron/Tauri：启动更快、体积更小，也不会把 API Key 和论文数据打进安装包。以后如果要做真正的桌面安装器，可以在这个启动包稳定后再接 Electron 或 Tauri。

使用者仍需要安装 Node.js 20+。扫描版 PDF 的 OCR 和最佳 PDF 视觉抽取仍分别依赖 OCRmyPDF/Tesseract 和 Poppler。

### 可选配置

如果网络需要代理，先复制配置模板：

```bash
cp .env.example .env
```

本机自己用可以不设访问令牌；如果用 Docker、服务器、内网共享或公网部署，建议先设置：

```text
PAPERLENS_ACCESS_TOKEN=change-this-long-random-token
```

启用后，PaperLens 会先显示访问令牌登录页；API、导出和本地论文图片资产都会要求登录 Cookie。`data/secrets.json` 中的 API Key 也会用这个令牌派生密钥加密。更稳妥的方式是单独设置长期不变的 secrets 密钥：

```text
PAPERLENS_SECRET_KEY=change-this-even-longer-random-secret
```

如果已经生成了加密的 `data/secrets.json`，更换 `PAPERLENS_SECRET_KEY` 或 `PAPERLENS_ACCESS_TOKEN` 前请先备份并确认还能解密旧文件。

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

默认 OCR 语言是英文，页面的 OCR 面板也可以按单篇论文选择语言后重跑：

```text
PAPERLENS_OCR_LANGUAGE=eng
```

中英文混排论文可在页面选择 `eng+chi_sim`，也可以把本机默认值改成：

```text
PAPERLENS_OCR_LANGUAGE=eng+chi_sim
```

OCR 完成后，PaperLens 会记录文本密度、推荐语言、页图分辨率风险和 OCRmyPDF 的倾斜/旋转提示；如果质量检查发现风险，页面会提醒你抽查或换语言重跑。

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

Docker Compose 会自动读取 `.env` 中的 `PAPERLENS_ACCESS_TOKEN`、`PAPERLENS_SECRET_KEY`、`PAPERLENS_PROXY_URL` 和 `PAPERLENS_OCR_LANGUAGE`。Docker 镜像会安装 OCRmyPDF、Tesseract 英文/简体中文语言包和 Claude Code CLI；扫描版 PDF OCR 可以直接在容器内运行。默认的 `Kimi Code Direct` Provider 走 HTTP API，不需要容器内 Claude CLI。`Claude Code 本机配置` Provider 仍然依赖容器内自己的环境变量或配置，不会自动读取宿主机的 `~/.claude`。

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
- 自动分析会按 Provider 分流批处理；Kimi Code Direct、DeepSeek/OpenAI-compatible 更偏吞吐，Claude Code 本机配置更保守，并会缓存已完成段落。
- 分析任务支持刷新后恢复、任务历史查看和失败段落小批次重跑。
- 在浏览器会话中保存模型配置和本地 key id，不保存完整 API Key。
- 后端只在本地私有 `data/secrets.json` 保存完整 API Key，任务文件只保存 key id；设置访问令牌或 secret key 后会加密保存。
- 对单个段落生成翻译、讲解和关键词。
- 段落分析会结合邻近段落、相关图表 caption 和前文术语。
- 段落分析上下文窗口会额外结合全文关键词、章节摘要和同引用窗口。
- 展示层会修复常见碎片 LaTeX，把被 PDF/模型拆成多行的公式 token 合并成可渲染公式。
- 公式和代码块会保留页面原始截图裁剪，支持点击放大查看。
- 对单个段落进行追问，并结合附近段落回答。

## 模型配置

支持 OpenAI-compatible `/chat/completions` 接口：

- DeepSeek Base URL：`https://api.deepseek.com`
- DeepSeek Model：`deepseek-v4-flash` 或 `deepseek-v4-pro`
- Kimi Code Direct：页面输入 Kimi Code Key，后端直连 Anthropic-compatible endpoint `https://api.kimi.com/coding/v1/messages`，Base URL 显示为 `local:claude-kimi`
- Claude Code 本机配置：使用本机 Claude Code 已登录/已配置的认证，不读取页面 API Key
- Kimi Code Base URL：`https://api.kimi.com/coding/v1`
- Kimi Code Model：`kimi-for-coding`
- Kimi 开放平台 Base URL：`https://api.moonshot.cn/v1`
- Kimi 开放平台 K2.6 Model：`kimi-k2.6`
- OpenAI Base URL 示例：`https://api.openai.com/v1`
- OpenAI Model 示例：`gpt-4.1-mini`
- API Key 提交成功后会写入本机私有 `data/secrets.json`，浏览器只保存本地 key id；`data/` 已被 `.gitignore` 忽略。

注意：`www.kimi.com/code/console` 生成的是 Kimi Code Key，它和 Kimi 开放平台 Key 不通用。PaperLens 的 `Kimi Code Direct` 使用 Kimi Code 的 Anthropic-compatible endpoint `https://api.kimi.com/coding/v1/messages` 和模型 `kimi-for-coding`；普通 `Kimi Code` 选项则用于 OpenAI-compatible endpoint `https://api.kimi.com/coding/v1`。

如果要在 PaperLens 中使用 Kimi Code Key，优先选择 `Kimi Code Direct` Provider。这个通道不读取本机 `~/.claude`，不依赖 `claude` CLI，也不会使用 Claude CLI 的 `--max-budget-usd`。如果你明确想沿用本机 Claude Code 登录态或 OpenSSI 等配置，再选择 `Claude Code 本机配置`。

如果 `Claude Code 本机配置` 提示找不到 `claude` CLI，请确认本机能运行 `claude --version`。macOS launchd 服务会把 `/opt/homebrew/bin`、`/usr/local/bin`、`~/.local/bin` 加入 PATH；如果你的 Claude Code 安装在其他位置，可以设置 `PAPERLENS_CLAUDE_CLI=/path/to/claude`。默认的 `Kimi Code Direct` 不需要这一步。

如果你的网络必须通过代理访问模型服务，最简单是在网页模型设置里填 `Proxy URL`；也可以在 `.env` 里设置 `PAPERLENS_PROXY_URL`。本机后台脚本、macOS launchd 和 Docker Compose 都会读取它。普通 OpenAI-compatible 与 Kimi Code Direct 请求会由 PaperLens 后端代理传输层发起，支持 `http://`、`https://`、`socks5://` / `socks5h://` 和 `NO_PROXY`；Claude Code 本机配置会把代理注入 CLI 环境。网页模型诊断里会显示代理来源和传输模式，例如 `http-connect` 或 `socks5-tunnel`。Docker 里访问宿主机代理通常要写 `http://host.docker.internal:端口`，不是 `127.0.0.1`。

AI 分段会走三阶段：先做全文结构预扫描，生成标题、正文起点、References 起点、章节页码、非正文区域地图和 `segmentationPlan`；再按 3 页左右的窗口局部分段，每个 heading/paragraph 会尽量绑定计划章节，并带着结构地图、前序摘要和尾段上下文；最后做合并校验，统一修正章节归属、过滤作者/链接/图注/参考文献等非正文碎片，并合并跨页或断句段落。上传和打开旧论文时还会生成页面 `visualRegions`，用几何位置识别图片、表格、公式、代码等视觉区域，再用页面 PNG 的非白像素收紧裁剪边界，并优先用这些区域裁剪图表。Kimi Code Direct 默认使用本地视觉分段，避免把慢模型通道阻塞在 PDF 分段上；后续翻译讲解仍通过持久化 Job Queue 批量执行。

长任务默认按“精读质量优先”优化：后端会把段落合并成批次，并发跑多个批次并安全合并写入；已完成段落会写入本地分析缓存，补跑或全量任务会优先复用相同段落的翻译/讲解；失败项重跑会自动降到小批次，批量失败后也会自适应缩小后续批次。每段讲解会覆盖段落含义、论文中的作用、关键概念/公式/图表关系和阅读难点。`.env` 可调整：`PAPERLENS_ANALYSIS_TARGET_MINUTES=20` 控制目标耗时估算，`PAPERLENS_ANALYSIS_BATCH_SIZE=12` / `PAPERLENS_ANALYSIS_CONCURRENCY=3` 控制 Kimi Code Direct 和普通 OpenAI-compatible，`PAPERLENS_AGENT_ANALYSIS_BATCH_SIZE=8` / `PAPERLENS_AGENT_ANALYSIS_CONCURRENCY=2` 控制 Claude Code 本机配置，`PAPERLENS_ANALYSIS_FAILED_RETRY_BATCH_SIZE=2` 控制失败补跑小批次。批次和并发越大越快，但更容易触发限流、超时或 JSON 不完整；如果想进一步提速，可以把批次调高，但讲解质量会受影响。

当前 Kimi Code Direct 通道已用 TimesFM 论文做过完整 smoke test：`125/125` 个阅读段落完成，失败 `0`，导出 QA 为 `ok`，未发现 LaTeX、图表引用或裁剪缺失风险。

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
│   ├── paperlens-app.mjs
│   ├── package-local-app.mjs
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

## SQLite 持久化

默认存储仍是 JSON，适合开发和直接查看文件。需要更稳的长任务恢复和后续检索时，可以先迁移到 SQLite：

```bash
npm run storage:migrate:sqlite
```

然后在 `.env` 中启用：

```text
PAPERLENS_STORAGE=sqlite
PAPERLENS_SQLITE_PATH=./data/paperlens.sqlite
```

重启后，`/api/health` 的 `persistence.active` 会显示 `sqlite`，并显示论文、段落和 Job 统计。SQLite 会保存论文完整 JSON，同时把论文、段落、Job、导出历史等关键字段拆到表里，方便后续恢复和检索。API Key 仍保存在本机私有 `data/secrets.json`。

需要回滚到 JSON 时，先导出回滚目录：

```bash
npm run storage:export:json
```

停止服务后，把 `.env` 改回：

```text
PAPERLENS_STORAGE=json
PAPERLENS_DATA_DIR=导出的回滚目录
```

## 视觉结构 Provider

默认视觉结构使用内置启发式：根据 PDF 文本块、caption、公式/代码规则和页面 PNG 非白像素收紧裁剪。也可以接入外部版面检测模型的 JSON 输出：

```text
PAPERLENS_VISUAL_PROVIDER=json
PAPERLENS_VISUAL_PROVIDER_PATH=./data/visual-layout.json
```

JSON 示例：

```json
{
  "pages": [
    {
      "pageNumber": 1,
      "regions": [
        { "type": "figure", "label": "Figure 1", "x": 72, "y": 120, "width": 420, "height": 180, "confidence": 0.92 },
        { "type": "formula", "label": "Equation 1", "bbox": [96, 360, 320, 48], "confidence": 0.81 }
      ]
    }
  ]
}
```

支持的 `type` 包括 `figure`、`table`、`formula`、`code`，也接受 `image/chart/diagram`、`equation/math`、`algorithm/listing` 等别名。外部模型区域会以 `source=model-json` 写入 `visualRegions`，并生成 `modelGenerated` 图表/公式/代码 artifact；如果和内置启发式区域高度重叠，会自动去重。修改 JSON 后，可以在页面里重建视觉结构来刷新旧论文。

也可以用 command Provider 接真实模型脚本：

```text
PAPERLENS_VISUAL_PROVIDER=command
PAPERLENS_VISUAL_PROVIDER_COMMAND=node
PAPERLENS_VISUAL_PROVIDER_ARGS=["scripts/visual-provider-command-example.mjs"]
PAPERLENS_VISUAL_PROVIDER_TIMEOUT_MS=5000
```

PaperLens 不通过 shell 执行命令，只使用“可执行文件 + JSON 参数数组”。每页会向脚本 stdin 传入：

```json
{
  "version": 1,
  "page": {
    "pageNumber": 1,
    "width": 612,
    "height": 792,
    "imagePath": "/assets/paper/page-001.png",
    "blocks": [{ "text": "Figure 1: ...", "x": 72, "y": 120, "width": 420, "height": 20 }]
  }
}
```

脚本 stdout 输出 `{ "regions": [...] }`、`[{...}]` 或上面的 JSON Provider 结构都可以。`scripts/visual-provider-command-example.mjs` 只是协议示例，不包含模型权重；真实使用时可以把 command 换成 Python/Node 版面检测脚本。健康检查和质量报告会显示 command Provider 的区域数、耗时和错误数。

## 部署说明

PaperLens 支持四种运行方式。`PAPERLENS_DEPLOYMENT_MODE=auto` 会自动推断，也可以手动设置为 `local`、`lan`、`docker` 或 `public`。页面顶部服务状态会显示当前模式、风险等级和建议动作。

| 模式 | 适用场景 | HOST | 访问保护 |
| --- | --- | --- | --- |
| `local` | 自己电脑上使用 | `127.0.0.1` | 可选 |
| `lan` | 同一局域网内共享 | `0.0.0.0` | 强烈建议 |
| `docker` | Docker Compose / NAS / 本机容器 | `0.0.0.0` | 强烈建议 |
| `public` | 域名、公网服务器、反向代理 | `0.0.0.0` | 必须启用 |

本机默认：

```text
PAPERLENS_DEPLOYMENT_MODE=local
HOST=127.0.0.1
PORT=3000
```

内网共享：

```text
PAPERLENS_DEPLOYMENT_MODE=lan
HOST=0.0.0.0
PORT=3000
PAPERLENS_ACCESS_TOKEN=change-this-long-random-token
PAPERLENS_SECRET_KEY=change-this-even-longer-random-secret
```

Docker 或 NAS：

```text
PAPERLENS_DEPLOYMENT_MODE=docker
HOST=0.0.0.0
PORT=3000
PAPERLENS_PDF_ENGINE=poppler
PAPERLENS_ACCESS_TOKEN=change-this-long-random-token
PAPERLENS_SECRET_KEY=change-this-even-longer-random-secret
```

公网部署：

```text
PAPERLENS_DEPLOYMENT_MODE=public
PAPERLENS_PUBLIC_URL=https://paperlens.example.com
HOST=0.0.0.0
PORT=3000
PAPERLENS_ACCESS_TOKEN=change-this-long-random-token
PAPERLENS_SECRET_KEY=change-this-even-longer-random-secret
```

公网模式建议放在 HTTPS 反向代理后面，并把 `X-Forwarded-Proto=https` 传给 PaperLens。不要把 API Key 写进镜像或仓库；完整 Key 只会保存在本机私有 `data/secrets.json`，页面和 Job 只保存本地 key id。

推荐先用 Docker 部署到支持长期运行容器和持久化磁盘的平台，例如 VPS、Render 或 Fly.io。镜像内包含：

```text
poppler-utils
ocrmypdf / tesseract
@anthropic-ai/claude-code
```

健康检查：

```text
GET /api/health
```

## 后续建议

下一步可以补强：

- 更可靠的图表、公式、代码视觉结构识别。
- 全文摘要、章节摘要和术语表。
- 向量检索，替代当前的邻近段落上下文。
- 本地 SQLite 存储，替代 JSON 文件。

更完整的执行顺序见 [ROADMAP.md](./ROADMAP.md)。
