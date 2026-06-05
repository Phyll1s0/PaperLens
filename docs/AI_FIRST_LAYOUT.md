# AI-first Layout Design

AI-first layout 的目标是让模型先读 PDF 或页面图，输出全文结构和版面 JSON，再由 PaperLens 本地校验、裁剪、分段和讲解。它不是简单地把 PDF 丢给模型后相信模型结果，而是把 AI 放到“布局 Provider”位置。

## 目标

- 普通用户不需要理解 Poppler/OCR/版面工具，上传 PDF 后优先得到更好的结构判断。
- AI 能参与正文起点、References、章节、跨页段落、多栏阅读顺序、图表/公式/代码识别。
- 现有图片裁剪、公式预览、质量报告、导出和补跑机制继续复用。
- AI 输出必须能回退，不能因为模型失败导致整篇论文不可用。

## 总体流程

```text
PDF / page images
  -> AI layout provider
  -> AI layout JSON
  -> local schema validation
  -> local bbox clamp / dedupe / confidence audit
  -> segmentation plan + visual regions
  -> translation/explanation job queue
  -> quality report + repair actions
```

## Provider 模式

第一版建议做三档：

| 模式 | 行为 | 适合场景 |
| --- | --- | --- |
| `local` | 当前本地 PDF 抽取 + 启发式视觉结构 | 免费、稳定、可回退 |
| `ai-layout` | AI 输出结构，PaperLens 本地校验后使用 | 用户想要更好的分段/图表识别 |
| `hybrid` | 本地先抽取，AI 只修结构和阅读顺序 | 成本较低，适合作为默认升级方向 |

不建议第一步就做“只把原始 PDF 给 AI，不做任何本地抽取”。原因是很多 Provider 不支持 PDF 上传，也不稳定输出坐标；PaperLens 需要坐标来裁剪和定位。

## JSON 协议

`lib/ai-layout-schema.js` 已经定义了第一版本地规范化入口。AI 或外部 Provider 可以输出：

```json
{
  "provider": "vision-model-name",
  "title": "Paper title",
  "bodyStartPage": 1,
  "referencesStartPage": 10,
  "pages": [
    {
      "pageNumber": 1,
      "width": 612,
      "height": 792,
      "regions": [
        {
          "id": "p1",
          "type": "paragraph",
          "text": "The first body paragraph...",
          "bbox": [72, 120, 420, 96],
          "readingOrder": 1,
          "confidence": 0.91
        },
        {
          "type": "figure",
          "label": "Figure 1",
          "bbox": [72, 260, 420, 180],
          "confidence": 0.86
        }
      ]
    }
  ],
  "sections": [
    { "id": "intro", "title": "1 Introduction", "startPage": 1, "endPage": 2, "level": 1 }
  ]
}
```

规范化后会得到：

- `document`：标题、正文起点、References 起点、正文终点。
- `pages`：页码、尺寸、页面图路径。
- `sections`：章节结构。
- `regions`：正文、标题、图、表、公式、代码、噪声等区域。
- `paragraphs`：可进入分段/讲解队列的阅读段候选。
- `visualRegions`：可进入现有图表/公式/代码裁剪管线的区域。
- `diagnostics`：警告、数量统计、置信度和回退依据。

## 本地校验规则

AI 输出进入主流程前必须经过本地校验：

- 页码必须存在。
- bbox 必须是正数，并被 clamp 到页面边界内。
- region type 必须在白名单内。
- paragraph 必须有文本。
- visual region 必须保留坐标和置信度。
- unsupported、越界、空文本、重复 id 都进入 diagnostics。

这一步的意义很大：AI 可以大胆判断结构，但不能直接写坏 PaperLens 的内部数据。

## 分阶段实施

1. Schema and docs
   - 完成 `normalizeAiLayoutResult`。
   - 写清 AI-first 设计、JSON 协议、回退策略。

2. Prompt and mock provider
   - 写一个 command/mock provider，把页面图和文本摘要传入模型或脚本。
   - 输出 AI layout JSON。
   - 用 fixture 测试越界 bbox、重复 id、未知类型、跨栏顺序。

3. Hybrid integration
   - 上传后仍做本地抽取。
   - AI layout 只修正文起点、章节、readingOrder、视觉区域。
   - 失败时无感回退到本地结构。

4. UI and quality report
   - 上传后显示“解析模式：本地 / AI 布局 / 混合”。
   - 质量报告展示 AI layout 的 warnings、置信度和回退原因。
   - 分段调试里显示 AI 输出和本地修复结果的差异。

5. Real provider
   - 接支持图像/PDF 的模型。
   - 成本、耗时、失败率进入任务估算。
   - 长论文按页面窗口或章节窗口调用，避免一次塞完整 PDF 超时。

## 成功标准

- 对普通两栏论文，正文起点、章节、跨页段落和图表绑定明显优于纯启发式。
- AI layout 失败不会阻塞上传和阅读。
- 页面能解释当前为什么用了本地、AI 或 hybrid。
- 图表/公式/代码仍然能点击、定位、导出。
- 成本和耗时可预测，不让用户误以为“AI-first”就是免费秒出。
