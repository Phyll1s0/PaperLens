# 模型和配置

## Provider 选择

| Provider | 用途 | 是否需要 Claude CLI |
| --- | --- | --- |
| Kimi Code Direct | Kimi Code Console 的 `sk-kimi-` Key | 不需要 |
| DeepSeek | DeepSeek OpenAI-compatible API | 不需要 |
| OpenAI | OpenAI API | 不需要 |
| 自定义 | 其他 OpenAI-compatible `/chat/completions` 服务 | 不需要 |
| Claude Code 本机配置 | 复用本机 Claude Code CLI 登录态或配置 | 需要 |

Kimi Code Console 的 Key 和 Kimi 开放平台 Key 不通用。使用 Kimi Code Key 时，优先选择 `Kimi Code Direct`。

## API Key 保存方式

页面提交完整 Key 后，PaperLens 后端会保存到本机私有 `data/secrets.json`，浏览器和 Job 只保存本地 key id。`data/` 已被 `.gitignore` 忽略。

设置 `PAPERLENS_ACCESS_TOKEN` 或 `PAPERLENS_SECRET_KEY` 后，secrets 会加密保存。

## 代理

页面临时代理：

```text
Proxy URL = http://127.0.0.1:7897
```

`.env` 长期配置：

```text
PAPERLENS_PROXY_URL=http://127.0.0.1:7897
```

Docker 访问宿主机代理通常使用：

```text
PAPERLENS_PROXY_URL=http://host.docker.internal:7897
```

支持 `http://`、`https://`、`socks5://` 和 `socks5h://`。

## 访问保护

本机自己用可以不设访问令牌。如果用 Docker、局域网共享或公网部署，建议设置：

```text
PAPERLENS_ACCESS_TOKEN=change-this-long-random-token
PAPERLENS_SECRET_KEY=change-this-even-longer-random-secret
```

启用后，页面会先显示访问令牌登录页，API、导出和本地论文图片资产都会要求登录 Cookie。

## OCR

扫描版 PDF 可以在页面点击“本机 OCR 并重新解析”。本机需要安装 OCRmyPDF 和 Tesseract。

macOS 示例：

```bash
brew install ocrmypdf tesseract tesseract-lang
```

默认语言：

```text
PAPERLENS_OCR_LANGUAGE=eng
```

中英文混排：

```text
PAPERLENS_OCR_LANGUAGE=eng+chi_sim
```

## PDF 工具不是第一步硬门槛

普通用户首次使用只需要 Node.js 和 API Key。Poppler 会让图片、公式、代码块裁剪更稳；OCRmyPDF/Tesseract 只在扫描版 PDF 上必要。更详细的取舍见 [PDF 解析策略](PDF_STRATEGY.md)。

## 分析速度

长任务批次和并发可以在 `.env` 调整：

```text
PAPERLENS_ANALYSIS_TARGET_MINUTES=20
PAPERLENS_ANALYSIS_BATCH_SIZE=12
PAPERLENS_ANALYSIS_CONCURRENCY=3
PAPERLENS_AGENT_ANALYSIS_BATCH_SIZE=8
PAPERLENS_AGENT_ANALYSIS_CONCURRENCY=2
PAPERLENS_ANALYSIS_FAILED_RETRY_BATCH_SIZE=2
```

批次和并发越大越快，但更容易触发限流、超时或 JSON 不完整。
