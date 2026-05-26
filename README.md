# PaperLens

PaperLens 是一个本地优先的论文精读 Web 应用原型。它可以上传 PDF、提取段落、保留原文，并通过 OpenAI-compatible 模型生成翻译、讲解和段落级追问回答。

## 启动

```bash
npm start
```

打开：

```text
http://127.0.0.1:3000
```

## 当前能力

- 上传 PDF。
- 使用 macOS PDFKit 提取文本。
- 自动切分段落并生成基础目录。
- 在浏览器会话中保存模型配置和 API Key。
- 对单个段落生成翻译、讲解和关键词。
- 对单个段落进行追问，并结合附近段落回答。

## 模型配置

支持 OpenAI-compatible `/chat/completions` 接口：

- DeepSeek Base URL：`https://api.deepseek.com`
- DeepSeek Model：`deepseek-v4-flash` 或 `deepseek-v4-pro`
- Kimi Code Base URL：`https://api.kimi.com/coding/v1`
- Kimi Code Model：`kimi-for-coding`
- Kimi 开放平台 Base URL：`https://api.moonshot.cn/v1`
- Kimi 开放平台 K2.6 Model：`kimi-k2.6`
- OpenAI Base URL 示例：`https://api.openai.com/v1`
- OpenAI Model 示例：`gpt-4.1-mini`
- API Key 只保存在当前浏览器 `sessionStorage`，不会写入项目文件。

注意：`www.kimi.com/code/console` 生成的是 Kimi Code Key，它和 Kimi 开放平台 Key 不通用。Kimi Code Key 使用 `https://api.kimi.com/coding/v1` 和 `kimi-for-coding`，但官方可能限制它只给 Coding Agent 使用。论文阅读这类普通应用建议使用 Kimi 开放平台 Key。

## 项目结构

```text
.
├── public/
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── scripts/
│   ├── extract_pdf_text.swift
│   ├── diagnose_deepseek_key.mjs
│   ├── diagnose_kimi_code_key.mjs
│   ├── diagnose_kimi_key.mjs
│   └── check_kimi_key.mjs
├── server.js
├── design.md
└── ideas.md
```

## 后续建议

下一步可以补强：

- 章节识别准确率。
- 图表截图与图注解析。
- 全文摘要和章节摘要。
- 向量检索，替代当前的邻近段落上下文。
- 本地 SQLite 存储，替代 JSON 文件。
