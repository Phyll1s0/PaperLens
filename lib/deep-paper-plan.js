import { createHash } from "node:crypto";

export const DEEP_PAPER_PLAN_VERSION = 1;
export const SECTION_DIGEST_VERSION = 1;
export const SECTION_DRAFT_VERSION = 1;

const DEFAULT_WRITING_RULES = [
  "Translate each paragraph faithfully; do not summarize it away.",
  "Explain how the paragraph contributes to its section and the paper's main argument.",
  "Keep terminology consistent with the global terminology map.",
  "Mention relevant formulas, figures, tables, code, or resources when the source paragraph refers to them.",
  "Do not translate captions, headers, footers, authors, or references as body paragraphs unless explicitly restored.",
];

export function normalizeDeepPaperPlan(value = {}, paper = {}, structureMap = null, paperMemory = null, options = {}) {
  const data = normalizeObject(value);
  const warnings = [];
  const memory = normalizeObject(paperMemory || data.paperMemory);
  const normalizedStructure = normalizeObject(structureMap || data.structureMap);
  const paperTitle = truncateText(normalizeLine(
    data.paperTitle ||
      data.title ||
      data.document?.title ||
      memory.paperTitle ||
      normalizedStructure.paperTitle ||
      paper.title ||
      paper.filename ||
      "",
  ), 180);

  const sectionPlans = normalizeSectionPlans(data, paper, normalizedStructure, warnings);
  const terminology = normalizeTerminology(data.terminology || data.terms || data.keyTerms, memory, warnings);
  const formulaMap = normalizeFormulaMap(data.formulaMap || data.formulas || data.importantFormulas, memory);
  const visualMap = normalizeVisualMap(data.visualMap || data.visuals || data.importantVisuals, memory);
  const claimGraph = normalizeClaimGraph(data.claimGraph || data.claims || data.contributions, warnings);
  const writingRules = normalizeStringList(data.writingRules || data.rules || data.analysisRules);
  const generatedAt = options.generatedAt || data.generatedAt || new Date().toISOString();
  const source = normalizeLine(data.source || options.source || memory.source || "heuristic");

  const plan = {
    version: DEEP_PAPER_PLAN_VERSION,
    source,
    status: "",
    paperTitle,
    paperBrief: truncateText(normalizeLine(data.paperBrief || data.summary || data.paperSummary || memory.summary || ""), 900),
    mainThread: truncateText(normalizeLine(data.mainThread || data.methodStory || data.coreIdea || memory.mainThread || ""), 900),
    sectionPlans,
    terminology,
    claimGraph,
    formulaMap,
    visualMap,
    writingRules: (writingRules.length ? writingRules : DEFAULT_WRITING_RULES).slice(0, 16),
    fallbackReason: truncateText(normalizeLine(data.fallbackReason || options.fallbackReason || ""), 240),
    generatedAt,
    fingerprint: "",
    diagnostics: {
      warnings,
      counts: {
        sections: sectionPlans.length,
        terminology: terminology.length,
        claims: claimGraph.length,
        formulas: formulaMap.length,
        visuals: visualMap.length,
        writingRules: (writingRules.length ? writingRules : DEFAULT_WRITING_RULES).length,
      },
      tokenEstimate: estimateDeepPlanTokens({ sectionPlans, terminology, claimGraph, formulaMap, visualMap }),
    },
  };

  plan.status = getDeepPlanStatus(plan);
  plan.fingerprint = fingerprintDeepPlan(plan);
  return plan;
}

export function buildDeepPaperPlanFromPaperMemory(paper = {}, structureMap = null, paperMemory = null, options = {}) {
  const memory = normalizeObject(paperMemory || paper.paperMemory);
  return normalizeDeepPaperPlan({
    source: memory.source ? `paper-memory:${memory.source}` : "paper-memory",
    paperTitle: memory.paperTitle,
    paperBrief: memory.summary,
    mainThread: memory.mainThread,
    terminology: memory.keyTerms,
    formulaMap: memory.importantFormulas,
    visualMap: memory.importantVisuals,
    claimGraph: memory.contributions,
    writingRules: [
      ...DEFAULT_WRITING_RULES,
      ...normalizeStringList(memory.segmentationGuidance).slice(0, 4),
    ],
  }, paper, structureMap, memory, options);
}

export function formatDeepPaperPlanForPrompt(plan = null, options = {}) {
  if (!plan || plan.version !== DEEP_PAPER_PLAN_VERSION) {
    return "None.";
  }

  const limit = Math.max(800, Number(options.limit || 2600));
  const section = options.sectionId
    ? findSectionPlan(plan, options.sectionId)
    : options.sectionTitle
      ? findSectionPlanByTitle(plan, options.sectionTitle)
      : null;
  const lines = [
    plan.paperTitle ? `Paper title: ${plan.paperTitle}` : "",
    plan.paperBrief ? `Whole-paper brief: ${plan.paperBrief}` : "",
    plan.mainThread ? `Main thread: ${plan.mainThread}` : "",
    plan.terminology.length ? `Terminology: ${plan.terminology.slice(0, 18).map(formatTerminologyItem).join("; ")}` : "",
    plan.claimGraph.length ? `Claims: ${plan.claimGraph.slice(0, 8).map(formatClaimItem).join("; ")}` : "",
    plan.formulaMap.length ? `Formula map: ${plan.formulaMap.slice(0, 8).map(formatFormulaItem).join("; ")}` : "",
    plan.visualMap.length ? `Visual map: ${plan.visualMap.slice(0, 8).map(formatVisualItem).join("; ")}` : "",
    section ? `Current section plan: ${formatSectionPlan(section)}` : "",
    !section && plan.sectionPlans.length ? `Section plans: ${plan.sectionPlans.slice(0, 8).map(formatSectionPlan).join("; ")}` : "",
    plan.writingRules.length ? `Writing rules: ${plan.writingRules.slice(0, 8).join("; ")}` : "",
  ].filter(Boolean);

  return truncateText(lines.join("\n"), limit) || "None.";
}

export function findSectionPlan(plan = null, sectionId = "") {
  const id = normalizeLine(sectionId);
  if (!plan || !id || !Array.isArray(plan.sectionPlans)) {
    return null;
  }
  return plan.sectionPlans.find((section) => section.id === id) || null;
}

export function findSectionPlanByTitle(plan = null, title = "") {
  const clean = normalizeComparable(title);
  if (!plan || !clean || !Array.isArray(plan.sectionPlans)) {
    return null;
  }
  return plan.sectionPlans.find((section) => normalizeComparable(section.title) === clean) || null;
}

