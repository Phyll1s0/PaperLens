export function normalizeRichTextSource(text) {
  return normalizeBrokenLatexBlocks(String(text || ""));
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
