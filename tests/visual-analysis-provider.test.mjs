import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getVisualAnalysisProviderStatus,
  getVisualModelRegionsForPage,
  loadVisualAnalysisProvider,
  normalizeVisualAnalysisProvider,
} from "../lib/visual-analysis-provider.js";
import {
  enhancePagesWithVisualStructure,
  extractPageArtifacts,
} from "../lib/visual-artifacts.js";

assert.equal(normalizeVisualAnalysisProvider("model-json"), "json");
assert.equal(normalizeVisualAnalysisProvider("command"), "command");
assert.equal(normalizeVisualAnalysisProvider("off"), "heuristic");
assert.equal(normalizeVisualAnalysisProvider("unknown"), "heuristic");

const tempDir = await mkdtemp(path.join(os.tmpdir(), "paperlens-visual-provider-"));
try {
  const jsonPath = path.join(tempDir, "layout.json");
  await writeFile(jsonPath, JSON.stringify({
    pages: [
      {
        pageNumber: 1,
        regions: [
          {
            id: "fig-main",
            type: "chart",
            label: "Figure 2",
            x: 40,
            y: 50,
            width: 180,
            height: 90,
            confidence: 0.91,
          },
          {
            type: "equation",
            label: "Equation 1",
            bbox: [60, 160, 120, 26],
            confidence: 82,
          },
          {
            type: "paragraph",
            x: 0,
            y: 0,
            width: 10,
            height: 10,
          },
        ],
      },
    ],
  }));

  const provider = loadVisualAnalysisProvider({
    provider: "json",
    jsonPath,
  });
  const status = getVisualAnalysisProviderStatus(provider);
  assert.equal(status.provider, "json");
  assert.equal(status.status, "ok");
  assert.equal(status.regions, 3);

  const page = {
    pageNumber: 1,
    width: 300,
    height: 220,
    imagePath: "/assets/paper/page-001.png",
    blocks: [{
      text: "This body paragraph is not a visual artifact.",
      x: 20,
      y: 15,
      width: 260,
      height: 20,
      lineCount: 1,
    }],
  };
  const modelRegions = getVisualModelRegionsForPage(page, provider);
  assert.equal(modelRegions.length, 2);
  assert.deepEqual(modelRegions.map((region) => region.visualType), ["figure", "formula"]);
  assert.equal(modelRegions[0].source, "model-json");
  assert.equal(modelRegions[0].modelConfidence, 0.91);
  assert.equal(modelRegions[1].modelConfidence, 0.82);

  const enhanced = enhancePagesWithVisualStructure([page], {
    visualAnalysisProvider: provider,
  });
  assert.equal(enhanced[0].visualStructureVersion, 6);
  assert.equal(enhanced[0].visualAnalysisProvider, "json");
  assert.equal(enhanced[0].visualRegions.filter((region) => region.source === "model-json").length, 2);

  const artifacts = extractPageArtifacts(enhanced);
  const modelArtifacts = artifacts.filter((artifact) => artifact.modelGenerated);
  assert.equal(modelArtifacts.length, 2);
  assert.equal(modelArtifacts[0].label, "Figure 2");
  assert.equal(modelArtifacts[0].type, "caption");
  assert.equal(modelArtifacts[0].visualType, "figure");
  assert.equal(modelArtifacts[1].type, "formula");
  assert.equal(modelArtifacts[1].formulaRole, "display-formula");
  assert.equal(modelArtifacts[1].latexConfidence, "none");
  assert.equal(modelArtifacts[1].renderMode, "image");

  const commandPath = path.join(tempDir, "visual-command.mjs");
  await writeFile(commandPath, `
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
const page = payload.page;
process.stdout.write(JSON.stringify({
  regions: [
    {
      type: "table",
      label: "Table from command",
      x: 30,
      y: 40,
      width: 120,
      height: 60,
      confidence: 0.77,
      pageWidth: page.width,
      pageHeight: page.height
    }
  ]
}));
`);
  const commandProvider = loadVisualAnalysisProvider({
    provider: "command",
    command: process.execPath,
    commandArgs: [commandPath],
    cwd: tempDir,
    timeoutMs: 2000,
  });
  const commandRegions = getVisualModelRegionsForPage(page, commandProvider);
  assert.equal(commandRegions.length, 1);
  assert.equal(commandRegions[0].source, "model-command");
  assert.equal(commandRegions[0].visualType, "table");
  assert.equal(commandRegions[0].modelProvider, "command");
  assert.equal(commandRegions[0].modelConfidence, 0.77);

  const commandStatus = getVisualAnalysisProviderStatus(commandProvider);
  assert.equal(commandStatus.provider, "command");
  assert.equal(commandStatus.status, "ok");
  assert.equal(commandStatus.pages, 1);
  assert.equal(commandStatus.regions, 1);
  assert.equal(commandStatus.errors, 0);
  assert.equal(Array.isArray(commandStatus.args), true);

  const missingCommandProvider = loadVisualAnalysisProvider({ provider: "command" });
  assert.equal(getVisualAnalysisProviderStatus(missingCommandProvider).status, "error");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
