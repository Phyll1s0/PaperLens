# Whole-paper Deep Analysis Design

这条路线解决的是 AI 产出质量：让模型真正理解整篇论文后，再生成翻译和讲解。它和 AI-first layout 不同：

- AI-first layout 负责版面结构、阅读顺序、段落和图表区域。
- Whole-paper deep analysis 负责全文理解、章节主线、术语一致性和讲解质量。

## 为什么不直接一次生成整篇翻译

“一次长思考生成整篇翻译和解析”听起来最自然，但直接这么做风险很高：

- 长输出容易偷懒，后半部分变成摘要或泛泛讲解。
- 很难保证每个段落都被翻译、讲解，没有漏项。
- 一旦失败，无法只补跑某几段。
- 输出太长时 JSON/Markdown 容易断裂。
- 用户不能边生成边读，也看不到具体哪一段出错。

所以更稳的方案不是“单次巨型生成”，而是“全文长思考 + 可校验分块生成”。

## 推荐流程

```text
PDF / paragraphs
  -> whole-paper deep pass
  -> paper brief + section plans + terminology + claim graph
  -> section-level analysis drafts
  -> paragraph-aligned generation
  -> coverage verifier
  -> missing/weak paragraph repair
```

## 第 1 步：全文长思考产出蓝图

模型先读整篇论文或章节窗口，输出结构化蓝图，而不是直接输出所有翻译：

```json
{
  "paperBrief": "整篇论文主线",
  "sectionPlans": [
    {
      "sectionId": "sec_1",
      "title": "1 Introduction",
      "role": "提出问题和贡献",
      "mustMention": ["motivation", "main contribution"],
      "terms": ["microscaling", "metadata"]
    }
  ],
  "terminology": [
    { "source": "block floating-point", "zh": "块浮点", "note": "保持全篇一致" }
  ],
  "claimGraph": [
    { "claim": "方法提升低比特量化精度", "evidence": ["Figure 3", "Table 2"], "pages": [8, 9] }
  ],
  "formulaMap": [
    { "label": "Equation 1", "meaning": "定义缩放因子", "usedBy": ["sec_2"] }
  ],
  "visualMap": [
    { "label": "Figure 1", "meaning": "展示数据格式", "usedBy": ["sec_2"] }
  ],
  "writingRules": [
    "translation 必须逐段忠实翻译",
    "explanation 必须说明段落在章节论证中的作用",
    "不要把图表 caption 当正文段落翻译"
  ]
}
```

这一步解决“全文上下文”，并给后续段落生成提供强约束。

## 第 2 步：章节级草稿

每个章节生成一个 section digest：

- 本节在论文中的作用。
- 本节主要概念和符号。
- 本节涉及的图表/公式。
- 本节段落之间的逻辑顺序。
- 本节讲解时必须避免的误解。

章节草稿比整篇完整翻译短很多，但比单段上下文强很多。

当前实现入口在 `lib/deep-paper-plan.js`：

- `buildSectionDigestsForPaper(paper, plan)` 从 Deep Paper Plan、章节、段落和 pageArtifacts 生成 section digest。
- `attachSectionDigestsToPaper(paper, plan)` 把每个 paragraph 挂到对应的 `sectionDigestId`。
- `formatSectionDigestForPrompt(digest)` 把章节草稿压缩成可放进后续 batch prompt 的上下文。
- `buildSectionDraftsForPaper(paper, sectionDigests, plan)` 生成可选的整节草稿上下文。
- `attachSectionDraftsToPaper(paper, sectionDrafts, plan)` 把每个 paragraph 挂到对应的 `sectionDraftId`。
- `formatSectionDraftForPrompt(draft)` 把整节草稿压缩成 prompt 上下文。

每个 digest 都带 fingerprint。只要章节归属、段落正文、页码或关联 artifact 变了，fingerprint 就会变化；否则后续重跑可以复用旧 digest。

整节草稿是 context-only：

- 它可以综合 section digest、已有段落翻译/讲解、公式/图表引用，给后续逐段生成提供“这一节应该怎么讲”的局部蓝图。
- 它不会替代 paragraph-aligned storage，也不会作为最终翻译导出。
- 当前版本不额外发起一轮模型调用，因此不会显著拖慢精读任务；以后如果接入真正的 AI 整节预写，也会落在同一个 draft schema 里，并继续保持逐段校验。

## 第 3 步：段落对齐生成

最终仍然按段落或小批次写入 PaperLens 数据结构：

```json
{
  "items": [
    {
      "paragraphId": "para_12",
      "translation": "逐段忠实翻译",
      "explanation": "结合 paperBrief 和 sectionPlan 的精读讲解",
      "keyTerms": ["术语"],
      "coverage": {
        "translatedAllSentences": true,
        "mentionsSectionRole": true,
        "mentionsRelevantFormulaOrFigure": true
      }
    }
  ]
}
```

当前 batch prompt 已接入：

- 全局上下文优先携带 Deep Paper Plan，包括 paperBrief、mainThread、terminology、claimGraph、formulaMap、visualMap。
- 每个 batch 会携带本批涉及章节的 section digest 和 context-only section draft。
- 每个 paragraph 块继续保留页码、邻近段落和相关 artifact 上下文。
- 输出必须包含 `coverage`，为后续 anti-laziness verifier 提供基础信号。

