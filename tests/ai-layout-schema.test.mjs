import assert from "node:assert/strict";
import {
  extractParagraphsFromAiLayout,
  extractVisualRegionsFromAiLayout,
  normalizeAiLayoutResult,
} from "../lib/ai-layout-schema.js";

const layout = normalizeAiLayoutResult({
  provider: "vision-test",
  title: "A Layout Paper",
  bodyStartPage: 1,
  referencesStartPage: 3,
  pages: [
    {
      pageNumber: 1,
      width: 600,
      height: 800,
      regions: [
        {
          id: "intro-title",
          type: "section",
          text: "1 Introduction",
          bbox: [48, 100, 220, 24],
          readingOrder: 1,
          confidence: 0.92,
        },
        {
          id: "p1",
          type: "body",
          text: "This paper introduces an AI-first layout pipeline.",
          x: 48,
          y: 140,
          width: 250,
          height: 80,
          readingOrder: 2,
          sectionId: "intro",
          confidence: 87,
        },
        {
          type: "equation",
          label: "Equation 1",
          x: 40,
          y: 730,
          width: 700,
          height: 120,
          confidence: 0.81,
        },
        {
          type: "unknown-box",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
        },
      ],
    },
  ],
  sections: [
    {
      id: "intro",
      title: "1 Introduction",
      startPage: 1,
      endPage: 2,
      level: 1,
    },
  ],
}, {
  pages: [
    { pageNumber: 2, width: 600, height: 800 },
    { pageNumber: 3, width: 600, height: 800 },
  ],
});

assert.equal(layout.version, 1);
assert.equal(layout.provider, "vision-test");
assert.equal(layout.status, "warn");
assert.equal(layout.document.title, "A Layout Paper");
assert.equal(layout.document.bodyEndPage, 2);
assert.equal(layout.pages.length, 3);
assert.equal(layout.sections.length, 1);

assert.equal(layout.regions.length, 3);
assert.deepEqual(layout.regions.map((region) => region.type), ["heading", "paragraph", "formula"]);
assert.equal(layout.regions[1].confidence, 0.87);
assert.equal(layout.regions[2].bbox.x, 40);
assert.equal(layout.regions[2].bbox.y, 730);
assert.equal(layout.regions[2].bbox.width, 560);
assert.equal(layout.regions[2].bbox.height, 70);
assert.ok(layout.diagnostics.warnings.some((warning) => warning.includes("unsupported type")));
assert.ok(layout.diagnostics.warnings.some((warning) => warning.includes("Clamped bbox")));

assert.equal(layout.paragraphs.length, 2);
assert.equal(layout.paragraphs[0].type, "heading");
assert.equal(layout.paragraphs[1].text, "This paper introduces an AI-first layout pipeline.");
assert.deepEqual(extractParagraphsFromAiLayout(layout).map((paragraph) => paragraph.text), [
  "1 Introduction",
  "This paper introduces an AI-first layout pipeline.",
]);

const visualRegions = extractVisualRegionsFromAiLayout(layout);
assert.equal(visualRegions.length, 1);
assert.equal(visualRegions[0].visualType, "formula");
assert.equal(visualRegions[0].source, "ai-layout");

const explicitParagraphs = normalizeAiLayoutResult({
  pages: [{ pageNumber: 1, width: 600, height: 800 }],
  paragraphs: [
    { id: "same", text: "Left column.", pageNumber: 1, bbox: [40, 100, 200, 50], readingOrder: 2 },
    { id: "same", text: "Right column.", pageNumber: 1, bbox: [320, 100, 200, 50], readingOrder: 1 },
  ],
});
assert.deepEqual(explicitParagraphs.paragraphs.map((paragraph) => paragraph.text), ["Right column.", "Left column."]);
assert.deepEqual(explicitParagraphs.paragraphs.map((paragraph) => paragraph.id), ["same-2", "same"]);
