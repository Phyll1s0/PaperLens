# 视觉结构 Provider

PaperLens 默认用内置启发式识别图片、表格、公式和代码：它会结合 PDF 文本块、caption、公式/代码规则，以及页面 PNG 的非白像素来收紧裁剪边界。

如果你有外部版面检测模型，可以通过 JSON 或 command Provider 接入。

## JSON Provider

`.env`：

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

支持的 `type`：

- `figure`
- `table`
- `formula`
- `code`

也接受 `image/chart/diagram`、`equation/math`、`algorithm/listing` 等别名。

## Command Provider

`.env`：

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
    "blocks": [
      { "text": "Figure 1: ...", "x": 72, "y": 120, "width": 420, "height": 20 }
    ]
  }
}
```

脚本 stdout 可以输出 `{ "regions": [...] }`、`[{...}]` 或 JSON Provider 结构。`scripts/visual-provider-command-example.mjs` 只是协议示例，不包含模型权重。

健康检查和质量报告会显示 command Provider 的区域数、耗时和错误数。

