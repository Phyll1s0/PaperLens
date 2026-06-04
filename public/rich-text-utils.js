export function normalizeRichTextSource(text) {
  return normalizeBrokenLatexBlocks(String(text || ""));
}

export function buildSourceMarkdown(text, block = {}) {
  const source = normalizeRichTextSource(String(text || "").replace(/\s+/g, " ").trim());
  if (!source || /^\*\*[^*]+?\*\*/.test(source)) {
    return source;
  }

  const leadIn = detectSourceLeadIn(source, block);
  if (!leadIn?.text) {
    return source;
  }

  return `**${leadIn.text}**${source.slice(leadIn.end)}`;
}

export function detectSourceLeadIn(text, block = {}) {
  const source = String(text || "").replace(/\s+/g, " ").trim();
  if (!source || source.length < 28 || /^\*\*/.test(source)) {
    return null;
  }

  const match = source.match(/^(.{6,96}?(?:\.|:))\s+(.{8,})/);
  if (!match) {
    return null;
  }

  const lead = match[1].trim();
  if (!isLikelyTitleCaseLeadIn(lead) && !hasLayoutLeadInCue(block, lead)) {
    return null;
  }

  return {
    text: lead,
    end: lead.length,
    source: hasLayoutLeadInCue(block, lead) ? "layout-lead-in" : "titlecase-lead-in",
  };
}

function isLikelyTitleCaseLeadIn(lead) {
  const words = String(lead || "")
    .replace(/[()[\].,:;]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < 2 || words.length > 12) {
    return false;
  }

  const stopWords = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);
  const significant = words.filter((word) => !stopWords.has(word.toLowerCase()));
  return significant.length >= 2 && significant.every(isTitleLeadToken);
}

function isTitleLeadToken(word) {
  const clean = String(word || "").replace(/^[^\w]+|[^\w]+$/g, "");
  return /^[A-Z][A-Za-z0-9+-]*$/.test(clean) ||
    /^[A-Z0-9]{2,}$/.test(clean) ||
    /^[A-Z]+[a-z]*[A-Z][A-Za-z0-9]*$/.test(clean);
}

function hasLayoutLeadInCue(block = {}, lead = "") {
  const lines = Array.isArray(block?.lines) ? block.lines : [];
  if (lines.length < 2) {
    return false;
  }

  const first = lines[0] || {};
  const firstText = String(first.text || "");
  const firstNeedle = String(lead || "").slice(0, Math.min(18, lead.length));
  if (!firstNeedle || !firstText.startsWith(firstNeedle)) {
    return false;
  }

  const laterLines = lines.slice(1).filter((line) =>
    Number.isFinite(Number(line?.x)) && Number.isFinite(Number(line?.height)) && Number(line.height) > 0);
  if (!laterLines.length) {
    return false;
  }

  const firstX = Number(first.x || 0);
  const firstHeight = Number(first.height || 0);
  const minLaterX = Math.min(...laterLines.map((line) => Number(line.x)));
  const medianLaterHeight = median(laterLines.map((line) => Number(line.height)));
  return firstX > minLaterX + 3 || (firstHeight > 0 && medianLaterHeight > 0 && firstHeight / medianLaterHeight >= 1.035);
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) {
    return 0;
  }

  return sorted[Math.floor(sorted.length / 2)];
}

export function normalizeBrokenLatexBlocks(text) {
  const lines = String(text || "").split(/\r?\n/);
  if (lines.length < 3) {
    return text;
  }

  const result = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!isLatexShardLine(line)) {
      result.push(line);
      index += 1;
      continue;
    }

    const shardLines = [];
    let cursor = index;
    while (cursor < lines.length && isLatexShardLine(lines[cursor])) {
      shardLines.push(lines[cursor]);
      cursor += 1;
    }

    if (isLikelyBrokenLatexBlock(shardLines)) {
      result.push(`$${normalizeBareLatexExpression(shardLines.join(" "))}$`);
    } else {
      result.push(...shardLines);
    }
    index = cursor;
  }

  return result.join("\n");
}

export function isLatexShardLine(line) {
  const clean = String(line || "").trim();
  if (!clean || clean.length > 80) {
    return false;
  }

  if (/[\u4e00-\u9fff]/.test(clean)) {
    return false;
  }

  return /^[A-Za-z0-9\\{}()[\],.:;=+\-*/^_<>\s≤≥≠≈∑∏∫√∞→←↔±×÷∂λμσγαβθΩΔ⋯…|]+$/.test(clean);
}

