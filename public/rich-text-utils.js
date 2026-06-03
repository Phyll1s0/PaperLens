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
  return String(source || "")
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