这样 PaperLens 仍然能：

- 显示段落级进度。
- 失败后只补跑缺失段落。
- 导出和问答继续复用段落结构。
- 做质量报告和覆盖率检查。

## 第 4 步：防偷懒校验

为了防止 AI 偷懒，需要一个 verifier：

- 每个 paragraphId 必须返回。
- translation 长度不能明显短于原文。
- explanation 不能只有一句空泛总结。
- 原文里的公式、图表引用、关键术语不能消失。
- 如果 paragraph 属于 sectionPlan 的 mustMention 范围，讲解必须覆盖。
- 对失败项标记 `weakAnalysis`，进入补跑队列。

当前实现入口在 `lib/analysis-verifier.js`：

- `verifyBatchAnalysisResults(paper, paragraphs, results)` 检查 batch 是否漏掉 paragraphId，并汇总弱项。
- `verifyParagraphAnalysis(paper, paragraph, analysis)` 检查单段翻译/讲解质量。
- 后端会保存 `analysisVerification`、`weakAnalysis` 和 `analysisWeakReasons`。

目前 verifier 已能标记：

- 缺少 paragraphId。
- translation/explanation 缺失或明显过短。
- 多句原文被压成短摘要。
- 讲解只有一句泛泛总结。
- Figure/Table/Equation 引用没有保留或解释。
- Deep Paper Plan / Paper Memory 里的关键术语没有按术语表保留或翻译。
- 模型自报 coverage 不完整或置信度偏低。

这比“相信一次长输出”稳得多。

## 第 5 步：弱分析补跑

当 verifier 把某段标记为 `weakAnalysis` 后，PaperLens 会把它纳入修复流程：

- 普通精读 job 结束前，会自动收集本轮 weak 段落并小批量补跑一次。
- 补跑 prompt 会带上 `analysisWeakReasons` 和上一版翻译/讲解，让模型知道具体要修什么。
- 补跑成功后标记 `analysisRepairStatus = "repaired"`。
- 如果补跑后仍然 weak，则标记 `analysisRepairStatus = "weak-after-repair"`，保留风险原因，等待用户或后续 repair loop 再处理。
- 默认只自动修一轮，避免长任务因为模型持续偷懒而无限循环。

## UI 上应该怎么表现

用户不需要看到这些内部阶段的 prompt，只需要看到：

- 正在全文预读。
- 正在生成章节理解。
- 正在逐段写入翻译和讲解。
- 正在检查是否漏段/偷懒。
- 哪些段落需要补跑。

质量报告里增加：

- 全文蓝图是否可用。
- 章节计划覆盖率。
- 术语一致性风险。
- 段落漏项/弱讲解数量。
- 是否启用了 whole-paper deep mode。

当前已接入的展示层：

- 质量报告增加 whole-paper 指标：Deep Paper Plan 可用性、section digest 覆盖率、weakAnalysis 数量、术语漂移和漏图表/公式引用风险。
- 段落卡显示“全文上下文”“弱分析”“已修复/仍需复查”等 badge。
- 导出 QA 会把 weakAnalysis、术语漂移和漏引用作为 warning，避免导出一份看似完整但质量有风险的笔记。

## 实施顺序

1. 扩展 Paper Memory 为 `Deep Paper Plan`。
   - 保存 paperBrief、sectionPlans、terminology、claimGraph、formulaMap、visualMap。
   - `lib/deep-paper-plan.js` 提供第一版 schema normalizer，可先从现有 Paper Memory 和结构地图生成计划，后续 AI 输出也走同一个校验入口。

2. 新增 section digest。
   - 每个章节有自己的 summary、role、terms、figures、formulas、pitfalls。
   - `buildSectionDigestsForPaper` 和 `attachSectionDigestsToPaper` 已提供第一版本地生成与段落挂载。

3. 修改 batch analysis prompt。
   - 每个 batch 带 paperBrief + 当前 section digest + terminology。
   - 不再只带短 Paper Memory。
   - 目前已接入 prompt 和 paragraph writeback，coverage 先保存，下一步 verifier 再做硬判定。

4. 加 coverage verifier。
   - 检查漏项、短翻译、空泛讲解、术语/公式/图表缺失。
   - 第一版 `analysis-verifier` 已接入，先标记 weakAnalysis；下一步再自动补跑弱段落。

5. 加 UI 状态和质量报告。
   - 显示 whole-paper deep pass 是否成功。
   - 弱段落可一键补跑。
   - 后端 weak repair loop 已能自动补跑一次；UI badge 和质量报告聚合放到下一步。
   - 质量报告、段落卡和导出 QA 已显示 whole-paper/weak-analysis 风险；后续还可以做更漂亮的 review workflow。

## 成功标准

- 同一术语全篇翻译一致。
- 讲解能说明段落在整篇论文中的作用，而不是只复述当前段。
- 长论文不会因为单次超长输出失败而全盘失败。
- AI 偷懒时能被检测并补跑。
- 导出结果仍然是段落对齐、可定位、可补修的。
