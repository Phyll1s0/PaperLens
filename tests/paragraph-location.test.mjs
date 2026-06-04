import assert from "node:assert/strict";
import {
  buildParagraphLocation,
  enrichPaperParagraphLocations,
} from "../lib/paragraph-location.js";

const paper = {
  id: "paper_location_fixture",
  extractionPages: [
    { pageNumber: 2, width: 612, height: 792 },
    { pageNumber: 3, width: 612, height: 792 },
  ],
  pageImages: [
    { pageNumber: 2, imagePath: "/assets/page-002.png" },
    { pageNumber: 3, imagePath: "/assets/page-003.png" },
  ],
  pageArtifacts: [
    {
      id: "fig-1",
      type: "caption",
      visualType: "figure",
      label: "Figure 1",
      pageNumber: 3,
      text: "Figure 1. Overview.",
    },
    {
      id: "tbl-hidden",
      type: "caption",
      visualType: "table",
      label: "Table 2",
      pageNumber: 4,
      hidden: true,
    },
    {
      id: "eq-1",
      type: "formula",
      visualType: "formula",
      label: "Equation 1",
      pageNumber: 2,
    },
  ],
};

{
  const location = buildParagraphLocation(paper, {
    id: "p1",
    pageNumber: 2,
    pageEndNumber: 4,
    sourceBox: { x: 10, y: 20, width: 100, height: 50 },
    sourceText: "As shown in Figure 1, the method has three stages.",
    relatedArtifactIds: ["eq-1", "tbl-hidden"],
  });

  assert.equal(location.label, "p.2-4");
  assert.equal(location.isCrossPage, true);
  assert.deepEqual(location.pages, [2, 3, 4]);
  assert.equal(location.pageAnchors[0].label, "起 p.2");
  assert.equal(location.pageAnchors[0].hasPageImage, true);
  assert.equal(location.pageAnchors[0].hasSourceBox, true);
  assert.deepEqual(location.pageAnchors[0].sourceBox, { x: 10, y: 20, width: 100, height: 50, pageWidth: null, pageHeight: null });
  assert.equal(location.pageAnchors[0].pageWidth, 612);
  assert.equal(location.pageAnchors[0].pageHeight, 792);
  assert.equal(location.pageAnchors[1].role, "middle");
  assert.equal(location.pageAnchors[2].label, "止 p.4");
  assert.deepEqual(location.relatedArtifactPages, [2, 3]);
  assert.deepEqual(location.relatedArtifacts.map((item) => item.id), ["eq-1", "fig-1"]);
}

{
  const location = buildParagraphLocation({}, {
    id: "p2",
    pageNumber: 7,
    sourceText: "A single-page paragraph.",
  });

  assert.equal(location.label, "p.7");
  assert.equal(location.isCrossPage, false);
  assert.equal(location.pageCount, 1);
  assert.equal(location.pageAnchors[0].role, "single");
  assert.equal(location.pageAnchors[0].hasPageImage, false);
}

{
  const enriched = enrichPaperParagraphLocations({
    ...paper,
    paragraphs: [
      { id: "p1", pageNumber: 2, pageEndNumber: 3, sourceText: "Figure 1 appears here." },
      { id: "p2", pageNumber: 5, sourceText: "No artifact reference." },
    ],
  });

  assert.equal(enriched.paragraphs[0].location.label, "p.2-3");
  assert.deepEqual(enriched.paragraphs[0].location.relatedArtifactPages, [3]);
  assert.equal(enriched.paragraphs[1].location.label, "p.5");
}