export function buildSectionDigestsForPaper(paper = {}, plan = null, options = {}) {
  const sections = collectDigestSections(paper, plan);
  const paragraphs = getDigestParagraphs(paper);
  const artifacts = getDigestArtifacts(paper);
  const digests = [];

  for (const [index, section] of sections.entries()) {
    const sectionParagraphs = getParagraphsForDigestSection(paragraphs, section);
    const relatedArtifactIds = collectSectionRelatedArtifactIds(sectionParagraphs, artifacts, section);
    const relatedArtifacts = relatedArtifactIds
      .map((id) => artifacts.find((artifact) => artifact.id === id))
      .filter(Boolean);
    const formulas = collectSectionFormulas(section, plan, relatedArtifacts);
    const visuals = collectSectionVisuals(section, plan, relatedArtifacts);
    const keyTerms = collectSectionTerms(section, plan, sectionParagraphs);
    const keySymbols = collectSectionSymbols(section, sectionParagraphs, formulas, keyTerms);
    const paragraphIds = sectionParagraphs.map(getParagraphDigestId).filter(Boolean);
    const startPage = section.startPage || getMinimumParagraphPage(sectionParagraphs);
    const endPage = section.endPage || getMaximumParagraphPage(sectionParagraphs);
    const digest = {
      version: SECTION_DIGEST_VERSION,
      id: section.id || `section-digest-${index + 1}`,
      sectionId: section.id || "",
      title: section.title || `Section ${index + 1}`,
      role: section.role || inferSectionDigestRole(section.title),
      summary: buildSectionDigestSummary(section, sectionParagraphs),
      startPage,
      endPage,
      paragraphIds,
      paragraphCount: paragraphIds.length,
      keyTerms,
      keySymbols,
      formulas,
      visuals,
      dependencies: normalizeStringList(section.dependencies).slice(0, 10),
      pitfalls: buildSectionDigestPitfalls(section, formulas, visuals, sectionParagraphs),
      mustMention: normalizeStringList(section.mustMention).slice(0, 12),
      relatedArtifactIds,
      source: normalizeLine(options.source || plan?.source || "heuristic"),
      planFingerprint: normalizeLine(plan?.fingerprint || ""),
      fingerprint: "",
    };
    digest.fingerprint = fingerprintSectionDigest(digest, sectionParagraphs);
    digests.push(digest);
  }

  return digests.slice(0, 96);
}

export function attachSectionDigestsToPaper(paper = {}, sectionDigestsOrPlan = null, options = {}) {
  const sectionDigests = Array.isArray(sectionDigestsOrPlan)
    ? sectionDigestsOrPlan
    : buildSectionDigestsForPaper(paper, sectionDigestsOrPlan, options);
  const paragraphSectionDigestMap = {};

  if (options.mutate !== false) {
    paper.sectionDigests = sectionDigests;
  }

  for (const paragraph of getDigestParagraphs(paper)) {
    const digest = findSectionDigestForParagraph(sectionDigests, paragraph);
    const paragraphId = getParagraphDigestId(paragraph);
    if (!digest || !paragraphId) {
      continue;
    }
    paragraphSectionDigestMap[paragraphId] = digest.id;
    if (options.mutate !== false) {
      paragraph.sectionDigestId = digest.id;
    }
  }

  return {
    sectionDigests,
    paragraphSectionDigestMap,
    fingerprint: fingerprintSectionDigestSet(sectionDigests),
  };
}

export function findSectionDigest(sectionDigests = [], sectionId = "") {
  const clean = normalizeLine(sectionId);
  if (!clean || !Array.isArray(sectionDigests)) {
    return null;
  }
  return sectionDigests.find((digest) => digest.id === clean || digest.sectionId === clean) || null;
}

export function findSectionDigestForParagraph(sectionDigests = [], paragraph = {}) {
  if (!Array.isArray(sectionDigests) || !sectionDigests.length || !paragraph) {
    return null;
  }
  const existing = findSectionDigest(sectionDigests, paragraph.sectionDigestId);
  if (existing) {
    return existing;
  }
  const paragraphId = getParagraphDigestId(paragraph);
  const sectionId = normalizeLine(paragraph.sectionId || paragraph.plannedSectionId || "");
  const byParagraphId = paragraphId
    ? sectionDigests.find((digest) => Array.isArray(digest.paragraphIds) && digest.paragraphIds.includes(paragraphId))
    : null;
  if (byParagraphId) {
    return byParagraphId;
  }
  if (sectionId) {
    const bySection = sectionDigests.find((digest) => digest.sectionId === sectionId || digest.id === sectionId);
    if (bySection) {
      return bySection;
    }
  }
  const page = normalizePage(paragraph.pageNumber);
  if (!page) {
    return null;
  }
  return sectionDigests.find((digest) => pageOverlapsRange(
    page,
    normalizePage(paragraph.pageEndNumber) || page,
    digest.startPage,
    digest.endPage,
  )) || null;
}

export function formatSectionDigestForPrompt(digest = null, options = {}) {
  if (!digest || digest.version !== SECTION_DIGEST_VERSION) {
    return "None.";
  }
  const limit = Math.max(500, Number(options.limit || 1800));
  const lines = [
    `Section digest: ${digest.title}`,
    digest.role ? `Role: ${digest.role}` : "",
    digest.summary ? `Local summary: ${digest.summary}` : "",
    digest.keyTerms?.length ? `Key terms: ${digest.keyTerms.slice(0, 12).map(formatDigestTerm).join("; ")}` : "",
    digest.keySymbols?.length ? `Key symbols: ${digest.keySymbols.slice(0, 16).join(", ")}` : "",
    digest.formulas?.length ? `Formulas: ${digest.formulas.slice(0, 8).map(formatDigestReference).join("; ")}` : "",
    digest.visuals?.length ? `Figures/tables/code: ${digest.visuals.slice(0, 8).map(formatDigestReference).join("; ")}` : "",
    digest.dependencies?.length ? `Depends on: ${digest.dependencies.slice(0, 8).join("; ")}` : "",
    digest.pitfalls?.length ? `Reader pitfalls: ${digest.pitfalls.slice(0, 8).join("; ")}` : "",
    digest.mustMention?.length ? `Must mention: ${digest.mustMention.slice(0, 8).join("; ")}` : "",
    digest.paragraphCount ? `Paragraphs: ${digest.paragraphCount}` : "",
  ].filter(Boolean);
  return truncateText(lines.join("\n"), limit) || "None.";
}

export function buildSectionDraftsForPaper(paper = {}, sectionDigestsOrPlan = null, plan = null, options = {}) {
  const sectionDigests = Array.isArray(sectionDigestsOrPlan)
    ? sectionDigestsOrPlan
    : buildSectionDigestsForPaper(paper, sectionDigestsOrPlan || plan, options);
  const paperPlan = Array.isArray(sectionDigestsOrPlan) ? plan : (sectionDigestsOrPlan || plan);
  const paragraphs = getDigestParagraphs(paper);

  return sectionDigests
    .map((digest, index) => buildSectionDraftFromDigest(paper, digest, paperPlan, paragraphs, index, options))
    .filter(Boolean)
    .slice(0, 96);
}

