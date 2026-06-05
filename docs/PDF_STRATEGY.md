# PDF 解析策略

PaperLens 面向普通用户，所以目标不是要求每个人先装一套论文排版工具链，而是让最小路径足够短：

1. Node.js 20+。
2. 一个模型 API Key。
3. 打开页面，上传 PDF。

Poppler、OCRmyPDF、Tesseract、Docker 和 Claude CLI 都应该是“增强能力”，不是第一次使用的硬门槛。

## 为什么还需要本地 PDF 解析

直接把整篇 PDF 交给 AI，让 AI 输出排版结构，这个方向是有价值的，但它不适合成为唯一地基。

原因有几个：

- 不是所有 OpenAI-compatible Provider 都支持上传 PDF 文件。
- 有些模型能读 PDF，但不一定返回稳定的页面坐标、裁剪框和段落来源。
- 图片、公式、代码块需要可点击、可放大、可导出的精确裁剪，本地页面图和 bbox 更可靠。
- 整篇 PDF 直接交给模型成本更高，也更容易超时。
- 本地解析保留隐私边界，用户可以先在本机得到文本、页面图和结构，再选择哪些内容交给模型。

所以当前更稳的架构是：

```text
本地 PDF 抽取 -> 本地视觉/分段候选 -> AI 做结构判断和讲解 -> 质量报告/人工修复
```

## AI-first PDF 可以怎么做

更好的长期方案不是放弃本地 PDF 工具，而是增加一个可选模式：

```text
PDF -> AI layout provider -> 结构化 JSON -> PaperLens 本地校验和裁剪
```

AI 可以负责：

- 判断正文起点、References 起点和章节边界。
- 判断哪些块是正文、图注、公式、代码、表格。
- 给跨页段落和多栏顺序做更强的语义判断。
- 输出页面区域和段落计划。

PaperLens 仍然负责：

- 保存 PDF 和页面图。
- 校验 AI 输出是否越界、漏页、漏段或重复。
- 根据坐标裁剪图片/公式/代码。
- 生成质量报告和可恢复的人工修复入口。

这样普通用户可以获得 AI 布局的好处，但不会被某个模型的 PDF 能力、费用或超时问题锁死。

## 普通用户默认路径

默认建议：

- 文本型 PDF：不用额外工具也可以先跑。
- 想要更好的图片/公式/代码裁剪：安装 Poppler，或使用 Docker 版本。
- 扫描版 PDF：安装 OCRmyPDF/Tesseract，或使用 Docker 版本。
- 不想安装 Claude CLI：选择 Kimi Code Direct、DeepSeek、OpenAI 或自定义 Provider。

## 未来升级方向

1. 在页面上传后增加“解析质量预检”，明确告诉用户当前是基础解析、Poppler 增强、OCR，还是 AI 布局。
2. 增加可选 `AI layout provider`，让支持 PDF/vision 的模型输出版面 JSON。
3. 让 AI 输出必须经过本地校验，失败时回退到本地解析。
4. Release 启动包继续保持轻量；真正的一键桌面端再考虑内置 Poppler/OCR。

