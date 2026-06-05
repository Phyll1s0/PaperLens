# 安装和运行

## 依赖

必须：

- Node.js 20 或更新版本。
- 一个可用的模型 API Key。

可选：

- Poppler：更好的 PDF 文本和页面图片抽取。
- OCRmyPDF 和 Tesseract：扫描版 PDF OCR。
- Docker：长期运行或统一依赖环境。
- Claude Code CLI：只用于 `Claude Code 本机配置` Provider。

普通用户第一次使用不需要先装齐所有可选工具。文本型 PDF 可以先直接上传；如果后面发现图片、公式、代码块裁剪不准，再安装 Poppler 或改用 Docker。扫描版 PDF 才需要 OCRmyPDF/Tesseract。

## Release 启动包

适合普通用户：

1. 在 GitHub Releases 下载 `PaperLens-local.tar.gz`。
2. 解压。
3. 启动：
   - macOS：双击 `PaperLens.command`
   - Windows：双击 `PaperLens.cmd`
   - Linux：运行 `./PaperLens.sh`

启动包仍需要本机安装 Node.js 20+。

## 源码运行

```bash
git clone https://github.com/Phyll1s0/PaperLens.git
cd PaperLens
npm install
npm run setup
npm run app
```

开发模式：

```bash
npm run dev
```

默认访问：

```text
http://127.0.0.1:3000
```

## 本机后台服务

```bash
npm run service:start
npm run service:status
npm run service:restart
npm run service:stop
```

日志：

```text
.cache/paperlens.log
```

macOS 上可以用 launchd：

```bash
npm run launchd:install
npm run launchd:status
npm run launchd:uninstall
```

## Docker

```bash
npm run setup
npm run docker:up
npm run docker:logs
```

停止：

```bash
npm run docker:down
```

Docker 使用 named volumes 保存 `uploads/`、`data/`、`paper-assets/` 和 `.cache/`。镜像内包含 Poppler、OCRmyPDF、Tesseract 和 Claude Code CLI；但默认推荐的 `Kimi Code Direct` 不依赖 Claude CLI。

## 打包 Release

```bash
npm test
npm run app:package
```

输出：

```text
dist/PaperLens-local/
dist/PaperLens-local.tar.gz
```

发布前检查压缩包里不要包含 `.env`、`data/`、`uploads/`、`paper-assets/`、`.cache/`、PDF、SQLite 数据库或日志。