export function attachSectionDraftsToPaper(paper = {}, sectionDraftsOrDigests = null, plan = null, options = {}) {
  const sectionDrafts = isSectionDraftList(sectionDraftsOrDigests)
    ? sectionDraftsOrDigests
    : buildSectionDraftsForPaper(paper, sectionDraftsOrDigests, plan, options);
  const paragraphSectionDraftMap = {};

  if (options.mutate !== false) {
    paper.sectionDrafts = sectionDrafts;
  }

  for (const paragraph of getDigestParagraphs(paper)) {
    const draft = findSectionDraftForParagraph(sectionDrafts, paragraph);
    const paragraphId = getParagraphDigestId(paragraph);
    if (!draft || !paragraphId) {
      continue;
    }
    paragraphSectionDraftMap[paragraphId] = draft.id;
    if (options.mutate !== false) {
      paragraph.sectionDraftId = draft.id;
    }
  }

  return {
    sectionDrafts,
    paragraphSectionDraftMap,
    fingerprint: fingerprintSectionDraftSet(sectionDrafts),
  };
}

export function findSectionDraft(sectionDrafts = [], sectionId = "") {
  const clean = normalizeLine(sectionId);
  if (!clean || !Array.isArray(sectionDrafts)) {
    return null;
  }
  return sectionDrafts.find((draft) => (
    draft.id === clean ||
    draft.sectionId === clean ||
    draft.sectionDigestId === clean
  )) || null;
}

export function findSectionDraftForParagraph(sectionDrafts = [], paragraph = {}) {
  if (!Array.isArray(sectionDrafts) || !sectionDrafts.length || !paragraph) {
    return null;
  }
  const existing = findSectionDraft(sectionDrafts, paragraph.sectionDraftId);
  if (existing) {
    return existing;
  }

  const paragraphId = getParagraphDigestId(paragraph);
  const byParagraphId = paragraphId
    ? sectionDrafts.find((draft) => Array.isArray(draft.paragraphIds) && draft.paragraphIds.includes(paragraphId))
    : null;
  if (byParagraphId) {
    return byParagraphId;
  }

  const sectionIds = [
    paragraph.sectionDigestId,
    paragraph.sectionId,
    paragraph.plannedSectionId,
  ].map(normalizeLine).filter(Boolean);
  for (const sectionId of sectionIds) {
    const bySection = sectionDrafts.find((draft) => (
      draft.sectionDigestId === sectionId ||
      draft.sectionId === sectionId ||
      draft.id === sectionId
    ));
    if (bySection) {
      return bySection;
    }
  }

  const page = normalizePage(paragraph.pageNumber);
  if (!page) {
    return null;
  }
  return sectionDrafts.find((draft) => pageOverlapsRange(
    page,
    normalizePage(paragraph.pageEndNumber) || page,
    draft.startPage,
    draft.endPage,
  )) || null;
}

export function formatSectionDraftForPrompt(draft = null, options = {}) {
  if (!draft || draft.version !== SECTION_DRAFT_VERSION) {
    return "None.";
  }
  const limit = Math.max(500, Number(options.limit || 1600));
  const pageSpan = draft.endPage && draft.endPage !== draft.startPage
    ? `p.${draft.startPage}-${draft.endPage}`
    : draft.startPage
      ? `p.${draft.startPage}`
      : "";
  const lines = [
    `Context-only section draft: ${draft.title}`,
    "Use this only for terminology, ordering, and section intent; never copy it as the final paragraph output.",
    draft.role ? `Role: ${draft.role}` : "",
    pageSpan ? `Pages: ${pageSpan}` : "",
    draft.translationDraft ? `Translation scaffold: ${draft.translationDraft}` : "",
    draft.explanationDraft ? `Explanation scaffold: ${draft.explanationDraft}` : "",
    draft.keyTerms?.length ? `Terms: ${draft.keyTerms.slice(0, 12).map(formatDigestTerm).join("; ")}` : "",
    draft.formulas?.length ? `Formulas: ${draft.formulas.slice(0, 8).map(formatDigestReference).join("; ")}` : "",
    draft.visuals?.length ? `Visual evidence: ${draft.visuals.slice(0, 8).map(formatDigestReference).join("; ")}` : "",
    draft.caveats?.length ? `Caveats: ${draft.caveats.slice(0, 8).join("; ")}` : "",
    draft.paragraphCount ? `Paragraphs covered: ${draft.paragraphCount}` : "",
  ].filter(Boolean);
  return truncateText(lines.join("\n"), limit) || "None.";
}

function buildSectionDraftFromDigest(paper, digest, plan, paragraphs, index, options = {}) {
  if (!digest || digest.version !== SECTION_DIGEST_VERSION) {
    return null;
  }
  const sectionParagraphs = getParagraphsForDraftSection(paragraphs, digest);
  const analyzedParagraphs = sectionParagraphs.filter((paragraph) => (
    normalizeLine(paragraph.translation || "") ||
    normalizeLine(paragraph.explanation || "")
  ));
  const draft = {
    version: SECTION_DRAFT_VERSION,
    id: digest.id || `section-draft-${index + 1}`,
    sectionId: digest.sectionId || "",
    sectionDigestId: digest.id || "",
    title: digest.title || `Section ${index + 1}`,
    role: digest.role || "",
    startPage: digest.startPage || getMinimumParagraphPage(sectionParagraphs),
    endPage: digest.endPage || getMaximumParagraphPage(sectionParagraphs),
    paragraphIds: normalizeStringList(digest.paragraphIds).length
      ? normalizeStringList(digest.paragraphIds)
      : sectionParagraphs.map(getParagraphDigestId).filter(Boolean),
    paragraphCount: sectionParagraphs.length || Number(digest.paragraphCount || 0),
    translationDraft: buildSectionTranslationDraft(digest, sectionParagraphs, analyzedParagraphs),
    explanationDraft: buildSectionExplanationDraft(digest, sectionParagraphs, analyzedParagraphs),
    keyTerms: (Array.isArray(digest.keyTerms) ? digest.keyTerms : []).slice(0, 18),
    keySymbols: normalizeStringList(digest.keySymbols).slice(0, 24),
    formulas: (Array.isArray(digest.formulas) ? digest.formulas : []).slice(0, 16),
    visuals: (Array.isArray(digest.visuals) ? digest.visuals : []).slice(0, 18),
    caveats: buildSectionDraftCaveats(digest, sectionParagraphs),
    source: normalizeLine(options.source || "section-digest"),
    draftOnly: true,
    planFingerprint: normalizeLine(plan?.fingerprint || digest.planFingerprint || ""),
    sectionDigestFingerprint: normalizeLine(digest.fingerprint || ""),
    generatedAt: options.generatedAt || new Date().toISOString(),
    fingerprint: "",
  };
  draft.fingerprint = fingerprintSectionDraft(draft, sectionParagraphs);
  return draft;
}

function getParagraphsForDraftSection(paragraphs, digest) {
  const explicitIds = new Set(normalizeStringList(digest.paragraphIds));
  const byExplicitId = explicitIds.size
    ? paragraphs.filter((paragraph) => explicitIds.has(getParagraphDigestId(paragraph)))
    : [];
  if (byExplicitId.length) {
    return byExplicitId;
  }

  return paragraphs.filter((paragraph) => {
    const sectionId = normalizeLine(paragraph.sectionDigestId || paragraph.sectionId || paragraph.plannedSectionId || "");
    if (sectionId && (sectionId === digest.id || sectionId === digest.sectionId)) {
      return true;
    }
    const start = normalizePage(paragraph.pageNumber);
    const end = normalizePage(paragraph.pageEndNumber) || start;
    return pageOverlapsRange(start, end, digest.startPage, digest.endPage || digest.startPage);
  });
}

