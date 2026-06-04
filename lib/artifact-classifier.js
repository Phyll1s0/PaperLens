export function isLikelyCodeBlockText(text, block = {}) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) {
    return false;
  }

  const raw = String(block.rawText || block.text || text || "");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const lineCount = Math.max(Number(block.lineCount || 0), lines.length, 1);

  if (/^\s*(?:import|from|def|class|function|const|let|var|public|private)\b/.test(raw) ||
    /^\s*return\b/.test(raw)) {
    return true;
  }

  if (isLikelyChartAxisOrLegendText(clean) || isLikelyChartPanelText(clean)) {
    return false;
  }

  const numberedAlgorithmLines = countMatches(raw, /(?:^|\s)\d+\s*:\s*/g);
  if (numberedAlgorithmLines >= 3) {
    return true;
  }

  const inputOutputPrompt = /\b(?:Input|Output)\s*:/i.test(clean);
  if (inputOutputPrompt && numberedAlgorithmLines >= 2) {
    return true;
  }

  if (isLikelyProseText(clean)) {
    return false;
  }

  const proseSentenceBreaks = countMatches(clean, /[.!?。！？][)"'\]]?\s+[A-Z]/g);
  if (proseSentenceBreaks >= 2) {
    return false;
  }

  const codeControlWords = countMatches(clean, /\b(?:return|while|elseif|else|endif|end\s+for|end\s+if)\b/gi);
  const codeDeclarationWords = countMatches(clean, /\b(?:function|class|def|const|let|var|public|private|void|int|float|string|boolean)\b/gi);
  const codeOperators = countMatches(clean, /(?:<-|←|=>|==|!=|<=|>=|:=|::|[{};])/g);
  const assignmentOperators = countMatches(clean, /(?:<-|←|:=|=)/g);
  const averageLineLength = clean.length / Math.max(1, lineCount);

  if (lineCount >= 4 && averageLineLength <= 96 && inputOutputPrompt && assignmentOperators >= 2) {
    return true;
  }

  if (lineCount >= 4 && averageLineLength <= 88 && codeControlWords >= 2 && assignmentOperators >= 2) {
    return true;
  }

  if (lineCount >= 3 && averageLineLength <= 96 && codeDeclarationWords >= 2 && codeOperators >= 3) {
    return true;
  }

  return false;
}

export function isLikelyCaptionBlockText(text) {
  return /^(?:figure|fig\.|table)\s+\d+[a-z]?\s*[:.]/i.test(String(text || "").replace(/\s+/g, " ").trim());
}

export function isLikelyFormulaBlockText(text, block = {}) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) {
    return false;
  }

  return classifyFormulaTextRole(clean, block).role === "display-formula";
}

export function classifyFormulaTextRole(text, block = {}) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) {
    return createFormulaRole("noise", "empty", 0, block);
  }

  if (isEquationNumberText(clean)) {
    return createFormulaRole("equation-number", "standalone-equation-number", 0, block);
  }

  const lineCount = Math.max(Number(block.lineCount || 1), 1);
  const mathTokens = countFormulaMathTokens(clean);
  if (!mathTokens) {
    return createFormulaRole("noise", "no-math-token", mathTokens, block);
  }

  if (isLikelyCodeBlockText(text, block) && lineCount >= 4) {
    return createFormulaRole("noise", "code-block", mathTokens, block);
  }

  if (isLikelyChartAxisOrLegendText(clean) || isLikelyChartPanelText(clean)) {
    return createFormulaRole("noise", "chart-axis-or-panel", mathTokens, block);
  }

  if (isLikelyTableOrHyperparameterText(clean)) {
    return createFormulaRole("noise", "table-or-hyperparameter", mathTokens, block);
  }

  if (isLikelyNumericTableFormulaNoise(clean, mathTokens)) {
    return createFormulaRole("noise", "numeric-table", mathTokens, block);
  }

  if (isLikelyIsolatedMathFragment(clean, mathTokens, lineCount)) {
    return createFormulaRole("noise", "isolated-fragment", mathTokens, block);
  }

  const proseWords = clean.match(/[A-Za-z]{3,}/g) || [];
  const sentenceBreaks = countMatches(clean, /[.!?。！？][)"'\]]?\s+[A-Z]/g);
  const proseBridge = /\b(?:where|otherwise|since|note that|to aggregate|in all experiments|for each|denoted|defined|we consider|we use|which|therefore|however)\b/i.test(clean);
  if ((sentenceBreaks >= 1 && proseWords.length > 10) || (proseBridge && proseWords.length > 8)) {
    return createFormulaRole("inline-math", "prose-with-math", mathTokens, block);
  }

  const hasEquationShape = hasFormulaEquationShape(clean);
  if (!hasEquationShape) {
    if (isLikelyInlineMathMention(clean, mathTokens)) {
      return createFormulaRole("inline-math", "math-mention", mathTokens, block);
    }
    return createFormulaRole("noise", "no-equation-shape", mathTokens, block);
  }

  if (clean.length <= 240 && lineCount <= 5 && proseWords.length <= 18 && mathTokens >= 2) {
    return createFormulaRole("display-formula", "compact-equation", mathTokens, block);
  }

  if (clean.length <= 120 && lineCount <= 3 && proseWords.length <= 8) {
    return createFormulaRole("display-formula", "short-equation", mathTokens, block);
  }

  return createFormulaRole("inline-math", "long-math-text", mathTokens, block);
}

