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

function countMatches(text, pattern) {
  return (String(text || "").match(pattern) || []).length;
}