function buildSectionTranslationDraft(digest, sectionParagraphs, analyzedParagraphs) {
  const existingTranslations = analyzedParagraphs
    .map((paragraph) => normalizeLine(paragraph.translation || ""))
    .filter(Boolean)
    .slice(0, 3);
  if (existingTranslations.length) {
    return truncateText(`Context-only synthesis from existing paragraph translations: ${existingTranslations.join(" ")}`, 900);
  }

  const terms = (Array.isArray(digest.keyTerms) ? digest.keyTerms : [])
    .map((term) => term.source || term.term || term.text || "")
    .filter(Boolean)
    .slice(0, 8)
    .join(", ");
  const formulas = (Array.isArray(digest.formulas) ? digest.formulas : [])
    .map((formula) => formula.label || formula.text || "")
    .filter(Boolean)
    .slice(0, 4)
    .join(", ");
  const lines = [
    digest.summary ? `Translate this section around: ${digest.summary}` : `Translate ${digest.title || "this section"} paragraph by paragraph.`,
    terms ? `Preserve and translate terms consistently: ${terms}.` : "",
    formulas ? `Keep formula references and symbols intact: ${formulas}.` : "",
  ].filter(Boolean);
  return truncateText(lines.join(" "), 900);
}

function buildSectionExplanationDraft(digest, sectionParagraphs, analyzedParagraphs) {
  const existingExplanations = analyzedParagraphs
    .map((paragraph) => normalizeLine(paragraph.explanation || ""))
    .filter(Boolean)
    .slice(0, 3);
  const lines = [
    digest.role ? `Section role: ${digest.role}` : "",
    digest.summary ? `Local summary: ${digest.summary}` : "",
    existingExplanations.length ? `Existing explanation anchors: ${existingExplanations.join(" ")}` : "",
    digest.formulas?.length ? `Explain formulas as section evidence: ${digest.formulas.slice(0, 5).map(formatDigestReference).join("; ")}` : "",
    digest.visuals?.length ? `Use visual evidence without treating captions as body paragraphs: ${digest.visuals.slice(0, 5).map(formatDigestReference).join("; ")}` : "",
    digest.mustMention?.length ? `Must cover: ${digest.mustMention.slice(0, 6).join("; ")}` : "",
  ].filter(Boolean);
  if (!lines.length && sectionParagraphs.length) {
    lines.push(`Explain how ${sectionParagraphs.length} paragraphs connect inside ${digest.title || "this section"}.`);
  }
  return truncateText(lines.join(" "), 1000);
}

function buildSectionDraftCaveats(digest, sectionParagraphs) {
  const caveats = [
    "Draft is context only; final output must stay paragraph-aligned.",
    ...normalizeStringList(digest.pitfalls),
  ];
  if (sectionParagraphs.some((paragraph) => normalizePage(paragraph.pageEndNumber) > normalizePage(paragraph.pageNumber))) {
    caveats.push("Some paragraphs span pages; preserve continuation logic.");
  }
  if ((Array.isArray(digest.visuals) ? digest.visuals : []).length) {
    caveats.push("Do not translate visual captions as body paragraphs unless the paragraph itself cites them.");
  }
  return normalizeStringList(caveats).slice(0, 10);
}

function isSectionDraftList(value) {
  return Array.isArray(value) && value.some((item) => (
    item?.version === SECTION_DRAFT_VERSION ||
    item?.draftOnly === true ||
    normalizeLine(item?.translationDraft || item?.explanationDraft || "")
  ));
}

function normalizeSectionPlans(data, paper, structureMap, warnings) {
  const raw = firstArray(
    data.sectionPlans,
    data.sections,
    data.sectionDigests,
    data.document?.sections,
    structureMap?.segmentationPlan,
    structureMap?.sections,
    paper?.sections,
  );
  const seen = new Set();
  const sections = [];
  for (const [index, item] of raw.entries()) {
    const title = normalizeLine(item?.title || item?.sectionTitle || item?.heading || item?.name || "");
    if (!title) {
      warnings.push("Dropped section plan without title.");
      continue;
    }
    const id = uniqueId(item?.id || item?.sectionId || slugify(title) || `section-${index + 1}`, seen);
    sections.push({
      id,
      title: truncateText(title, 180),
      level: clampInteger(item?.level, inferSectionLevel(title), 1, 6),
      startPage: normalizePage(item?.startPage || item?.pageNumber || item?.page),
      endPage: normalizePage(item?.endPage || item?.pageEndNumber),
      role: truncateText(normalizeLine(item?.role || item?.purpose || ""), 260),
      summary: truncateText(normalizeLine(item?.summary || item?.digest || item?.description || ""), 360),
      mustMention: normalizeStringList(item?.mustMention || item?.mustCover || item?.keyPoints).slice(0, 12),
      terms: normalizeStringList(item?.terms || item?.keyTerms || item?.keywords).slice(0, 18),
      formulas: normalizeReferenceList(item?.formulas || item?.formulaRefs || item?.equations).slice(0, 12),
      visuals: normalizeReferenceList(item?.visuals || item?.figures || item?.tables || item?.visualRefs).slice(0, 12),
      pitfalls: normalizeStringList(item?.pitfalls || item?.readerPitfalls || item?.warnings).slice(0, 8),
      dependencies: normalizeStringList(item?.dependencies || item?.dependsOn || item?.prerequisites).slice(0, 8),
      paragraphIds: normalizeStringList(item?.paragraphIds || item?.paragraphs).slice(0, 160),
      confidence: normalizeConfidence(item?.confidence),
    });
  }
  return sections.slice(0, 96);
}

function normalizeTerminology(value, memory, warnings) {
  const raw = Array.isArray(value) && value.length ? value : normalizeStringList(memory.keyTerms);
  const seen = new Set();
  const items = [];
  for (const entry of raw || []) {
    const data = typeof entry === "string" ? { source: entry } : normalizeObject(entry);
    const source = normalizeLine(data.source || data.term || data.en || data.name || data.text || "");
    if (!source) {
      warnings.push("Dropped terminology item without source term.");
      continue;
    }
    const key = normalizeComparable(source);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    items.push({
      source: truncateText(source, 120),
      zh: truncateText(normalizeLine(data.zh || data.translation || data.chinese || ""), 120),
      note: truncateText(normalizeLine(data.note || data.definition || data.meaning || ""), 220),
      aliases: normalizeStringList(data.aliases || data.synonyms).slice(0, 8),
      confidence: normalizeConfidence(data.confidence),
    });
  }
  return items.slice(0, 80);
}

