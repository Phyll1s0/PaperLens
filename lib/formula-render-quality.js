import {
  classifyFormulaTextRole,
} from "./artifact-classifier.js";

export const FORMULA_RENDER_MODE_LATEX = "latex";
export const FORMULA_RENDER_MODE_IMAGE_LATEX = "image-latex";
export const FORMULA_RENDER_MODE_IMAGE = "image";

const LATEX_CONFIDENCE_VALUES = new Set(["high", "medium", "low", "none"]);

export function buildFormulaRenderFields(artifact = {}) {
  if (!isFormulaArtifact(artifact)) {
    return {};
  }

  const text = normalizeFormulaText(artifact.latex || artifact.text || "");
  const role = artifact.formulaRole
    ? {
        role: artifact.formulaRole,
        reason: artifact.formulaRoleReason || "stored",
      }
    : classifyFormulaTextRole(text, artifact);
  const riskReasons = findFormulaLatexRiskReasons(text);
  const source = inferFormulaTextSource(artifact, text);
  const latexConfidence = normalizeLatexConfidence(
    inferLatexConfidence({
      artifact,
      text,
      role,
      riskReasons,
      source,
    }),
  );
  const renderMode = normalizeFormulaRenderMode(inferFormulaRenderMode({
    artifact,
    text,
    latexConfidence,
  }));

  return {
    formulaRole: role?.role || "",
    formulaRoleReason: role?.reason || "",
    latexConfidence,
    latexSource: source,
    renderMode,
    formulaLatexRisk: riskReasons[0] || "",
  };
}

export function applyFormulaRenderFields(artifact = {}) {
  if (!isFormulaArtifact(artifact)) {
    delete artifact.latexConfidence;
    delete artifact.latexSource;
    delete artifact.renderMode;
    delete artifact.formulaLatexRisk;
    delete artifact.formulaRole;
    delete artifact.formulaRoleReason;
    return artifact;
  }

  Object.assign(artifact, buildFormulaRenderFields({
    ...artifact,
    latexConfidence: "",
    renderMode: "",
    formulaRole: "",
    formulaRoleReason: "",
  }));
  return artifact;
}

export function normalizeFormulaRenderMode(value) {
  const clean = String(value || "").trim().toLowerCase();
  if (clean === FORMULA_RENDER_MODE_LATEX ||
    clean === FORMULA_RENDER_MODE_IMAGE_LATEX ||
    clean === FORMULA_RENDER_MODE_IMAGE) {
    return clean;
  }
  return FORMULA_RENDER_MODE_IMAGE;
}

export function normalizeLatexConfidence(value) {
  const clean = String(value || "").trim().toLowerCase();
  return LATEX_CONFIDENCE_VALUES.has(clean) ? clean : "none";
}

export function shouldExportFormulaLatexText(artifact = {}) {
  if (!isFormulaArtifact(artifact)) {
    return Boolean(String(artifact.text || "").trim());
  }

  const fields = buildFormulaRenderFields(artifact);
  return fields.renderMode === FORMULA_RENDER_MODE_LATEX &&
    (fields.latexConfidence === "high" || fields.latexConfidence === "medium");
}

export function shouldExportFormulaTextAsAuxiliary(artifact = {}) {
  if (!isFormulaArtifact(artifact)) {
    return false;
  }

  const fields = buildFormulaRenderFields(artifact);
  return fields.renderMode === FORMULA_RENDER_MODE_IMAGE_LATEX &&
    fields.latexConfidence === "low" &&
    Boolean(normalizeFormulaText(artifact.latex || artifact.text || ""));
}

export function findFormulaLatexRiskReasons(text) {
  const value = String(text || "");
  if (!value.trim()) {
    return [];
  }

  const risks = [];
  const dollarCount = countUnescapedToken(value, "$");
  if (dollarCount % 2 === 1) {
    risks.push("unbalanced-dollar");
  }
  if (countLiteralToken(value, "\\[") !== countLiteralToken(value, "\\]")) {
    risks.push("unbalanced-display-delimiter");
  }
  if (countLiteralToken(value, "\\(") !== countLiteralToken(value, "\\)")) {
    risks.push("unbalanced-inline-delimiter");
  }

  const begins = [...value.matchAll(/\\begin\{([^}]+)\}/g)].map((match) => match[1]);
  const ends = [...value.matchAll(/\\end\{([^}]+)\}/g)].map((match) => match[1]);
  if (begins.length !== ends.length || begins.some((name, index) => name !== ends[index])) {
    risks.push("unbalanced-environment");
  }

  if (isLikelyBrokenPdfFormulaText(value)) {
    risks.push("broken-pdf-spacing");
  }

  if (isPlaceholderFormulaText(value)) {
    risks.push("placeholder-text");
  }

  return [...new Set(risks)];
}

