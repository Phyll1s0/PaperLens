import {
  FORMULA_RENDER_MODE_IMAGE,
  FORMULA_RENDER_MODE_IMAGE_LATEX,
  buildFormulaRenderFields,
  getFormulaAuxiliaryTextLabel,
  shouldExportFormulaLatexText,
  shouldExportFormulaTextAsAuxiliary,
} from "./formula-render-quality.js";

export function buildPaperMarkdownExport(paper, baseUrl = "", options = {}) {
  const isReadingParagraphForPaper = options.isReadingParagraphForPaper || defaultIsReadingParagraphForPaper;
  const getVisiblePaperArtifacts = options.getVisiblePaperArtifacts || defaultGetVisiblePaperArtifacts;
  const now = typeof options.now === "function" ? options.now : () => new Date();
  const title = normalizeExportLine(paper.title || paper.filename || "PaperLens Notes");
  const sectionsById = new Map((paper.sections || []).map((section) => [section.id, section]));
  const artifactsById = new Map(getVisiblePaperArtifacts(paper).map((artifact) => [artifact.id, artifact]));
  const lines = [
    `# ${escapeMarkdownHeading(title)}`,
    "",
    `- 文件：${normalizeExportLine(paper.filename || "") || "未知"}`,
    `- 页数：${paper.pageCount || "未知"}`,
    `- 段落数：${(paper.paragraphs || []).filter((paragraph) => isReadingParagraphForPaper(paper, paragraph)).length}`,
    `- 导出时间：${now().toISOString()}`,
    "",
  ];

  let currentSectionTitle = "";
  for (const paragraph of paper.paragraphs || []) {
    if (paragraph.kind === "heading") {
      const heading = normalizeExportLine(paragraph.sourceText || "");
      if (heading) {
        currentSectionTitle = heading;
        lines.push(`## ${escapeMarkdownHeading(heading)}`, "");
      }
      continue;
    }

    if (!isReadingParagraphForPaper(paper, paragraph)) {
      continue;
    }

    const section = sectionsById.get(paragraph.sectionId);
    const sectionTitle = normalizeExportLine(section?.title || paragraph.sectionTitleHint || "");
    if (sectionTitle && sectionTitle !== "正文" && sectionTitle !== currentSectionTitle) {
      currentSectionTitle = sectionTitle;
      lines.push(`## ${escapeMarkdownHeading(sectionTitle)}`, "");
    }

    const pageLabel = formatExportPageRange(paragraph);
    lines.push(`### P${Number(paragraph.order || 0) + 1}${pageLabel ? ` · ${pageLabel}` : ""}`, "");
    appendMarkdownBlock(lines, "原文", paragraph.sourceMarkdown || paragraph.sourceText);
    appendMarkdownBlock(lines, "翻译", paragraph.translation || "尚未生成");
    appendMarkdownBlock(lines, "讲解", paragraph.explanation || "尚未生成");

    const keyTerms = normalizeKeywordList(paragraph.keyTerms).slice(0, 12);
    if (keyTerms.length) {
      lines.push(`**术语：** ${keyTerms.map((term) => `\`${escapeMarkdownInline(term)}\``).join(" ")}`, "");
    }

    const relatedArtifacts = (Array.isArray(paragraph.relatedArtifactIds) ? paragraph.relatedArtifactIds : [])
      .map((id) => artifactsById.get(id))
      .filter(Boolean);
    if (relatedArtifacts.length) {
      lines.push("**相关图表：**");
      for (const artifact of relatedArtifacts) {
        const label = normalizeExportLine(artifact.label || artifact.visualType || artifact.type || "图表");
        const imagePath = normalizeExportLine(artifact.imagePath || "");
        const caption = normalizeExportArtifactText(artifact);
        const cropUrl = getExportArtifactCropUrl(paper, artifact, baseUrl);
        lines.push(`- ${escapeMarkdownInline(label)}${imagePath ? `：${imagePath}` : ""}`);
        if (cropUrl) {
          lines.push(`  ![${escapeMarkdownImageAlt(label)}](${cropUrl})`);
        }
        if (caption) {
          lines.push(`  ${caption}`);
        }
      }
      lines.push("");
    }
  }

  return `${lines.join("\n").replace(/\n{4,}/g, "\n\n\n").trim()}\n`;
}

function normalizeExportArtifactText(artifact = {}) {
  const text = normalizeExportBlock(artifact.text || artifact.latex || "");
  if (artifact.type !== "formula") {
    return text;
  }

  const fields = buildFormulaRenderFields(artifact);
  if (fields.renderMode === FORMULA_RENDER_MODE_IMAGE) {
    return "";
  }
  if (shouldExportFormulaLatexText(artifact)) {
    return text;
  }
  if (fields.renderMode === FORMULA_RENDER_MODE_IMAGE_LATEX && shouldExportFormulaTextAsAuxiliary(artifact)) {
    return `${getFormulaAuxiliaryTextLabel(artifact)}：\`${escapeMarkdownInlineCode(text)}\``;
  }
  return "";
}

export function getExportArtifactCropUrl(paper, artifact, baseUrl = "") {
  if (!artifact?.crop || !artifact.imagePath) {
    return "";
  }

  const prefix = String(baseUrl || "").replace(/\/+$/, "");
  const paperId = encodeURIComponent(paper.id);
  const artifactId = encodeURIComponent(artifact.id);
  return `${prefix}/api/papers/${paperId}/artifacts/${artifactId}/crop.svg`;
}

function appendMarkdownBlock(lines, label, text) {
  const clean = normalizeExportBlock(text);
  if (!clean) {
    return;
  }

  lines.push(`**${label}**`, "", clean, "");
}

function formatExportPageRange(paragraph) {
  const start = Number(paragraph.pageNumber || 0);
  const end = Number(paragraph.pageEndNumber || start);
  if (!start) {
    return "";
  }

  return end && end !== start ? `p.${start}-${end}` : `p.${start}`;
}

function normalizeKeywordList(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value || "").split(/[,，;；、\n]/g);
  const keywords = [];
  for (const item of raw) {
    const clean = String(item || "").replace(/\s+/g, " ").trim();
    if (clean && clean.length <= 80 && !keywords.some((term) => term.toLowerCase() === clean.toLowerCase())) {
      keywords.push(clean);
    }
  }

  return keywords;
}

function normalizeExportLine(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function normalizeExportBlock(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeMarkdownHeading(text) {
  return escapeMarkdownInline(String(text || "").replace(/^#+\s*/, ""));
}

function escapeMarkdownImageAlt(text) {
  return String(text || "").replace(/[\]\n\r]/g, " ").trim();
}

function escapeMarkdownInline(text) {
  return String(text || "").replace(/([\\`*_{}\[\]()#+.!|-])/g, "\\$1");
}

function escapeMarkdownInlineCode(text) {
  return String(text || "").replace(/`/g, "\\`");
}

function defaultGetVisiblePaperArtifacts(paper) {
  return Array.isArray(paper?.pageArtifacts)
    ? paper.pageArtifacts.filter((artifact) => !artifact?.hidden)
    : [];
}

function defaultIsReadingParagraphForPaper(_paper, paragraph) {
  return paragraph?.kind === "paragraph" && paragraph.analysisEligible !== false;
}