function normalizeClaimGraph(value, warnings) {
  const raw = Array.isArray(value) ? value : normalizeStringList(value);
  const items = [];
  const seen = new Set();
  for (const entry of raw || []) {
    const data = typeof entry === "string" ? { claim: entry } : normalizeObject(entry);
    const claim = normalizeLine(data.claim || data.text || data.contribution || data.summary || "");
    if (!claim) {
      warnings.push("Dropped claim item without claim text.");
      continue;
    }
    const key = normalizeComparable(claim);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    items.push({
      claim: truncateText(claim, 260),
      evidence: normalizeReferenceList(data.evidence || data.support || data.supportingEvidence).slice(0, 12),
      pages: normalizePageList(data.pages || data.pageNumbers || data.pageNumber).slice(0, 12),
      sectionIds: normalizeStringList(data.sectionIds || data.sections).slice(0, 8),
      confidence: normalizeConfidence(data.confidence),
    });
  }
  return items.slice(0, 40);
}

function normalizeFormulaMap(value, memory) {
  const raw = Array.isArray(value) && value.length ? value : memory.importantFormulas || [];
  const seen = new Set();
  const items = [];
  for (const entry of raw || []) {
    const data = typeof entry === "string" ? { text: entry } : normalizeObject(entry);
    const label = normalizeLine(data.label || data.name || "");
    const text = normalizeLine(data.text || data.formula || data.latex || "");
    const key = normalizeComparable(label || text);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    items.push({
      label: truncateText(label, 80),
      pageNumber: normalizePage(data.pageNumber || data.page),
      text: truncateText(text, 260),
      meaning: truncateText(normalizeLine(data.meaning || data.purpose || data.description || ""), 260),
      usedBy: normalizeStringList(data.usedBy || data.sectionIds || data.sections).slice(0, 12),
      confidence: normalizeConfidence(data.confidence),
    });
  }
  return items.slice(0, 48);
}

function normalizeVisualMap(value, memory) {
  const raw = Array.isArray(value) && value.length ? value : memory.importantVisuals || [];
  const seen = new Set();
  const items = [];
  for (const entry of raw || []) {
    const data = typeof entry === "string" ? { label: entry } : normalizeObject(entry);
    const label = normalizeLine(data.label || data.name || "");
    const description = normalizeLine(data.description || data.meaning || data.text || "");
    const key = normalizeComparable(label || description);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    items.push({
      label: truncateText(label, 90),
      type: normalizeLine(data.type || data.visualType || "visual"),
      pageNumber: normalizePage(data.pageNumber || data.page),
      meaning: truncateText(description, 280),
      usedBy: normalizeStringList(data.usedBy || data.sectionIds || data.sections).slice(0, 12),
      confidence: normalizeConfidence(data.confidence),
    });
  }
  return items.slice(0, 48);
}

function collectDigestSections(paper, plan) {
  const sections = [];
  const addSection = (item, index) => {
    const section = normalizeDigestSection(item, index);
    if (!section.title && !section.id) {
      return;
    }
    const existing = sections.find((candidate) => (
      (section.id && candidate.id === section.id) ||
      (section.title && normalizeComparable(candidate.title) === normalizeComparable(section.title))
    ));
    if (existing) {
      mergeDigestSection(existing, section);
      return;
    }
    sections.push(section);
  };

  for (const [index, section] of (Array.isArray(plan?.sectionPlans) ? plan.sectionPlans : []).entries()) {
    addSection(section, index);
  }
  for (const [index, section] of (Array.isArray(paper?.sections) ? paper.sections : []).entries()) {
    addSection(section, sections.length + index);
  }

  if (!sections.length) {
    const seen = new Set();
    for (const paragraph of getDigestParagraphs(paper)) {
      const sectionId = normalizeLine(paragraph.sectionId || paragraph.plannedSectionId || "");
      const title = normalizeLine(paragraph.sectionTitle || paragraph.sectionTitleHint || sectionId || "Paper body");
      const key = sectionId || normalizeComparable(title);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      addSection({
        id: sectionId || slugify(title) || `section-${seen.size}`,
        title,
        startPage: paragraph.pageNumber,
        endPage: paragraph.pageEndNumber || paragraph.pageNumber,
      }, seen.size - 1);
    }
  }

  if (!sections.length) {
    sections.push(normalizeDigestSection({
      id: "paper-body",
      title: "Paper body",
    }, 0));
  }

  return sections.slice(0, 96);
}

function normalizeDigestSection(item, index) {
  const data = normalizeObject(item);
  const title = truncateText(normalizeLine(data.title || data.sectionTitle || data.heading || data.name || ""), 180);
  return {
    id: normalizeLine(data.id || data.sectionId || data.plannedSectionId || slugify(title) || `section-${index + 1}`),
    title,
    level: clampInteger(data.level, inferSectionLevel(title), 1, 6),
    startPage: normalizePage(data.startPage || data.pageNumber || data.page),
    endPage: normalizePage(data.endPage || data.pageEndNumber),
    role: truncateText(normalizeLine(data.role || data.purpose || ""), 260),
    summary: truncateText(normalizeLine(data.summary || data.digest || data.description || ""), 520),
    mustMention: normalizeStringList(data.mustMention || data.mustCover || data.keyPoints).slice(0, 12),
    terms: normalizeStringList(data.terms || data.keyTerms || data.keywords).slice(0, 18),
    formulas: normalizeReferenceList(data.formulas || data.formulaRefs || data.equations).slice(0, 12),
    visuals: normalizeReferenceList(data.visuals || data.figures || data.tables || data.visualRefs).slice(0, 12),
    pitfalls: normalizeStringList(data.pitfalls || data.readerPitfalls || data.warnings).slice(0, 8),
    dependencies: normalizeStringList(data.dependencies || data.dependsOn || data.prerequisites).slice(0, 8),
    paragraphIds: normalizeStringList(data.paragraphIds || data.paragraphs).slice(0, 180),
  };
}

function mergeDigestSection(target, source) {
  target.title ||= source.title;
  target.level ||= source.level;
  target.startPage ||= source.startPage;
  target.endPage ||= source.endPage;
  target.role ||= source.role;
  target.summary ||= source.summary;
  target.mustMention = mergeStringLists(target.mustMention, source.mustMention).slice(0, 12);
  target.terms = mergeStringLists(target.terms, source.terms).slice(0, 18);
  target.formulas = mergeStringLists(target.formulas, source.formulas).slice(0, 12);
  target.visuals = mergeStringLists(target.visuals, source.visuals).slice(0, 12);
  target.pitfalls = mergeStringLists(target.pitfalls, source.pitfalls).slice(0, 8);
  target.dependencies = mergeStringLists(target.dependencies, source.dependencies).slice(0, 8);
  target.paragraphIds = mergeStringLists(target.paragraphIds, source.paragraphIds).slice(0, 180);
}

function getDigestParagraphs(paper) {
  return (Array.isArray(paper?.paragraphs) ? paper.paragraphs : [])
    .filter((paragraph) => paragraph && !paragraph.hidden && paragraph.kind !== "heading")
    .filter((paragraph) => normalizeLine(paragraph.sourceText || paragraph.text || ""))
    .sort(compareDigestParagraphs);
}

function getDigestArtifacts(paper) {
  return (Array.isArray(paper?.pageArtifacts) ? paper.pageArtifacts : [])
    .filter((artifact) => artifact && !artifact.hidden && normalizeLine(artifact.id || artifact.label || artifact.type || ""));
}