export function isLikelyBrokenLatexBlock(lines) {
  const cleanLines = lines.map((line) => String(line || "").trim()).filter(Boolean);
  if (cleanLines.length < 4) {
    return false;
  }

  const joined = cleanLines.join(" ");
  const hasMathOperator = /[:=<>≤≥≠≈∑∏∫√∞→←↔±×÷∂]|\\[A-Za-z]+|\\[{}]|[{}^_]|⋯|…/.test(joined);
  const hasVariable = /[A-Za-z][A-Za-z0-9]*|[αβγδεθλμσΩΔ]/.test(joined);
  const mostlyShort = cleanLines.filter((line) => line.length <= 16).length / cleanLines.length >= 0.75;
  const proseLikeLines = cleanLines.filter((line) => /^[A-Za-z]{4,}(?:\s+[A-Za-z]{3,})+$/.test(line)).length;
  return hasMathOperator && hasVariable && mostlyShort && proseLikeLines <= 1;
}

export function normalizeBareLatexExpression(source) {
  return normalizeMathUnicodeAlphanumerics(String(source || ""))
    .replace(/\s+/g, " ")
    .replace(/\s*:\s*=\s*/g, ":=")
    .replace(/\s*([=<>≤≥≠≈+\-*/→←↔±×÷])\s*/g, "$1")
    .replace(/\s*,\s*/g, ",")
    .replace(/\s*(\\[{}])\s*/g, "$1")
    .replace(/\s*([{}()[\]])\s*/g, "$1")
    .replace(/\b([A-Za-z])\s+([0-9]+(?::[A-Za-z0-9]+)?|[A-Za-z])\b/g, "$1_{$2}")
    .replace(/\\\s+([A-Za-z{}])/g, "\\$1")
    .trim();
}

export function normalizeFormulaArtifactLatex(source) {
  return normalizeMathUnicodeAlphanumerics(String(source || ""))
    .replace(/\s+/g, " ")
    .replace(/−/g, "-")
    .replace(/ℓ/g, "\\ell")
    .replace(/[θ𝜃𝛉𝝑]/g, "\\theta")
    .replace(/[α𝛼𝜶]/g, "\\alpha")
    .replace(/[β𝛽𝜷]/g, "\\beta")
    .replace(/[γ𝛾𝜸]/g, "\\gamma")
    .replace(/[σ𝜎𝝈]/g, "\\sigma")
    .replace(/[μ𝜇𝝁]/g, "\\mu")
    .replace(/[λ𝜆𝝀]/g, "\\lambda")
    .replace(/[η𝜂𝜼]/g, "\\eta")
    .replace(/[Ω𝛺𝜴]/g, "\\Omega")
    .replace(/[Δ𝛥𝜟]/g, "\\Delta")
    .replace(/\b(log|exp|min|max|softmax|argmin|argmax)\b/g, "\\$1")
    .replace(/\b(WQL|MASE|CRPS|NLL|RMSE|MSE|QL)\b/g, "\\mathrm{$1}")
    .replace(/\b(FP|INT|MXFP|NVFP|SMX)(\d+)\b/g, "\\mathrm{$1$2}")
    .replace(/\b([A-Za-z])(?:_)?(elem|meta|scale|max|min|pow|idx|top\d?)\b/gi, (_, variable, suffix) =>
      `${variable}_{\\mathrm{${suffix}}}`)
    .replace(/\bp(?:_?\{?\\theta\}?|\\theta)\b/g, "p_{\\theta}")
    .replace(/\b([A-Za-z])([A-Z]\s*[+\-]\s*[A-Za-z0-9]+(?:\s*[+\-]\s*[A-Za-z0-9]+)*)\b/g, "$1_{$2}")
    .replace(/\b([A-Za-z])(\d+(?::[A-Za-z0-9+\-]+)?(?:[+\-][A-Za-z0-9]+)*)\b/g, "$1_{$2}")
    .replace(/\s*([=<>≤≥≠≈+\-*/→←↔±×÷])\s*/g, "$1")
    .replace(/\s*,\s*/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeMathUnicodeAlphanumerics(source) {
  return Array.from(String(source || ""), (char) => mapMathUnicodeAlphanumeric(char)).join("");
}

function mapMathUnicodeAlphanumeric(char) {
  const code = char.codePointAt(0);
  const ranges = [
    [0x1d400, 0x1d419, 0x41],
    [0x1d41a, 0x1d433, 0x61],
    [0x1d434, 0x1d44d, 0x41],
    [0x1d44e, 0x1d467, 0x61],
    [0x1d468, 0x1d481, 0x41],
    [0x1d482, 0x1d49b, 0x61],
    [0x1d5a0, 0x1d5b9, 0x41],
    [0x1d5ba, 0x1d5d3, 0x61],
    [0x1d7ce, 0x1d7d7, 0x30],
  ];

  for (const [start, end, base] of ranges) {
    if (code >= start && code <= end) {
      return String.fromCharCode(base + code - start);
    }
  }

  if (char === "ℎ") {
    return "h";
  }

  return char;
}
