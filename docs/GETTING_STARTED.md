# PaperLens Getting Started

这份教程面向第一次使用 PaperLens 的人。目标是从下载项目到完成第一篇论文的翻译、讲解和导出，不要求用户知道项目内部实现。

如果你想看更完整的阅读流程，见 [如何用 PaperLens 精读一篇论文](USAGE.md)。

## 1. 准备环境

PaperLens 是本地 Web 应用，不需要注册 PaperLens 账号。你需要准备：

- Node.js 20 或更新版本。
- 一个可用的模型 API Key，例如 Kimi Code Key、DeepSeek Key、OpenAI Key，或其他 OpenAI-compatible 服务。
- 可选：Poppler，用于更好的 PDF 文本和页面图片抽取。
- 可选：OCRmyPDF 和 Tesseract，用于扫描版 PDF。

如果你只是想先跑通流程，可以只安装 Node.js 和准备一个 API Key。

Poppler、OCRmyPDF、Tesseract、Docker 和 Claude CLI 都是可选增强。文本型 PDF 可以先直接跑；扫描版 PDF 或对图片/公式裁剪要求很高时，再看 [PDF 解析策略](PDF_STRATEGY.md)。

## 2. 选择安装方式

### 方式 A：下载 Release 启动包

适合不想改代码的用户。

1. 打开 GitHub Releases。
2. 下载 `PaperLens-local.tar.gz`。
3. 解压。
4. 启动：
   - macOS：双击 `PaperLens.command`
   - Windows：双击 `PaperLens.cmd`
   - Linux：运行 `./PaperLens.sh`

启动后浏览器会打开：

```text
http://127.0.0.1:3000
```

### 方式 B：从源码运行

适合会用终端、想跟随更新或自己改配置的用户。

```bash
git clone https://github.com/Phyll1s0/PaperLens.git
cd PaperLens
npm install
npm run setup
npm run app
```

如果你要开发或看日志，使用前台模式：

```bash
npm run dev
```

### 方式 C：Docker Compose

适合长期后台运行、NAS、服务器或统一依赖环境。

```bash
git clone https://github.com/Phyll1s0/PaperLens.git
cd PaperLens
npm install
npm run setup
npm run docker:up
npm run docker:logs
```

Docker 内访问宿主机代理时，不要填写容器自己的 `127.0.0.1`，一般使用：

```text
http://host.docker.internal:代理端口
```

## 3. 配置模型 Provider

打开页面后，在左侧“模型”区域选择 Provider。

| Provider | 适合谁 | 是否需要 Claude CLI |
| --- | --- | --- |
| Kimi Code Direct | 有 Kimi Code Console 的 `sk-kimi-` Key | 不需要 |
| DeepSeek | 有 DeepSeek OpenAI-compatible Key | 不需要 |
| OpenAI | 有 OpenAI API Key | 不需要 |
| 自定义 | 接其他 OpenAI-compatible `/chat/completions` 服务 | 不需要 |
| Claude Code 本机配置 | 已经在本机配置 Claude Code CLI 的用户 | 需要 |

推荐新用户优先使用 `Kimi Code Direct`、`DeepSeek`、`OpenAI` 或 `自定义`。这些入口直接使用页面填写的 API Key，不依赖本机 Claude Code CLI。

配置步骤：

1. 选择 Provider。
2. 填写 Base URL 和 Model。如果选择预设 Provider，一般已经自动填好。
3. 粘贴完整 API Key。控制台列表里 `sk-...` 的脱敏值不能用于请求。
4. 如果网络需要代理，填写 Proxy URL。
5. 点击“测试连接”。

测试成功后，完整 Key 会保存到本机后端的本地密钥文件中；浏览器侧只保留一个本地 key id。

## 4. 上传第一篇论文

1. 在左侧 PDF 区选择文件。
2. 保持“AI 分段”打开。
3. 如果希望上传后自动完成整篇论文，保持“上传后自动翻译讲解”打开。
4. 选择模式：
   - 精读：更重视分段质量和上下文，适合正式阅读。
   - 快速：更快，适合预览论文大意。
5. 点击“上传并解析”。

长任务会进入后端队列。刷新页面、短暂断网或切换页面后，PaperLens 会继续从后端同步进度。

## 5. 阅读和修复结果

论文加载后，主界面会按段落展示：

- 原文。
- 翻译。
- 讲解。
- 术语和关键词。
- 相关图片、表格、公式或代码块。
- 段落级追问入口。

如果结果不理想，优先看这些入口：

- 质量报告：总览分段、图片、公式、导出、Provider 和失败项。
- 分段调试：查看被过滤内容、段落来源、跨页合并和结构规划。
- 本地修复：不重新调用 AI，只用本地规则尝试修复当前段落。
- 补跑未完成：只补跑失败或缺失翻译/讲解的段落。
- 重分段+全跑：重新分段并清空重跑，适合分段整体错了的情况。

## 6. 导出笔记

阅读完成后可以导出两种格式：

- 下载笔记：导出 Markdown，适合 Obsidian、Notion 或继续手工整理。
- 下载 Word：导出 `.docx`，适合打印、分享或继续编辑。

导出前可以先点“导出检查”，确认是否存在缺翻译、缺讲解、图表引用异常或低置信公式。

## 7. 备份和迁移

如果要换电脑或升级前备份：

```bash
npm run data:export
```

默认输出：

```text
dist/paperlens-data-时间戳/
dist/paperlens-data-时间戳.tar.gz
```

在另一台电脑导入：

```bash
npm run data:import -- /path/to/paperlens-data-时间戳.tar.gz --yes
```

默认迁移论文数据、上传 PDF、页面图片和裁剪资产，但不迁移 `.env` 和 `data/secrets.json`。如果确实要迁移密钥，需要显式使用 `--include-secrets`，并自行确认迁移包保存安全。

## 8. 常见问题

### 页面打不开

先检查服务：

```bash
npm run health
```

如果服务不是最新进程：

```bash
npm run service:restart
```

前台模式可以直接停止后重启：

```bash
npm run dev
```

### API Key 测试失败

检查四件事：

1. Provider 是否选对。
2. API Key 是否是完整原文，不是列表里的脱敏值。
3. Base URL 和 Model 是否属于同一个服务。
4. 代理是否按本机或 Docker 环境填写。

页面里的“诊断包”会复制脱敏后的 Provider、Endpoint、Key 状态、代理状态和运行环境。

### 图片、公式或代码块不准

优先打开“质量报告”和“分段调试”。如果页面图片抽取能力降级，安装 Poppler 后重新解析通常会明显改善图片、公式和代码块裁剪。

### 扫描版 PDF 没有文字

安装 OCRmyPDF 和 Tesseract 后重新上传。没有 OCR 时，纯扫描版 PDF 只能抽到页面图片，无法稳定做段落级精读。

### 不想安装 Claude CLI

选择 `Kimi Code Direct`、`DeepSeek`、`OpenAI` 或 `自定义`。这些 Provider 不需要 Claude CLI。