function getParagraphsForDigestSection(paragraphs, section) {
  const explicitIds = new Set(normalizeStringList(section.paragraphIds));
  const byExplicitId = explicitIds.size
    ? paragraphs.filter((paragraph) => explicitIds.has(getParagraphDigestId(paragraph)))
    : [];
  if (byExplicitId.length) {
    return byExplicitId;
  }

  const bySectionId = paragraphs.filter((paragraph) => paragraphMatchesDigestSection(paragraph, section));
  if (bySectionId.length) {
    return bySectionId;
  }

  const byPage = paragraphs.filter((paragraph) => pageOverlapsRange(
    normalizePage(paragraph.pageNumber),
    normalizePage(paragraph.pageEndNumber) || normalizePage(paragraph.pageNumber),
    section.startPage,
    section.endPage || section.startPage,
  ));
  return byPage;
}

function paragraphMatchesDigestSection(paragraph, section) {
  const sectionId = normalizeLine(paragraph.sectionId || paragraph.plannedSectionId || "");
  if (sectionId && (sectionId === section.id || sectionId === section.sectionId)) {
    return true;
  }
  const paragraphTitle = normalizeComparable(
    paragraph.sectionTitle ||
    paragraph.sectionTitleHint ||
    paragraph.plannedSectionTitle ||
    "",
  );
  return Boolean(paragraphTitle && paragraphTitle === normalizeComparable(section.title));
}

function collectSectionRelatedArtifactIds(sectionParagraphs, artifacts, section) {
  const ids = new Set();
  const startPage = section.startPage || getMinimumParagraphPage(sectionParagraphs);
  const endPage = section.endPage || getMaximumParagraphPage(sectionParagraphs) || startPage;
  const paragraphText = normalizeComparable(sectionParagraphs.map((paragraph) => paragraph.sourceText || paragraph.text || "").join(" "));

  for (const paragraph of sectionParagraphs) {
    for (const id of normalizeStringList(paragraph.relatedArtifactIds)) {
      ids.add(id);
    }
  }

  for (const artifact of artifacts) {
    if (!artifact.id || ids.has(artifact.id)) {
      continue;
    }
    const artifactPage = normalizePage(artifact.pageNumber || artifact.page);
    const label = normalizeComparable(artifact.label || artifact.text || artifact.type || "");
    const artifactInRange = pageOverlapsRange(artifactPage, artifactPage, startPage, endPage);
    if (artifactInRange && (isDigestArtifact(artifact) || (label && paragraphText.includes(label)))) {
      ids.add(artifact.id);
    }
  }

  return Array.from(ids).slice(0, 32);
}

function collectSectionFormulas(section, plan, relatedArtifacts) {
  const refs = [];
  for (const label of normalizeStringList(section.formulas)) {
    refs.push({ label, text: "", meaning: "", pageNumber: null, source: "section-plan" });
  }
  for (const formula of Array.isArray(plan?.formulaMap) ? plan.formulaMap : []) {
    if (referenceMatchesDigestSection(formula, section)) {
      refs.push({
        label: normalizeLine(formula.label || formula.text || "Formula"),
        text: truncateText(formula.text || "", 260),
        meaning: truncateText(formula.meaning || "", 260),
        pageNumber: normalizePage(formula.pageNumber),
        source: "deep-plan",
      });
    }
  }
  for (const artifact of relatedArtifacts) {
    if (!isFormulaArtifact(artifact)) {
      continue;
    }
    refs.push({
      id: normalizeLine(artifact.id),
      label: truncateText(normalizeLine(artifact.label || "Formula"), 90),
      text: truncateText(normalizeLine(artifact.text || artifact.sourceText || artifact.formulaText || ""), 260),
      meaning: "",
      pageNumber: normalizePage(artifact.pageNumber || artifact.page),
      source: "visual-artifact",
    });
  }
  return dedupeDigestReferences(refs).slice(0, 16);
}

function collectSectionVisuals(section, plan, relatedArtifacts) {
  const refs = [];
  for (const label of normalizeStringList(section.visuals)) {
    refs.push({ label, type: inferVisualTypeFromLabel(label), meaning: "", pageNumber: null, source: "section-plan" });
  }
  for (const visual of Array.isArray(plan?.visualMap) ? plan.visualMap : []) {
    if (referenceMatchesDigestSection(visual, section)) {
      refs.push({
        label: normalizeLine(visual.label || visual.type || "Visual"),
        type: normalizeLine(visual.type || "visual"),
        meaning: truncateText(visual.meaning || "", 280),
        pageNumber: normalizePage(visual.pageNumber),
        source: "deep-plan",
      });
    }
  }
  for (const artifact of relatedArtifacts) {
    if (isFormulaArtifact(artifact)) {
      continue;
    }
    refs.push({
      id: normalizeLine(artifact.id),
      label: truncateText(normalizeLine(artifact.label || artifact.visualType || artifact.type || "Visual"), 90),
      type: normalizeLine(artifact.visualType || artifact.type || "visual"),
      meaning: truncateText(normalizeLine(artifact.text || artifact.sourceText || artifact.caption || ""), 280),
      pageNumber: normalizePage(artifact.pageNumber || artifact.page),
      source: "visual-artifact",
    });
  }
  return dedupeDigestReferences(refs).slice(0, 18);
}

function collectSectionTerms(section, plan, sectionParagraphs) {
  const sectionText = normalizeComparable([
    section.title,
    section.role,
    section.summary,
    sectionParagraphs.map((paragraph) => paragraph.sourceText || paragraph.text || "").join(" "),
  ].join(" "));
  const refs = [];
  const pushTerm = (term) => {
    const source = truncateText(normalizeLine(term.source || term.term || term.text || term), 120);
    if (!source) {
      return;
    }
    refs.push({
      source,
      zh: truncateText(normalizeLine(term.zh || term.translation || ""), 120),
      note: truncateText(normalizeLine(term.note || term.definition || ""), 220),
      aliases: normalizeStringList(term.aliases || term.synonyms).slice(0, 8),
    });
  };

  for (const source of normalizeStringList(section.terms)) {
    const matching = (Array.isArray(plan?.terminology) ? plan.terminology : [])
      .find((item) => normalizeComparable(item.source) === normalizeComparable(source));
    pushTerm(matching || { source });
  }

  for (const term of Array.isArray(plan?.terminology) ? plan.terminology : []) {
    const needles = [term.source, ...(Array.isArray(term.aliases) ? term.aliases : [])]
      .map(normalizeComparable)
      .filter((value) => value.length >= 2);
    if (needles.some((needle) => sectionText.includes(needle))) {
      pushTerm(term);
    }
  }

  return dedupeDigestTerms(refs).slice(0, 18);
}

function collectSectionSymbols(section, sectionParagraphs, formulas, keyTerms) {
  const text = [
    section.title,
    section.role,
    section.summary,
    normalizeStringList(section.terms).join(" "),
    sectionParagraphs.map((paragraph) => paragraph.sourceText || paragraph.text || "").join(" "),
    formulas.map((formula) => `${formula.label || ""} ${formula.text || ""}`).join(" "),
    keyTerms.map((term) => term.source).join(" "),
  ].join(" ");
  return extractKeySymbols(text).slice(0, 24);
}

