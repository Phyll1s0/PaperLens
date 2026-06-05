# 排错

## 页面打不开或提示旧后端

先检查服务：

```bash
npm run health
```

重启：

```bash
npm run service:restart
```

前台开发模式可以 `Ctrl+C` 后重新运行：

```bash
npm run dev
```

## 端口 3000 被占用

在 `.env` 修改：

```text
PAPERLENS_PORT=3010
PORT=3010
```

然后访问：

```text
http://127.0.0.1:3010
```

## API Key 测试失败

先打开页面左侧“模型 > 教程”，确认 Provider、Key、Proxy 和 Endpoint。

常见原因：

- Kimi Code Key 应选择 `Kimi Code Direct`。
- Kimi Code Key 和 Kimi 开放平台 Key 不通用。
- `Claude Code 本机配置` 不读取页面 API Key。
- Docker 里访问宿主机代理通常用 `http://host.docker.internal:端口`。
- 控制台列表里的脱敏 Key 不能用于请求。

页面“诊断包”会复制脱敏后的 Provider、Endpoint、Key 状态、代理状态和运行环境。

## PDF 图片、公式或 OCR 不理想

先看：

- 质量报告。
- 分段调试。
- 视觉 QA。
- 导出检查。

macOS 本机如果没有 Poppler，会回退 PDFKit。Docker 镜像默认安装 Poppler、OCRmyPDF 和 Tesseract。

扫描版 PDF 需要 OCR。安装 OCRmyPDF/Tesseract 后重新解析。

## 长任务跑到一半

分析和分段任务保存在后端队列里。刷新页面后会同步任务状态。

处理顺序：

1. 服务断了先重启。
2. 打开任务历史或质量报告。
3. 少量失败点“补跑未完成”。
4. 分段整体错再“重分段+全跑”。

## 公式渲染异常

如果 AI 输出里出现 `$0.5P + 0.25P$）` 这类括号或 LaTeX 边界错误，先补跑对应段落。PDF 原文里的复杂公式优先以图片裁剪展示，只有高置信 LaTeX 才直接渲染。

## 图片预览空白

如果外面预览空白但点开正常，通常是预览渲染或缓存问题。如果点开也空白，通常是页面图片、裁剪边界或视觉结构识别问题。安装 Poppler 后重新解析通常会改善。

