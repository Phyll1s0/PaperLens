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

  const lineCount = Math.max(Number(block.lineCount || 1), 1);
  const mathTokens = countMatches(clean, /[=≤≥≠≈∑∏∫√∞→←↔±×÷∂λμσγαβθΩΔκφℓη]|(?:\b(?:argmin|argmax|softmax|log|exp|min|max)\b)/gi);
  if (!mathTokens) {
    return false;
  }

  if (isLikelyCodeBlockText(text, block) && lineCount >= 4) {
    return false;
  }

  if (isLikelyChartAxisOrLegendText(clean)) {
    return false;
  }

  if (isLikelyTableOrHyperparameterText(clean)) {
    return false;
  }

  const proseWords = clean.match(/[A-Za-z]{3,}/g) || [];
  const sentenceBreaks = countMatches(clean, /[.!?。！？][)"'\]]?\s+[A-Z]/g);
  const proseBridge = /\b(?:where|otherwise|since|note that|to aggregate|in all experiments|for each|denoted|defined|we consider|we use|which|therefore|however)\b/i.test(clean);
  if ((sentenceBreaks >= 1 && proseWords.length > 10) || (proseBridge && proseWords.length > 8)) {
    return false;
  }

  const hasEquationShape = /(?:[A-Za-zα-ωΑ-Ωκφℓη][\wα-ωΑ-Ωκφℓη,:{}()[\]^+\-−*/|′˜ˆ]*\s*[=≤≥≈∈~]|[=≤≥≈∈~]\s*[A-Za-zα-ωΑ-Ωκφℓη0-9])/u.test(clean);
  if (!hasEquationShape) {
    return false;
  }

  if (clean.length <= 240 && lineCount <= 5 && proseWords.length <= 18 && mathTokens >= 2) {
    return true;
  }

  return clean.length <= 120 && lineCount <= 3 && proseWords.length <= 8;
}

export function isUsefulFormulaArtifactText(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) {
    return false;
  }

  if (isLikelyChartAxisOrLegendText(clean) || isLikelyTableOrHyperparameterText(clean)) {
    return false;
  }

  if (clean.length <= 16 &&
    !/[α-ωΑ-Ωκφℓηθσμ∑∏∫√∞≤≥≠≈]/u.test(clean) &&
    !/\b(?:WQL|MASE|CRPS|QL|NLL|MSE|RMSE)\b/.test(clean)) {
    return false;
  }

  return true;
}

export function isLikelyTableBodyBlockText(text, block = {}) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean || /^(?:figure|fig\.|table)\s+\d+[a-z]?\s*[:.]/i.test(clean)) {
    return false;
  }

  const lineCount = Math.max(Number(block.lineCount || 1), 1);
  const averageLineLength = clean.length / Math.max(1, lineCount);
  const sentenceCount = countMatches(clean, /[.!?。！？]/g);
  if (lineCount < 2 || averageLineLength > 48 || sentenceCount >= 2) {
    return false;
  }

  const numberTokens = countMatches(clean, /\b\d+(?:[.,]\d+)*%?\b/g);
  const citationTokens = countMatches(clean, /\[[0-9,\s]+\]/g);
  const tableWords = countMatches(clean, /\b(?:architecture|granularity|format|metadata|model|dataset|method|metric|mae|mse|rmse|accuracy|perplexity|latency|throughput|average|baseline|ours|fp\d+|int\d+|mxfp|nvfp|smx|group-\d+)\b/gi);
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
