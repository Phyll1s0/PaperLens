# PaperLens

PaperLens 是一个本地优先的论文精读 Web 应用。它可以上传 PDF、分段阅读、识别图片/表格/公式/代码，并通过 OpenAI-compatible 模型生成翻译、讲解、关键词和段落级问答，最后导出 Markdown 或 Word 笔记。

默认情况下，PaperLens 只绑定 `127.0.0.1`。论文、上传文件、裁剪图片和 API Key 都保存在你的机器上；`.env`、`data/`、`uploads/`、`paper-assets/` 和 `.cache/` 不应该提交到 GitHub。

## 快速开始

源码运行：

```bash
git clone https://github.com/Phyll1s0/PaperLens.git
cd PaperLens
npm install
npm run setup
npm run app
```

打开：

```text
http://127.0.0.1:3000
```

开发模式：

```bash
npm run dev
```

Docker：

```bash
npm run setup
npm run docker:up
npm run docker:logs
```

打包给普通用户：

```bash
npm test
npm run app:package
```

产物在：

```text
dist/PaperLens-local/
dist/PaperLens-local.tar.gz
```

## 文档

- [文档目录](docs/README.md)：所有教程和专题文档入口。
- [具体怎么用](docs/USAGE.md)：从打开页面到完成一篇论文精读的完整文章。
- [第一次运行](docs/GETTING_STARTED.md)：安装、Provider、上传、导出的最短路径。
- [安装和运行](docs/INSTALLATION.md)：源码、Release 启动包、Docker、本机后台服务。
- [模型和配置](docs/CONFIGURATION.md)：Provider、API Key、代理、OCR、安全配置。
- [排错](docs/TROUBLESHOOTING.md)：页面打不开、Key 测试失败、PDF/OCR/长任务问题。
- [迁移和备份](docs/MIGRATION.md)：换电脑、导出导入数据、SQLite。
- [视觉结构 Provider](docs/VISUAL_PROVIDER.md)：外部版面检测 JSON/command 接入。
- [部署](docs/DEPLOYMENT.md)：本机、局域网、Docker、公网部署建议。
- [ROADMAP.md](ROADMAP.md)：后续路线。
- [design.md](design.md)：设计背景。

## 当前能力

- 上传 PDF，抽取文本、页面图片和基础结构。
- 精读/快速两种分析模式。
- AI 分段和本地修复，支持跨页合并、噪声过滤和隐藏内容恢复。
- 段落级翻译、讲解、关键词、追问。
- 图片、表格、公式、代码裁剪，支持点击放大和质量检查。
- 后端持久化 Job Queue，刷新页面后可继续同步进度。
- 失败/未完成段落补跑，单段重跑，重分段后全跑。
- Markdown 和 Word 导出。
- Kimi Code Direct、DeepSeek、OpenAI、自定义 OpenAI-compatible、Claude Code 本机配置。
- 本机 JSON 存储，支持迁移到 SQLite。

## 常用命令

```bash
npm run setup                 # 创建本地目录和 .env，检查依赖
npm run app                   # 本机应用式启动并打开浏览器
npm run dev                   # 前台开发模式
npm run health                # 检查服务健康状态
npm test                      # 跑测试
npm run service:restart       # 重启本机后台服务
npm run data:export           # 导出可迁移数据包
npm run data:import -- <包> --yes
```

## 项目结构

```text
public/       前端页面
lib/          PDF、分段、视觉结构、导出、Provider 等核心逻辑
scripts/      启动、打包、诊断、迁移脚本
tests/        回归测试
docs/         使用、配置、迁移、部署文档
server.js     本地后端服务
```

本地生成内容会写入 `uploads/`、`data/`、`paper-assets/` 和 `.cache/`，这些目录已经被 `.gitignore` 忽略。