function buildSectionDigestSummary(section, sectionParagraphs) {
  if (section.summary) {
    return section.summary;
  }
  const preview = sectionParagraphs
    .map((paragraph) => normalizeLine(paragraph.sourceText || paragraph.text || ""))
    .filter((text) => text.length >= 40)
    .slice(0, 2)
    .join(" ");
  return truncateText(preview, 520);
}

function buildSectionDigestPitfalls(section, formulas, visuals, sectionParagraphs) {
  const pitfalls = normalizeStringList(section.pitfalls);
  if (formulas.length) {
    pitfalls.push("Explain formula symbols before using the derived result.");
  }
  if (visuals.some((visual) => ["figure", "table", "code"].includes(normalizeComparable(visual.type)))) {
    pitfalls.push("Use figures, tables, and code artifacts as evidence, not as body paragraphs.");
  }
  if (sectionParagraphs.some((paragraph) => normalizePage(paragraph.pageEndNumber) > normalizePage(paragraph.pageNumber))) {
    pitfalls.push("Check cross-page continuation before judging paragraph boundaries.");
  }
  return normalizeStringList(pitfalls).slice(0, 10);
}

function referenceMatchesDigestSection(reference, section) {
  const usedBy = normalizeStringList(reference.usedBy || reference.sectionIds || reference.sections)
    .map(normalizeComparable);
  const sectionKeys = [section.id, section.sectionId, section.title].map(normalizeComparable).filter(Boolean);
  if (usedBy.some((value) => sectionKeys.includes(value))) {
    return true;
  }
  const pageNumber = normalizePage(reference.pageNumber || reference.page);
  return pageOverlapsRange(pageNumber, pageNumber, section.startPage, section.endPage || section.startPage);
}

function dedupeDigestReferences(refs) {
  const seen = new Set();
  const result = [];
  for (const ref of refs) {
    const key = normalizeComparable(ref.id || ref.label || ref.text || ref.meaning || ref.type || "");
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(ref);
  }
  return result;
}

function dedupeDigestTerms(terms) {
  const seen = new Set();
  const result = [];
  for (const term of terms) {
    const key = normalizeComparable(term.source || "");
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(term);
  }
  return result;
}

function fingerprintSectionDigest(digest, sectionParagraphs) {
  return createHash("sha1")
    .update(stableStringify({
      digest: {
        ...digest,
        fingerprint: "",
      },
      paragraphs: sectionParagraphs.map((paragraph) => ({
        id: getParagraphDigestId(paragraph),
        sectionId: normalizeLine(paragraph.sectionId || paragraph.plannedSectionId || ""),
        pageNumber: normalizePage(paragraph.pageNumber),
        pageEndNumber: normalizePage(paragraph.pageEndNumber),
        sourceText: truncateText(paragraph.sourceText || paragraph.text || "", 1400),
        relatedArtifactIds: normalizeStringList(paragraph.relatedArtifactIds).slice(0, 16),
      })),
    }))
    .digest("hex")
    .slice(0, 16);
}

function fingerprintSectionDigestSet(sectionDigests) {
  return createHash("sha1")
    .update(stableStringify((Array.isArray(sectionDigests) ? sectionDigests : []).map((digest) => ({
      id: digest.id,
      fingerprint: digest.fingerprint,
    }))))
    .digest("hex")
    .slice(0, 16);
}

function fingerprintSectionDraft(draft, sectionParagraphs) {
  return createHash("sha1")
    .update(stableStringify({
      draft: {
        ...draft,
        generatedAt: "",
        fingerprint: "",
      },
      paragraphs: sectionParagraphs.map((paragraph) => ({
        id: getParagraphDigestId(paragraph),
        translation: truncateText(paragraph.translation || "", 500),
        explanation: truncateText(paragraph.explanation || "", 500),
        analysisStatus: normalizeLine(paragraph.analysisStatus || ""),
      })),
    }))
    .digest("hex")
    .slice(0, 16);
}

function fingerprintSectionDraftSet(sectionDrafts) {
  return createHash("sha1")
    .update(stableStringify((Array.isArray(sectionDrafts) ? sectionDrafts : []).map((draft) => ({
      id: draft.id,
      fingerprint: draft.fingerprint,
    }))))
    .digest("hex")
    .slice(0, 16);
}

function formatDigestTerm(term) {
  if (!term) {
    return "";
  }
  const zh = term.zh ? ` => ${term.zh}` : "";
  const note = term.note ? ` (${term.note})` : "";
  return `${term.source}${zh}${note}`;
}

function formatDigestReference(ref) {
  const label = ref.label || ref.id || ref.type || "item";
  const page = ref.pageNumber ? ` p.${ref.pageNumber}` : "";
  const meaning = ref.meaning || ref.text;
  return `${label}${page}${meaning ? `: ${meaning}` : ""}`;
}

function getParagraphDigestId(paragraph) {
  return normalizeLine(paragraph?.id || paragraph?.paragraphId || "");
}

function getMinimumParagraphPage(paragraphs) {
  const pages = paragraphs.map((paragraph) => normalizePage(paragraph.pageNumber)).filter(Boolean);
  return pages.length ? Math.min(...pages) : null;
}

function getMaximumParagraphPage(paragraphs) {
  const pages = paragraphs
    .map((paragraph) => normalizePage(paragraph.pageEndNumber) || normalizePage(paragraph.pageNumber))
    .filter(Boolean);
  return pages.length ? Math.max(...pages) : null;
}

function pageOverlapsRange(start, end, rangeStart, rangeEnd) {
  const cleanStart = normalizePage(start);
  const cleanEnd = normalizePage(end) || cleanStart;
  const cleanRangeStart = normalizePage(rangeStart);
  const cleanRangeEnd = normalizePage(rangeEnd) || cleanRangeStart;
  if (!cleanStart || !cleanEnd || !cleanRangeStart || !cleanRangeEnd) {
    return false;
  }
  return cleanStart <= cleanRangeEnd && cleanEnd >= cleanRangeStart;
}

function compareDigestParagraphs(a, b) {
  return (Number(a.order ?? a.index ?? 0) - Number(b.order ?? b.index ?? 0)) ||
    ((normalizePage(a.pageNumber) || 0) - (normalizePage(b.pageNumber) || 0)) ||
    getParagraphDigestId(a).localeCompare(getParagraphDigestId(b));
}

function isDigestArtifact(artifact) {
  const type = normalizeComparable(artifact.visualType || artifact.type || "");
  return ["figure", "table", "formula", "code", "caption"].includes(type) || artifact.type === "caption";
}

function isFormulaArtifact(artifact) {
  return normalizeComparable(artifact.type) === "formula" || normalizeComparable(artifact.visualType) === "formula";
}

function inferVisualTypeFromLabel(label) {
  if (/^table\b/i.test(label)) {
    return "table";
  }
  if (/^(?:fig(?:ure)?\.?)\b/i.test(label)) {
    return "figure";
  }
  if (/^(?:alg(?:orithm)?\.?)\b/i.test(label)) {
    return "code";
  }
  return "visual";
}

