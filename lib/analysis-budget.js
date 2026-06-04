export const ANALYSIS_COST_RATES_USD_PER_1M_TOKENS = {
  general: { input: 0.6, output: 2.4 },
  deepseek: { input: 0.3, output: 1.2 },
  "kimi-direct": { input: 0.4, output: 1.6 },
  "kimi-code-direct": { input: 0.4, output: 1.6 },
  "claude-agent": { input: 3, output: 15 },
};

const TOKEN_CHARS = 3.5;
const PROMPT_OVERHEAD_TOKENS = 650;
const PER_PARAGRAPH_INPUT_OVERHEAD_TOKENS = 180;
const PROFILE_OUTPUT_MULTIPLIERS = {
  quality: 1.35,
  fast: 1.05,
};
const PROFILE_OUTPUT_FLOORS = {
  quality: 420,
  fast: 260,
};

export function approximateTokenCount(chars) {
  return Math.ceil(Math.max(0, Number(chars || 0)) / TOKEN_CHARS);
}

export function buildAnalysisResourceEstimate(paragraphs = []) {
  const pageNumbers = new Set();
  let chars = 0;
  for (const paragraph of paragraphs) {
    chars += String(paragraph?.sourceText || "").length;
    const pageStart = normalizePositivePageNumber(paragraph?.pageNumber, 0);
    const pageEnd = normalizePositivePageNumber(paragraph?.pageEndNumber || paragraph?.pageNumber, pageStart);
    for (let page = pageStart; page <= pageEnd && page > 0; page += 1) {
      pageNumbers.add(page);
    }
  }

  return {
    paragraphs: paragraphs.length,
    chars,
    approxTokens: approximateTokenCount(chars),
    pages: pageNumbers.size,
  };
}

export function estimateAnalysisBudget(options = {}) {
  const paragraphs = Array.isArray(options.paragraphs) ? options.paragraphs : [];
  const settings = options.settings || {};
  const resourceEstimate = normalizeResourceEstimate(options.resourceEstimate || buildAnalysisResourceEstimate(paragraphs));
  const providerClass = classifyAnalysisProvider(settings);
  const profile = normalizeAnalysisProfile(settings.analysisProfile);
  const rates = getAnalysisCostRate(providerClass);
  const paragraphCount = resourceEstimate.paragraphs;
  const sourceTokens = resourceEstimate.approxTokens;
  const inputOverheadTokens = paragraphCount
    ? PROMPT_OVERHEAD_TOKENS + paragraphCount * PER_PARAGRAPH_INPUT_OVERHEAD_TOKENS
    : 0;
  const inputTokens = Math.ceil(sourceTokens + inputOverheadTokens);
  const outputTokens = paragraphCount
    ? Math.ceil(sourceTokens * PROFILE_OUTPUT_MULTIPLIERS[profile] + paragraphCount * PROFILE_OUTPUT_FLOORS[profile])
    : 0;
  const totalTokens = inputTokens + outputTokens;
  const estimatedCostUsd = roundUsd((inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output);
  const maxTaskBudgetUsd = normalizeTaskBudgetUsd(settings.taskBudgetUsd);

  return {
    ...resourceEstimate,
    providerClass,
    profile,
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd,
    maxTaskBudgetUsd,
    exceedsTaskBudget: isTaskBudgetExceeded({ estimatedCostUsd, maxTaskBudgetUsd }),
    rate: {
      inputUsdPer1M: rates.input,
      outputUsdPer1M: rates.output,
    },
    estimatedSeconds: normalizeNonNegativeNumber(options.estimatedSeconds),
    source: resourceEstimate.source || "",
    approximate: true,
  };
}

export function classifyAnalysisProvider(settings = {}) {
  const provider = String(settings.provider || "").toLowerCase();
  const baseUrl = String(settings.baseUrl || "").toLowerCase();
  const model = String(settings.model || "").toLowerCase();
  const kimiCodeDirectLike = baseUrl === "local:claude-kimi";
  const agentLike = !kimiCodeDirectLike && (provider.startsWith("claude") || baseUrl.startsWith("local:claude"));
  if (kimiCodeDirectLike) {
    return "kimi-code-direct";
  }
  if (agentLike) {
    return "claude-agent";
  }
  if (provider.includes("deepseek") || baseUrl.includes("deepseek") || model.includes("deepseek")) {
    return "deepseek";
  }
  if (provider.includes("kimi") || baseUrl.includes("moonshot") || baseUrl.includes("api.kimi.com")) {
    return "kimi-direct";
  }
  return "general";
}

export function getAnalysisCostRate(providerClass) {
  return ANALYSIS_COST_RATES_USD_PER_1M_TOKENS[providerClass] || ANALYSIS_COST_RATES_USD_PER_1M_TOKENS.general;
}

export function normalizeTaskBudgetUsd(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return 0;
  }
  return Math.round(number * 10000) / 10000;
}

export function isTaskBudgetExceeded(estimate = {}) {
  const maxTaskBudgetUsd = normalizeTaskBudgetUsd(estimate.maxTaskBudgetUsd);
  return maxTaskBudgetUsd > 0 && Number(estimate.estimatedCostUsd || 0) > maxTaskBudgetUsd;
}

function normalizeResourceEstimate(value = {}) {
  return {
    paragraphs: Math.max(0, Math.trunc(Number(value.paragraphs || 0))),
    chars: Math.max(0, Math.trunc(Number(value.chars || 0))),
    approxTokens: Math.max(0, Math.trunc(Number(value.approxTokens || 0))),
    pages: Math.max(0, Math.trunc(Number(value.pages || 0))),
    source: value.source ? String(value.source) : "",
  };
}

function normalizeAnalysisProfile(profile) {
  return profile === "fast" ? "fast" : "quality";
}

function normalizePositivePageNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return Number(fallback) || 1;
  }
  return Math.trunc(number);
}

function normalizeNonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.ceil(number) : 0;
}

function roundUsd(value) {
  return Math.round(Math.max(0, Number(value || 0)) * 10000) / 10000;
}
