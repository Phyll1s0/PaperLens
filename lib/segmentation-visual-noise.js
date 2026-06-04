const DIAGRAM_TOKEN_RE = /\b(?:ai|llm|query|chunk|task|agent|worker|manager|planner|controller|workflow|pipeline|stage|step|node|edge|graph|input|output|encoder|decoder|token|tokenizer|embedding|layer|head|attention|prompt|summary|final|score|scorer|loss|logits|sample|sampler|coarse|fine|memory|retrieval|tool|code|api|pdf|page|block|segment|translate|explain|question|answer|figure|table|module|model)\b/gi;
const CONNECTOR_RE = /(?:->|=>|<-|<->|\u2192|\u2190|\u2194|\u21d2|\u21d0|\u21d4|\u2191|\u2193|::|\+|\/|\||\bto\b)/gi;
const SENTENCE_END_RE = /[.!?\u3002\uff01\uff1f][)"'\]]?(\s|$)/g;
const DIAGRAM_TOKEN_TEST_RE = /\b(?:ai|llm|query|chunk|task|agent|worker|manager|planner|controller|workflow|pipeline|stage|step|node|edge|graph|input|output|encoder|decoder|token|tokenizer|embedding|layer|head|attention|prompt|summary|final|score|scorer|loss|logits|sample|sampler|coarse|fine|memory|retrieval|tool|code|api|pdf|page|block|segment|translate|explain|question|answer|figure|table|module|model)\b/i;
const CONNECTOR_TEST_RE = /(?:->|=>|<-|<->|\u2192|\u2190|\u2194|\u21d2|\u21d0|\u21d4|\u2191|\u2193|::|\+|\/|\||\bto\b)/i;
const SENTENCE_END_TEST_RE = /[.!?\u3002\uff01\uff1f][)"'\]]?(\s|$)/;

export function isLikelyDiagramOnlyText(text, context = {}) {
  const raw = String(text || "");
  const clean = normalizeVisualNoiseText(raw);
  if (!clean || clean.length > 520) {
    return false;
  }

  const lineCount = Math.max(1, Number(context?.lineCount || inferLineCount(raw)) || 1);
  const averageLineLength = clean.length / lineCount;
  const sentenceCount = (clean.match(SENTENCE_END_RE) || []).length;
  if (sentenceCount >= 1 && !(sentenceCount === 1 && averageLineLength <= 26 && lineCount >= 6)) {
    return false;
  }

  const diagramTokens = (clean.match(DIAGRAM_TOKEN_RE) || []).length;
  const connectorTokens = (clean.match(CONNECTOR_RE) || []).length;
  const labelSignals = countShortLabelSignals(raw, clean, lineCount);

  if (lineCount >= 4 && averageLineLength < 42 && diagramTokens >= 4) {
    return true;
  }
  if (lineCount >= 4 && averageLineLength <= 38 && diagramTokens >= 2 && (connectorTokens >= 1 || labelSignals >= 2)) {
    return true;
  }
  if (lineCount >= 5 && averageLineLength <= 34 && diagramTokens >= 1 && connectorTokens >= 2) {
    return true;
  }
  if (lineCount >= 6 && averageLineLength <= 30 && diagramTokens >= 3) {
    return true;
  }

  return false;
}

function countShortLabelSignals(raw, clean, lineCount) {
  const lines = raw.split(/\n+/)
    .map((line) => normalizeVisualNoiseText(line))
    .filter(Boolean);
  if (lines.length >= 3) {
    return lines.filter((line) =>
      line.length <= 42 &&
      !SENTENCE_END_TEST_RE.test(line) &&
      (DIAGRAM_TOKEN_TEST_RE.test(line) || CONNECTOR_TEST_RE.test(line) || /^[A-Z][\w /+-]{1,36}$/.test(line))
    ).length;
  }

  const colonLabels = (clean.match(/\b[A-Z][\w /+-]{1,24}\s*:/g) || []).length;
  const slashLabels = (clean.match(/\b[A-Z][\w+-]+(?:\/[A-Z][\w+-]+)+\b/g) || []).length;
  return Math.max(colonLabels + slashLabels, lineCount >= 4 ? Math.floor(lineCount / 2) : 0);
}

function inferLineCount(text) {
  const lines = String(text || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return lines.length || 1;
}

function normalizeVisualNoiseText(text) {
  return String(text || "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}
