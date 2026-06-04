#!/usr/bin/env node

const input = await readStdin();
const payload = JSON.parse(input || "{}");
const page = payload.page || {};
const regions = [];

for (const block of Array.isArray(page.blocks) ? page.blocks : []) {
  const text = String(block.text || "").replace(/\s+/g, " ").trim();
  const box = normalizeBlockBox(block);
  if (!text || !box) {
    continue;
  }

  if (/^(?:figure|fig\.)\s+\d+[a-z]?\s*[:.]/i.test(text)) {
    regions.push({
      type: "figure",
      label: text.match(/^(?:figure|fig\.)\s+\d+[a-z]?/i)?.[0] || "Figure",
      ...expandBox(box, page, 0.08, 0.2),
      confidence: 0.55,
    });
  } else if (/^table\s+\d+[a-z]?\s*[:.]/i.test(text)) {
    regions.push({
      type: "table",
      label: text.match(/^table\s+\d+[a-z]?/i)?.[0] || "Table",
      ...expandBox(box, page, 0.08, 0.18),
      confidence: 0.55,
    });
  } else if (isFormulaLike(text)) {
    regions.push({
      type: "formula",
      label: "",
      ...expandBox(box, page, 0.03, 0.04),
      confidence: 0.5,
    });
  }
}

process.stdout.write(`${JSON.stringify({
  pageNumber: page.pageNumber || null,
  regions: regions.slice(0, 32),
})}\n`);

function normalizeBlockBox(block = {}) {
  const x = Number(block.x);
  const y = Number(block.y);
  const width = Number(block.width);
  const height = Number(block.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return null;
  }
  return { x, y, width, height };
}

function expandBox(box, page, xRatio, yRatio) {
  const pageWidth = Number(page.width || box.x + box.width);
  const pageHeight = Number(page.height || box.y + box.height);
  const padX = pageWidth * xRatio;
  const padY = pageHeight * yRatio;
  const x = clamp(box.x - padX, 0, pageWidth);
  const y = clamp(box.y - padY, 0, pageHeight);
  const right = clamp(box.x + box.width + padX, x + 1, pageWidth);
  const bottom = clamp(box.y + box.height + padY, y + 1, pageHeight);
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
    pageWidth,
    pageHeight,
  };
}

function isFormulaLike(text) {
  return text.length <= 260 &&
    /[=≤≥≠≈∑∏∫√∞→←↔±×÷∂]|\\[A-Za-z]+/.test(text) &&
    !/[.!?。！？].{8,}/.test(text);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
