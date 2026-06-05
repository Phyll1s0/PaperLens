import assert from "node:assert/strict";
import {
  attachSectionDigestsToPaper,
  attachSectionDraftsToPaper,
  buildDeepPaperPlanFromPaperMemory,
  buildSectionDigestsForPaper,
  buildSectionDraftsForPaper,
  findSectionDigestForParagraph,
  findSectionDraftForParagraph,
  findSectionPlanByTitle,
  formatDeepPaperPlanForPrompt,
  formatSectionDigestForPrompt,
  formatSectionDraftForPrompt,
  normalizeDeepPaperPlan,
} from "../lib/deep-paper-plan.js";

const paper = {
  title: "M2XFP Test Paper",
  sections: [
    { id: "intro", title: "1 Introduction", startPage: 1, endPage: 2 },
    { id: "method", title: "2 Method", startPage: 3, endPage: 5 },
  ],
  paragraphs: [
    {
      id: "p-intro",
      order: 0,
      sectionId: "intro",
      pageNumber: 1,
      sourceText: "Microscaling motivates metadata-friendly low-bit quantization for modern accelerators.",
      relatedArtifactIds: ["fig-1"],
    },
    {
      id: "p-method-1",
      order: 1,
      sectionId: "method",
      pageNumber: 3,
      sourceText: "The method computes the shared scale as S = 2^floor(log2(xmax/P)) and keeps E8M0 metadata hardware-friendly.",
      relatedArtifactIds: ["eq-1"],
    },
    {
      id: "p-method-2",
      order: 2,
      sectionId: "method",
      pageNumber: 4,
      pageEndNumber: 5,
      sourceText: "Table 1 compares M2XFP metadata overhead with FP4 baselines across model layers.",
      relatedArtifactIds: ["tbl-1"],
    },
  ],
  pageArtifacts: [
    {
      id: "fig-1",
      type: "caption",
      visualType: "figure",
      label: "Figure 1",
      pageNumber: 2,
      text: "Shows the microscaling data format.",
    },
    {
      id: "eq-1",
      type: "formula",
      visualType: "formula",
      label: "Equation 1",
      pageNumber: 3,
      text: "S = 2^floor(log2(xmax/P))",
    },
    {
      id: "tbl-1",
      type: "caption",
      visualType: "table",
      label: "Table 1",
      pageNumber: 4,
      text: "Metadata overhead comparison.",
    },
  ],
};

const paperMemory = {
  version: 1,
  source: "ai",
  paperTitle: "M2XFP Test Paper",
  summary: "The paper proposes a metadata-augmented microscaling format.",
  mainThread: "It motivates low-bit quantization, designs the format, then evaluates hardware impact.",
  keyTerms: ["Microscaling", "E8M0", "Metadata"],
  contributions: ["M2XFP improves low-bit quantization accuracy."],
  importantFormulas: [
    { label: "Equation 1", pageNumber: 3, text: "S = 2^floor(log2(xmax/P))", purpose: "Defines scale selection." },
  ],
  importantVisuals: [
    { label: "Figure 1", type: "figure", pageNumber: 2, description: "Shows the microscaling data format." },
  ],
  segmentationGuidance: ["Keep Figure captions out of body paragraphs."],
};

const structureMap = {
  paperTitle: "M2XFP Test Paper",
  segmentationPlan: [
    { id: "intro", title: "1 Introduction", role: "Motivation and contributions", startPage: 1, endPage: 2 },
    { id: "method", title: "2 Method", role: "Format design", startPage: 3, endPage: 5 },
  ],
};

const plan = buildDeepPaperPlanFromPaperMemory(paper, structureMap, paperMemory, {
  generatedAt: "2026-06-05T00:00:00.000Z",
});

assert.equal(plan.version, 1);
assert.equal(plan.status, "ready");
assert.equal(plan.paperTitle, "M2XFP Test Paper");
assert.match(plan.paperBrief, /metadata-augmented/);
assert.equal(plan.sectionPlans.length, 2);
assert.equal(plan.sectionPlans[1].id, "method");
assert.equal(plan.sectionPlans[1].role, "Format design");
assert.deepEqual(plan.terminology.map((item) => item.source), ["Microscaling", "E8M0", "Metadata"]);
assert.equal(plan.claimGraph[0].claim, "M2XFP improves low-bit quantization accuracy.");
assert.equal(plan.formulaMap[0].label, "Equation 1");
assert.equal(plan.visualMap[0].label, "Figure 1");
assert.match(plan.fingerprint, /^[a-f0-9]{16}$/);

const prompt = formatDeepPaperPlanForPrompt(plan, {
  sectionId: "method",
  limit: 1800,
});
assert.match(prompt, /Whole-paper brief/);
assert.match(prompt, /Terminology/);
assert.match(prompt, /Current section plan: 2 Method/);
assert.match(prompt, /Formula map/);

const explicit = normalizeDeepPaperPlan({
  paperTitle: "Explicit Plan",
  paperBrief: "A full-paper plan.",
  sectionPlans: [
    {
      id: "sec",
      title: "3 Evaluation",
      role: "Validate the method",
      mustMention: ["datasets", "baselines"],
      terms: ["Ablation"],
      formulas: ["Equation 2"],
      visuals: ["Table 1"],
      pitfalls: ["Do not confuse latency with throughput."],
      confidence: 82,
    },
  ],
  terminology: [
    { source: "throughput", zh: "吞吐量", aliases: ["tokens/s"], confidence: 0.9 },
    "latency",
  ],
  claimGraph: [
    { claim: "The method improves accuracy.", evidence: ["Table 1"], pages: [6, "7"], sectionIds: ["sec"] },
  ],
  writingRules: ["Explain section role."],
}, paper, null, null, {
  source: "ai",
});

