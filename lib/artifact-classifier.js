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

  if (/^\s*(?:import|from|def|class|function|const|let|var|public|private|return)\b/i.test(raw)) {
    return true;
  }

  const numberedAlgorithmLines = countMatches(raw, /(?:^|\s)\d+\s*:\s*/g);
  if (numberedAlgorithmLines >= 3) {
    return true;
  }

  const inputOutputPrompt = /\b(?:Input|Output)\s*:/i.test(clean);
  if (inputOutputPrompt && numberedAlgorithmLines >= 2) {
    return true;
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

function countMatches(text, pattern) {
  return (String(text || "").match(pattern) || []).length;
}