function inferSectionDigestRole(title) {
  const clean = normalizeComparable(title);
  if (/intro|introduction/.test(clean)) {
    return "Motivates the problem and frames the paper's contributions.";
  }
  if (/related|background|preliminar/.test(clean)) {
    return "Defines context and separates this paper from prior work.";
  }
  if (/method|approach|model|design|algorithm|system/.test(clean)) {
    return "Explains the core method and the technical mechanism.";
  }
  if (/experiment|evaluation|result|ablation|benchmark/.test(clean)) {
    return "Validates the method with evidence and comparisons.";
  }
  if (/conclusion|discussion|limitation/.test(clean)) {
    return "Summarizes findings, scope, and remaining limitations.";
  }
  return "Explains this section's role in the paper's argument.";
}

function extractKeySymbols(value) {
  const text = String(value || "");
  const symbols = [];
  const push = (candidate) => {
    const clean = normalizeLine(candidate)
      .replace(/^\\+/, "")
      .replace(/[.,;:()[\]{}]+$/g, "");
    if (!clean || clean.length > 24 || SYMBOL_STOPWORDS.has(clean.toLowerCase())) {
      return;
    }
    symbols.push(clean);
  };
  for (const match of text.matchAll(/\b[A-Z][A-Z0-9]{1,14}\b/g)) {
    push(match[0]);
  }
  for (const match of text.matchAll(/\b[A-Za-z][A-Za-z0-9]*(?:[_^][A-Za-z0-9{}]+)+\b/g)) {
    push(match[0]);
  }
  for (const match of text.matchAll(/(?:^|[=+\-*/^,(])\s*([A-Za-z])(?=\s*(?:[=+\-*/^,),]|$))/g)) {
    push(match[1]);
  }
  return symbols.filter(uniqueFilter);
}

function mergeStringLists(...values) {
  return values.flatMap((value) => Array.isArray(value) ? value : normalizeStringList(value))
    .map(normalizeLine)
    .filter(Boolean)
    .filter(uniqueFilter);
}

const SYMBOL_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

function getDeepPlanStatus(plan) {
  if (plan.paperBrief && plan.sectionPlans.length && plan.terminology.length) {
    return plan.fallbackReason ? "fallback-ready" : "ready";
  }
  if (plan.paperBrief || plan.sectionPlans.length || plan.terminology.length) {
    return "partial";
  }
  return "missing";
}

function estimateDeepPlanTokens(plan) {
  const chars = [
    ...(plan.sectionPlans || []).map((item) => `${item.title} ${item.role} ${item.summary}`),
    ...(plan.terminology || []).map((item) => `${item.source} ${item.zh} ${item.note}`),
    ...(plan.claimGraph || []).map((item) => item.claim),
    ...(plan.formulaMap || []).map((item) => `${item.label} ${item.text} ${item.meaning}`),
    ...(plan.visualMap || []).map((item) => `${item.label} ${item.meaning}`),
  ].join(" ").length;
  return Math.ceil(chars / 3.5);
}

function fingerprintDeepPlan(plan) {
  return createHash("sha1")
    .update(stableStringify({
      paperTitle: plan.paperTitle,
      paperBrief: plan.paperBrief,
      mainThread: plan.mainThread,
      sectionPlans: plan.sectionPlans,
      terminology: plan.terminology,
      claimGraph: plan.claimGraph,
      formulaMap: plan.formulaMap,
      visualMap: plan.visualMap,
      writingRules: plan.writingRules,
    }))
    .digest("hex")
    .slice(0, 16);
}

function formatSectionPlan(section) {
  return [
    section.title,
    section.role ? `role=${section.role}` : "",
    section.summary ? `summary=${section.summary}` : "",
    section.mustMention.length ? `must=${section.mustMention.slice(0, 6).join(", ")}` : "",
    section.terms.length ? `terms=${section.terms.slice(0, 8).join(", ")}` : "",
  ].filter(Boolean).join(" | ");
}

function formatTerminologyItem(item) {
  return item.zh ? `${item.source} => ${item.zh}${item.note ? ` (${item.note})` : ""}` : `${item.source}${item.note ? ` (${item.note})` : ""}`;
}

function formatClaimItem(item) {
  return item.evidence.length ? `${item.claim} [${item.evidence.slice(0, 4).join(", ")}]` : item.claim;
}

function formatFormulaItem(item) {
  return [item.label || item.text, item.meaning].filter(Boolean).join(": ");
}

function formatVisualItem(item) {
  return [item.label || item.type, item.meaning].filter(Boolean).join(": ");
}

function normalizeReferenceList(value) {
  return (Array.isArray(value) ? value : value ? [value] : [])
    .map((item) => {
      if (typeof item === "string") {
        return normalizeLine(item);
      }
      const data = normalizeObject(item);
      return normalizeLine(data.label || data.title || data.name || data.text || data.id || "");
    })
    .filter(Boolean)
    .filter(uniqueFilter);
}

function normalizePageList(value) {
  return (Array.isArray(value) ? value : value ? [value] : [])
    .map((item) => normalizePage(item))
    .filter(Boolean)
    .filter(uniqueFilter);
}

function firstArray(...values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length) {
      return value;
    }
  }
  return [];
}

function normalizeStringList(value) {
  return (Array.isArray(value) ? value : value ? [value] : [])
    .flatMap((item) => {
      if (typeof item === "string") {
        return item.split(/[;；\n]/);
      }
      if (item && typeof item === "object") {
        return [item.text || item.label || item.title || item.term || item.source || item.name || ""];
      }
      return [];
    })
    .map(normalizeLine)
    .filter(Boolean)
    .filter(uniqueFilter);
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeComparable(value) {
  return normalizeLine(value).toLowerCase();
}

function normalizePage(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : null;
}

function normalizeConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }
  if (number > 1 && number <= 100) {
    return round(number / 100);
  }
  return round(Math.max(0, Math.min(1, number)));
}

function clampInteger(value, fallback, min, max) {
  const number = Number(value);
  const clean = Number.isFinite(number) ? Math.trunc(number) : fallback;
  return Math.max(min, Math.min(max, clean));
}

function inferSectionLevel(title) {
  const match = normalizeLine(title).match(/^(\d+(?:\.\d+)*)\b/);
  if (!match) {
    return 1;
  }
  return Math.min(6, match[1].split(".").length);
}

function uniqueId(value, seen) {
  const base = slugify(value) || "section";
  if (!seen.has(base)) {
    seen.add(base);
    return base;
  }
  let suffix = 2;
  while (seen.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  const id = `${base}-${suffix}`;
  seen.add(id);
  return id;
}

function slugify(value) {
  return normalizeLine(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function uniqueFilter(value, index, list) {
  return list.findIndex((item) => normalizeComparable(item) === normalizeComparable(value)) === index;
}

function truncateText(value, limit) {
  const text = normalizeLine(value);
  const max = Number(limit) || 200;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function round(value) {
  return Math.round(Number(value) * 1000) / 1000;
}