export function isUsefulFormulaArtifactText(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) {
    return false;
  }

  if (isLikelyChartAxisOrLegendText(clean) || isLikelyTableOrHyperparameterText(clean)) {
    return false;
  }

  const role = classifyFormulaTextRole(clean, {
    lineCount: Math.max(1, clean.split(/\s{2,}|\n/).filter(Boolean).length),
  });
  if (role.role !== "display-formula") {
    return false;
  }

  if (clean.length <= 16 &&
    !/[α-ωΑ-Ωκφℓηθσμ∑∏∫√∞≤≥≠≈]/u.test(clean) &&
    !/\b(?:WQL|MASE|CRPS|QL|NLL|MSE|RMSE)\b/.test(clean)) {
    return false;
  }

  return true;
}

function createFormulaRole(role, reason, mathTokens, block = {}) {
  return {
    role,
    reason,
    mathTokens,
    lineCount: Math.max(Number(block.lineCount || 1), 1),
  };
}

function isEquationNumberText(text) {
  return /^\(?\d+[a-z]?\)?$/i.test(String(text || "").trim());
}

function countFormulaMathTokens(text) {
  return countMatches(
    text,
    /[=≤≥≠≈∑∏∫√∞→←↔±×÷∂λμσγαβθΩΔκφℓη∈∀∃∇⊙⊗∝∼~]|(?:\b(?:argmin|argmax|softmax|log|exp|min|max|lim)\b)/giu,
  );
}

function hasFormulaEquationShape(text) {
  return /(?:[A-Za-zα-ωΑ-Ωκφℓη][\wα-ωΑ-Ωκφℓη,:{}()[\]^+\-−*/|′˜ˆ<>]*\s*[=≤≥≈∈~]|[=≤≥≈∈~]\s*[A-Za-zα-ωΑ-Ωκφℓη0-9])/u
    .test(String(text || ""));
}

function isLikelyInlineMathMention(text, mathTokens) {
  const clean = String(text || "");
  return mathTokens >= 1 &&
    clean.length >= 80 &&
    /\b(?:Let|let|where|denote|denotes|defined|we|the|this|vector|matrix|distribution|function)\b/.test(clean);
}

function isLikelyNumericTableFormulaNoise(text, mathTokens) {
  const clean = String(text || "");
  const numberTokens = countMatches(clean, /\b\d+(?:[.,]\d+)*(?:%|[a-z])?\b/gi);
  const metricWords = countMatches(clean, /\b(?:Loss|Accuracy|Latency|Params|MAE|MSE|RMSE|Perplexity|RankIC|IC|AER|IR|FP\d+|INT\d+|E\d+M\d+)\b/gi);
  const separators = countMatches(clean, /[|,:;]/g);
  return numberTokens >= 5 && metricWords >= 2 && mathTokens <= 2 && (separators >= 1 || clean.length <= 180) && clean.length <= 260;
}

function isLikelyIsolatedMathFragment(text, mathTokens, lineCount) {
  const clean = String(text || "").trim();
  const words = clean.match(/[A-Za-z]{2,}/g) || [];
  if (clean.length <= 8 && lineCount <= 1) {
    return true;
  }
  if (clean.length <= 18 && lineCount <= 1 && mathTokens <= 1 && words.length <= 1) {
    return true;
  }
  return /^[A-Za-zα-ωΑ-Ω][\wα-ωΑ-Ω_′ˆ˜-]*\s*=\s*(?:\d+|[A-Za-zα-ωΑ-Ω])$/u.test(clean);
}

