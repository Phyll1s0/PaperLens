import assert from "node:assert/strict";
import {
  FORMULA_RENDER_MODE_IMAGE,
  FORMULA_RENDER_MODE_IMAGE_LATEX,
  FORMULA_RENDER_MODE_LATEX,
  applyFormulaRenderFields,
  buildFormulaRenderFields,
  getFormulaAuxiliaryTextLabel,
  shouldExportFormulaLatexText,
  shouldExportFormulaTextAsAuxiliary,
} from "../lib/formula-render-quality.js";

const crop = { x: 10, y: 20, width: 240, height: 80, pageWidth: 612, pageHeight: 792 };

const renderable = {
  id: "eq-good",
  type: "formula",
  visualType: "formula",
  text: "\\[L(\\theta)=\\sum_t y_t\\]",
  imagePath: "/assets/page.png",
  crop,
};
assert.deepEqual(buildFormulaRenderFields(renderable), {
  formulaRole: "display-formula",
  formulaRoleReason: "short-equation",
  latexConfidence: "high",
  latexSource: "pdf-text",
  renderMode: FORMULA_RENDER_MODE_LATEX,
  formulaLatexRisk: "",
});
assert.equal(shouldExportFormulaLatexText(renderable), true);

const brokenPdfFormula = {
  id: "eq-broken",
  type: "formula",
  visualType: "formula",
  text: "y 1 : L : = { y 1 , ⋯ , y L }",
  imagePath: "/assets/page.png",
  crop,
};
const brokenFields = buildFormulaRenderFields(brokenPdfFormula);
assert.equal(brokenFields.latexConfidence, "low");
assert.equal(brokenFields.renderMode, FORMULA_RENDER_MODE_IMAGE_LATEX);
assert.equal(brokenFields.formulaLatexRisk, "broken-pdf-spacing");
assert.equal(shouldExportFormulaLatexText(brokenPdfFormula), false);
assert.equal(shouldExportFormulaTextAsAuxiliary(brokenPdfFormula), true);
assert.equal(getFormulaAuxiliaryTextLabel(brokenPdfFormula), "识别文本（低置信，仅供核对）");

const mediumPdfFormulaWithCrop = {
  id: "eq-medium-crop",
  type: "formula",
  visualType: "formula",
  text: "WQL = 1 WQLαj. j=1",
  imagePath: "/assets/page.png",
  crop,
};
const mediumCropFields = buildFormulaRenderFields(mediumPdfFormulaWithCrop);
assert.equal(mediumCropFields.latexConfidence, "medium");
assert.equal(mediumCropFields.renderMode, FORMULA_RENDER_MODE_IMAGE_LATEX);
assert.equal(shouldExportFormulaLatexText(mediumPdfFormulaWithCrop), false);
assert.equal(shouldExportFormulaTextAsAuxiliary(mediumPdfFormulaWithCrop), true);
assert.equal(getFormulaAuxiliaryTextLabel(mediumPdfFormulaWithCrop), "识别文本（图片优先，供核对）");

const mediumPdfFormulaWithoutCrop = {
  id: "eq-medium-no-crop",
  type: "formula",
  visualType: "formula",
  text: "WQL = 1 WQLαj. j=1",
};
const mediumNoCropFields = buildFormulaRenderFields(mediumPdfFormulaWithoutCrop);
assert.equal(mediumNoCropFields.latexConfidence, "medium");
assert.equal(mediumNoCropFields.renderMode, FORMULA_RENDER_MODE_LATEX);

const manualFormulaWithCrop = {
  id: "eq-manual",
  type: "formula",
  visualType: "formula",
  text: "WQL = \\sum_j WQL_{\\alpha_j}",
  latexSource: "manual",
  imagePath: "/assets/page.png",
  crop,
};
const manualFields = buildFormulaRenderFields(manualFormulaWithCrop);
assert.equal(manualFields.latexConfidence, "high");
assert.equal(manualFields.renderMode, FORMULA_RENDER_MODE_LATEX);

const modelOnly = {
  id: "eq-model",
  type: "formula",
  visualType: "formula",
  text: "Model formula 1",
  modelGenerated: true,
  imagePath: "/assets/page.png",
  crop,
};
const modelFields = buildFormulaRenderFields(modelOnly);
assert.equal(modelFields.latexConfidence, "none");
assert.equal(modelFields.renderMode, FORMULA_RENDER_MODE_IMAGE);
assert.equal(shouldExportFormulaLatexText(modelOnly), false);
assert.equal(shouldExportFormulaTextAsAuxiliary(modelOnly), false);

const edited = {
  id: "eq-edited",
  type: "formula",
  visualType: "formula",
  text: "x = 1",
  formulaRole: "display-formula",
  latexConfidence: "high",
  renderMode: FORMULA_RENDER_MODE_LATEX,
};
edited.type = "caption";
edited.visualType = "figure";
applyFormulaRenderFields(edited);
assert.equal(edited.latexConfidence, undefined);
assert.equal(edited.renderMode, undefined);
assert.equal(edited.formulaRole, undefined);