assert.equal(explicit.status, "ready");
assert.equal(explicit.sectionPlans[0].level, 1);
assert.equal(explicit.sectionPlans[0].confidence, 0.82);
assert.deepEqual(explicit.terminology.map((item) => item.source), ["throughput", "latency"]);
assert.equal(explicit.terminology[0].zh, "吞吐量");
assert.deepEqual(explicit.claimGraph[0].pages, [6, 7]);
assert.equal(findSectionPlanByTitle(explicit, "3 Evaluation").id, "sec");

const digests = buildSectionDigestsForPaper(paper, plan);
assert.equal(digests.length, 2);
const methodDigest = digests.find((digest) => digest.sectionId === "method");
assert.equal(methodDigest.title, "2 Method");
assert.equal(methodDigest.role, "Format design");
assert.deepEqual(methodDigest.paragraphIds, ["p-method-1", "p-method-2"]);
assert.equal(methodDigest.paragraphCount, 2);
assert.match(methodDigest.summary, /shared scale/);
assert.ok(methodDigest.keyTerms.some((term) => term.source === "E8M0"));
assert.ok(methodDigest.keySymbols.includes("E8M0"));
assert.ok(methodDigest.formulas.some((formula) => formula.label === "Equation 1"));
assert.ok(methodDigest.visuals.some((visual) => visual.label === "Table 1" && visual.type === "table"));
assert.ok(methodDigest.pitfalls.some((pitfall) => /formula symbols/i.test(pitfall)));
assert.match(methodDigest.fingerprint, /^[a-f0-9]{16}$/);

const digestPrompt = formatSectionDigestForPrompt(methodDigest);
assert.match(digestPrompt, /Section digest: 2 Method/);
assert.match(digestPrompt, /Key terms:/);
assert.match(digestPrompt, /Formulas:/);
assert.match(digestPrompt, /Figures\/tables\/code:/);

const draftPaper = JSON.parse(JSON.stringify(paper));
draftPaper.paragraphs[1].translation = "该方法计算共享缩放因子，并保持 E8M0 元数据对硬件友好。";
draftPaper.paragraphs[1].explanation = "这一段给出核心缩放公式，是方法章节的机制入口。";
const sectionDrafts = buildSectionDraftsForPaper(draftPaper, digests, plan, {
  generatedAt: "2026-06-05T00:00:00.000Z",
});
assert.equal(sectionDrafts.length, 2);
const methodDraft = sectionDrafts.find((draft) => draft.sectionId === "method");
assert.equal(methodDraft.version, 1);
assert.equal(methodDraft.draftOnly, true);
assert.equal(methodDraft.sectionDigestId, "method");
assert.deepEqual(methodDraft.paragraphIds, ["p-method-1", "p-method-2"]);
assert.match(methodDraft.translationDraft, /existing paragraph translations/i);
assert.match(methodDraft.explanationDraft, /Equation 1/);
assert.ok(methodDraft.formulas.some((formula) => formula.label === "Equation 1"));
assert.ok(methodDraft.visuals.some((visual) => visual.label === "Table 1"));
assert.match(methodDraft.fingerprint, /^[a-f0-9]{16}$/);

const draftPrompt = formatSectionDraftForPrompt(methodDraft);
assert.match(draftPrompt, /Context-only section draft: 2 Method/);
assert.match(draftPrompt, /never copy it as the final paragraph output/);
assert.match(draftPrompt, /Translation scaffold:/);
assert.match(draftPrompt, /Explanation scaffold:/);

const paperWithDrafts = JSON.parse(JSON.stringify(paper));
const attachedDrafts = attachSectionDraftsToPaper(paperWithDrafts, sectionDrafts, plan);
assert.equal(attachedDrafts.paragraphSectionDraftMap["p-method-2"], "method");
assert.equal(paperWithDrafts.paragraphs[2].sectionDraftId, "method");
assert.equal(findSectionDraftForParagraph(attachedDrafts.sectionDrafts, paperWithDrafts.paragraphs[1]).id, "method");
assert.match(attachedDrafts.fingerprint, /^[a-f0-9]{16}$/);

const paperWithDigests = JSON.parse(JSON.stringify(paper));
const attached = attachSectionDigestsToPaper(paperWithDigests, plan);
assert.equal(attached.paragraphSectionDigestMap["p-method-1"], "method");
assert.equal(paperWithDigests.paragraphs[1].sectionDigestId, "method");
assert.equal(findSectionDigestForParagraph(attached.sectionDigests, paperWithDigests.paragraphs[2]).id, "method");
assert.match(attached.fingerprint, /^[a-f0-9]{16}$/);

const changedPaper = JSON.parse(JSON.stringify(paper));
changedPaper.paragraphs[2].sectionId = "intro";
const changedDigest = buildSectionDigestsForPaper(changedPaper, plan).find((digest) => digest.sectionId === "method");
assert.notEqual(changedDigest.fingerprint, methodDigest.fingerprint);

const partial = normalizeDeepPaperPlan({}, {}, null, null);
assert.equal(partial.status, "missing");
assert.equal(partial.diagnostics.counts.sections, 0);