export function isLikelyTableBodyBlockText(text, block = {}) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean || /^(?:figure|fig\.|table)\s+\d+[a-z]?\s*[:.]/i.test(clean)) {
    return false;
  }

  const lineCount = Math.max(Number(block.lineCount || 1), 1);
  const averageLineLength = clean.length / Math.max(1, lineCount);
  const sentenceCount = countSentencePunctuation(clean);
  if (lineCount < 2 || averageLineLength > 48 || sentenceCount >= 2) {
    return false;
  }

  const numberTokens = countMatches(clean, /\b\d+(?:[.,]\d+)*%?\b/g);
  const citationTokens = countMatches(clean, /\[[0-9,\s]+\]/g);
  const tableWords = countMatches(clean, /\b(?:architecture|granularity|format|metadata|model|dataset|method|metric|mae|mse|rmse|accuracy|perplexity|latency|throughput|average|baseline|ours|layers?|heads?|vocab|params?|dmodel|dff|fp\d+|int\d+|mxfp|nvfp|smx|group-\d+)\b/gi);
  const columnish = lineCount >= 4 && averageLineLength <= 38 && (numberTokens + citationTokens + tableWords) >= 3;
  const compactHeader = lineCount <= 4 && clean.length <= 260 && tableWords >= 3 && sentenceCount === 0;
  return columnish || compactHeader;
}

function isLikelyChartAxisOrLegendText(text) {
  const clean = String(text || "");
  if (/^h\s*=\s*\d+$/i.test(clean)) {
    return true;
  }

  const hLabels = countMatches(clean, /\bh\s*=\s*\d+\b/gi);
  if (hLabels >= 2) {
    return true;
  }

  if (/\b(?:Token ID|Density|Forecast|Ground Truth|Prediction|Quantile|Time Step)\b/i.test(clean) &&
    clean.length <= 180) {
    return true;
  }

  const numericTicks = countMatches(clean, /\b\d{2,4}(?:\.\d+)?\b/g);
  return numericTicks >= 5 && clean.length <= 180;
}

function isLikelyTableOrHyperparameterText(text) {
  const clean = String(text || "");
  if (/\b(?:Task-specific|GluonTS|StatsForecast|Reference|Pretrained|Fine-tuning|epochs|Hyperparameters|Implementation|Probabilistic|Patch length|Stride|Kernel size|Residual channels|Input size multiplier)\b/i.test(clean)) {
    return true;
  }

  if (/\b(?:Model|Type|Implementation|Hyperparameters)\b/i.test(clean) &&
    countMatches(clean, /\b(?:Yes|No|N\/A|Local|Pretrained|Task-specific)\b/gi) >= 2) {
    return true;
  }

  return false;
}

function isLikelyChartPanelText(text) {
  const clean = String(text || "");
  const chartTaskWords = countMatches(clean, /\b(?:Forecasting|Reconstruction|GroundTruth|Ground Truth|Kline Chart|Time|RankIC|MAE|MSE|R²|IC|AER|IR)\b/g);
  const numberTokens = countMatches(clean, /\b\d+(?::\d+)?(?:\.\d+)?\b/g);
  if (chartTaskWords >= 2 && numberTokens >= 2 && clean.length <= 260) {
    return true;
  }

  const timeTicks = countMatches(clean, /\b\d{4}\s+\d{2}:\d{2}\b/g);
  return timeTicks >= 2 && /\b(?:Time|GroundTruth|Kline Chart|Reconstruction)\b/.test(clean);
}

function isLikelyProseText(text) {
  const clean = String(text || "");
  const sentenceBreaks = countMatches(clean, /[.!?。！？][)"'\]]?\s+[A-Z]/g);
  if (sentenceBreaks >= 1 && clean.length > 120) {
    return true;
  }

  return /^(?:Let|Assume|Suppose|The|This|In this|We|Our)\b/.test(clean) &&
    /[.!?。！？]/.test(clean) &&
    clean.length > 100;
}

function countMatches(text, pattern) {
  return (String(text || "").match(pattern) || []).length;
}

function countSentencePunctuation(text) {
  return countMatches(text, /(?<!\d)[.!?。！？](?!\d)/g);
}