function inferLatexConfidence({ artifact, text, role, riskReasons, source }) {
  if (!text || isPlaceholderFormulaText(text)) {
    return "none";
  }

  if (riskReasons.length) {
    return "low";
  }

  if (role?.role !== "display-formula") {
    return role?.role === "inline-math" ? "low" : "none";
  }

  if (isManualFormulaArtifact(artifact) && hasLatexStructure(text)) {
    return "high";
  }

  if (hasBalancedMathDelimiters(text) && hasLatexStructure(text)) {
    return "high";
  }

  if (source === "model-label") {
    return "none";
  }

  if (hasLatexStructure(text)) {
    return "medium";
  }

  if (hasPlainEquationShape(text)) {
    return "medium";
  }

  return "low";
}

function inferFormulaRenderMode({ artifact, text, latexConfidence }) {
  const hasCrop = hasUsableFormulaCrop(artifact);
  if (!text || latexConfidence === "none") {
    return hasCrop ? FORMULA_RENDER_MODE_IMAGE : FORMULA_RENDER_MODE_LATEX;
  }

  if (latexConfidence === "low") {
    return hasCrop ? FORMULA_RENDER_MODE_IMAGE_LATEX : FORMULA_RENDER_MODE_LATEX;
  }

  return FORMULA_RENDER_MODE_LATEX;
}

function inferFormulaTextSource(artifact, text) {
  if (!text) {
    return "none";
  }
  if (isManualFormulaArtifact(artifact)) {
    return "manual";
  }
  if (artifact.modelGenerated || /^model formula \d+$/i.test(text)) {
    return "model-label";
  }
  if (artifact.ocr || artifact.ocrText || artifact.ocrSource) {
    return "ocr-text";
  }
  return "pdf-text";
}

function isFormulaArtifact(artifact = {}) {
  return artifact.type === "formula" || artifact.visualType === "formula";
}

function normalizeFormulaText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function isManualFormulaArtifact(artifact = {}) {
  return Boolean(
    artifact.manualArtifactOverride ||
      artifact.manualEditedAt ||
      artifact.manualTextEditedAt ||
      artifact.latexSource === "manual",
  );
}

function hasUsableFormulaCrop(artifact = {}) {
  const crop = artifact.crop || {};
  return Boolean(
    artifact.imagePath &&
      Number(crop.width) > 0 &&
      Number(crop.height) > 0 &&
      Number(crop.pageWidth || artifact.pageWidth) > 0 &&
      Number(crop.pageHeight || artifact.pageHeight) > 0,
  );
}

function hasLatexStructure(text) {
  const clean = String(text || "");
  return /\\[A-Za-z]+|\\[()[\]]|[_^{}]|[≤≥≠≈∑∏∫√∞→←↔±×÷∂]/u.test(clean);
}

function hasBalancedMathDelimiters(text) {
  const clean = String(text || "");
  if (/\\\[|\\\]|\\\(|\\\)|\$\$|(^|[^\\])\$/.test(clean)) {
    return !findFormulaLatexRiskReasons(clean).length;
  }
  return false;
}

function hasPlainEquationShape(text) {
  return /[A-Za-zα-ωΑ-Ω][\wα-ωΑ-Ω()[\]^+\-−*/|′˜ˆ<>]*\s*[=≤≥≈]\s*[^=]/u
    .test(String(text || ""));
}

function isLikelyBrokenPdfFormulaText(text) {
  const clean = String(text || "").trim();
  const tokens = clean.split(/\s+/).filter(Boolean);
  if (tokens.length < 8) {
    return false;
  }

  const shortTokens = tokens.filter((token) => /^[A-Za-z0-9_{}()[\],.:;=+\-*/^<>≤≥≠≈⋯…|]$/.test(token)).length;
  const operatorTokens = tokens.filter((token) => /^[:=+\-*/^<>≤≥≠≈⋯…|]$/.test(token)).length;
  return shortTokens / tokens.length >= 0.68 && operatorTokens >= 2;
}

function isPlaceholderFormulaText(text) {
  const clean = normalizeFormulaText(text);
  return /^model formula \d+$/i.test(clean) || /^formula(?:\s+\d+)?$/i.test(clean);
}

function countLiteralToken(value, token) {
  if (!token) {
    return 0;
  }

  let count = 0;
  let start = 0;
  while (true) {
    const index = value.indexOf(token, start);
    if (index === -1) {
      return count;
    }
    count += 1;
    start = index + token.length;
  }
}

function countUnescapedToken(value, token) {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== token) {
      continue;
    }
    let backslashes = 0;
    let cursor = index - 1;
    while (cursor >= 0 && value[cursor] === "\\") {
      backslashes += 1;
      cursor -= 1;
    }
    if (backslashes % 2 === 0) {
      count += 1;
    }
  }
  return count;
}
