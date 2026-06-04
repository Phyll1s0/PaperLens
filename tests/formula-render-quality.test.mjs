import assert from "node:assert/strict";
import {
  FORMULA_RENDER_MODE_IMAGE,
  FORMULA_RENDER_MODE_IMAGE_LATEX,
  FORMULA_RENDER_MODE_LATEX,
  applyFormulaRenderFields,
  buildFormulaRenderFields,
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
