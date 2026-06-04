import assert from "node:assert/strict";
import {
  approximateTokenCount,
  buildAnalysisResourceEstimate,
  classifyAnalysisProvider,
  estimateAnalysisBudget,
  isTaskBudgetExceeded,
  normalizeTaskBudgetUsd,
} from "../lib/analysis-budget.js";

const paragraphs = [
  { id: "p1", sourceText: "a".repeat(3500), pageNumber: 1 },
  { id: "p2", sourceText: "b".repeat(700), pageNumber: 2, pageEndNumber: 3 },
];

assert.equal(approximateTokenCount(3500), 1000);
assert.equal(normalizeTaskBudgetUsd("0"), 0);
assert.equal(normalizeTaskBudgetUsd("1.23991"), 1.2399);

const resourceEstimate = buildAnalysisResourceEstimate(paragraphs);
assert.deepEqual(resourceEstimate, {
  paragraphs: 2,
  chars: 4200,
  approxTokens: 1200,
  pages: 3,
});

const qualityEstimate = estimateAnalysisBudget({
  paragraphs,
  settings: {
    provider: "deepseek",
    model: "deepseek-chat",
    analysisProfile: "quality",
    taskBudgetUsd: 0.001,
  },
  estimatedSeconds: 90,
});
assert.equal(qualityEstimate.providerClass, "deepseek");
assert.equal(qualityEstimate.inputTokens, 2210);
assert.equal(qualityEstimate.outputTokens, 2460);
assert.equal(qualityEstimate.totalTokens, 4670);
assert.equal(qualityEstimate.estimatedCostUsd, 0.0036);
assert.equal(qualityEstimate.maxTaskBudgetUsd, 0.001);
assert.equal(qualityEstimate.exceedsTaskBudget, true);
assert.equal(qualityEstimate.estimatedSeconds, 90);
assert.equal(qualityEstimate.approximate, true);

const cappedEstimate = estimateAnalysisBudget({
  resourceEstimate,
  settings: {
    provider: "deepseek",
    model: "deepseek-chat",
    analysisProfile: "quality",
    taskBudgetUsd: 0.003,
  },
});
assert.equal(cappedEstimate.maxTaskBudgetUsd, 0.003);
assert.equal(cappedEstimate.exceedsTaskBudget, true);
assert.equal(
  estimateAnalysisBudget({
    resourceEstimate,
    settings: { provider: "deepseek", model: "deepseek-chat", taskBudgetUsd: 0.01 },
  }).exceedsTaskBudget,
  false,
);
assert.equal(isTaskBudgetExceeded({ estimatedCostUsd: 0.02, maxTaskBudgetUsd: 0.01 }), true);
assert.equal(isTaskBudgetExceeded({ estimatedCostUsd: 0.02, maxTaskBudgetUsd: 0 }), false);

const fastEstimate = estimateAnalysisBudget({
  paragraphs,
  settings: { provider: "custom", model: "gpt-test", analysisProfile: "fast" },
});
assert.equal(fastEstimate.providerClass, "general");
assert.equal(fastEstimate.outputTokens, 1780);
assert.ok(fastEstimate.estimatedCostUsd > 0);

assert.equal(classifyAnalysisProvider({ baseUrl: "local:claude-kimi" }), "kimi-code-direct");
assert.equal(classifyAnalysisProvider({ provider: "claude-local", baseUrl: "local:claude-config" }), "claude-agent");
assert.equal(classifyAnalysisProvider({ provider: "kimi-platform", baseUrl: "https://api.moonshot.cn/v1" }), "kimi-direct");
