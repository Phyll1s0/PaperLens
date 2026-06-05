import path from "node:path";
import {
  FORMULA_RENDER_MODE_IMAGE,
  FORMULA_RENDER_MODE_IMAGE_LATEX,
  buildFormulaRenderFields,
  getFormulaAuxiliaryTextLabel,
  shouldExportFormulaLatexText,
  shouldExportFormulaTextAsAuxiliary,
} from "./formula-render-quality.js";

export async function buildPaperDocxExport(paper, options = {}) {
  const isReadingParagraphForPaper = options.isReadingParagraphForPaper || defaultIsReadingParagraphForPaper;
  const getVisiblePaperArtifacts = options.getVisiblePaperArtifacts || defaultGetVisiblePaperArtifacts;
  const now = typeof options.now === "function" ? options.now : () => new Date();
  const title = normalizeExportLine(paper.title || paper.filename || "PaperLens Notes");
  const sectionsById = new Map((paper.sections || []).map((section) => [section.id, section]));
  const artifactsById = new Map(getVisiblePaperArtifacts(paper).map((artifact) => [artifact.id, artifact]));
  const media = await collectDocxMedia(paper, {
    getVisiblePaperArtifacts,
    readArtifactAsset: options.readArtifactAsset,
  });
  const rels = [
    '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    ...media.relationships,
  ];
  const body = [];

  body.push(docxParagraph(title, { style: "Title" }));
  body.push(docxParagraph(`文件：${normalizeExportLine(paper.filename || "") || "未知"}`, { style: "Meta" }));
  body.push(docxParagraph(`页数：${paper.pageCount || "未知"} · 段落数：${(paper.paragraphs || []).filter((paragraph) => isReadingParagraphForPaper(paper, paragraph)).length} · 导出时间：${now().toISOString()}`, { style: "Meta" }));

  let currentSectionTitle = "";
  for (const paragraph of paper.paragraphs || []) {
    if (paragraph.kind === "heading") {
      const heading = normalizeExportLine(paragraph.sourceText || "");
      if (heading) {
        currentSectionTitle = heading;
        body.push(docxParagraph(heading, { style: "Heading1" }));
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
      body.push(docxParagraph(sectionTitle, { style: "Heading1" }));
    }

    const pageLabel = formatExportPageRange(paragraph);
    body.push(docxParagraph(`P${Number(paragraph.order || 0) + 1}${pageLabel ? ` · ${pageLabel}` : ""}`, { style: "Heading2" }));
    appendDocxBlock(body, "原文", paragraph.sourceText);
    appendDocxBlock(body, "翻译", paragraph.translation || "尚未生成");
    appendDocxBlock(body, "讲解", paragraph.explanation || "尚未生成");

    const keyTerms = normalizeKeywordList(paragraph.keyTerms).slice(0, 12);
    if (keyTerms.length) {
      body.push(docxParagraph(`术语：${keyTerms.join("、")}`, { style: "Meta" }));
    }

    const relatedArtifacts = (Array.isArray(paragraph.relatedArtifactIds) ? paragraph.relatedArtifactIds : [])
      .map((id) => artifactsById.get(id))
      .filter(Boolean);
    if (relatedArtifacts.length) {
      body.push(docxParagraph("相关图表", { style: "Heading3" }));
      for (const artifact of relatedArtifacts) {
        const label = normalizeExportLine(artifact.label || artifact.visualType || artifact.type || "图表");
        body.push(docxParagraph(label, { style: "Caption" }));
        const drawing = buildDocxArtifactDrawing(artifact, media.byImagePath.get(artifact.imagePath || ""));
        if (drawing) {
          body.push(drawing);
        }
        const artifactText = normalizeDocxArtifactText(artifact);
        if (artifactText) {
          body.push(docxParagraph(artifactText, { style: "Caption" }));
        }
      }
    }
  }

  body.push("<w:sectPr><w:pgSz w:w=\"12240\" w:h=\"15840\"/><w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1440\" w:header=\"720\" w:footer=\"720\" w:gutter=\"0\"/></w:sectPr>");
  const documentXml = buildDocxDocumentXml(body.join(""));
  const files = [
    { path: "[Content_Types].xml", data: buildDocxContentTypes(media.files) },
    { path: "_rels/.rels", data: buildDocxRootRels() },
    { path: "word/document.xml", data: documentXml },
    { path: "word/styles.xml", data: buildDocxStyles() },
    { path: "word/_rels/document.xml.rels", data: buildDocxDocumentRels(rels) },
    ...media.files,
  ];

  return createZip(files, now());
}

async function collectDocxMedia(paper, options = {}) {
  const getVisiblePaperArtifacts = options.getVisiblePaperArtifacts || defaultGetVisiblePaperArtifacts;
  const readArtifactAsset = options.readArtifactAsset || (async () => null);
  const artifacts = getVisiblePaperArtifacts(paper);
  const imagePaths = [...new Set(artifacts
    .filter((artifact) => artifact?.crop && artifact.imagePath)
    .map((artifact) => artifact.imagePath))];
  const byImagePath = new Map();
  const files = [];
  const relationships = [];
  let index = 1;

  for (const imagePath of imagePaths) {
    const asset = await readArtifactAsset(imagePath);
    if (!asset?.data) {
      continue;
    }

    const ext = normalizeImageExtension(asset.ext || path.extname(String(imagePath || "")).toLowerCase() || ".png");
    const mediaName = `image-${index}${ext}`;
    const rId = `rIdImage${index}`;
    const mediaPath = `word/media/${mediaName}`;
    files.push({ path: mediaPath, data: Buffer.isBuffer(asset.data) ? asset.data : Buffer.from(asset.data) });
    relationships.push(`<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${mediaName}"/>`);
    byImagePath.set(imagePath, { rId, mediaPath });
    index += 1;
  }

  return { byImagePath, files, relationships };
}

function appendDocxBlock(body, label, text) {
  body.push(docxParagraph(label, { style: "Label" }));
  for (const part of splitExportBlock(text)) {
    body.push(docxParagraph(part, { style: "Normal" }));
  }
}

function normalizeDocxArtifactText(artifact = {}) {
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
    return `${getFormulaAuxiliaryTextLabel(artifact)}：${text}`;
  }
  return "";
}

function splitExportBlock(text) {
  const clean = normalizeExportBlock(text);
  return clean ? clean.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean) : [];
}

function buildDocxArtifactDrawing(artifact, mediaRef) {
  const crop = artifact?.crop || {};
  if (!mediaRef) {
    return "";
  }

  const x = Number(crop.x);
  const y = Number(crop.y);
  const width = Number(crop.width);
  const height = Number(crop.height);
  const pageWidth = Number(crop.pageWidth || artifact.pageWidth);
  const pageHeight = Number(crop.pageHeight || artifact.pageHeight);
  if (![x, y, width, height, pageWidth, pageHeight].every(Number.isFinite) ||
    width <= 0 || height <= 0 || pageWidth <= 0 || pageHeight <= 0) {
    return "";
  }

  const maxWidthPoints = 432;
  const scale = Math.min(1, maxWidthPoints / width);
  const cx = Math.max(1, Math.round(width * scale * 12700));
  const cy = Math.max(1, Math.round(height * scale * 12700));
  const cropLeft = Math.round(clampNumber(x / pageWidth * 100000, 0, 100000));
  const cropTop = Math.round(clampNumber(y / pageHeight * 100000, 0, 100000));
  const cropRight = Math.round(clampNumber((pageWidth - x - width) / pageWidth * 100000, 0, 100000));
  const cropBottom = Math.round(clampNumber((pageHeight - y - height) / pageHeight * 100000, 0, 100000));
  const name = escapeXmlAttribute(artifact.label || artifact.visualType || artifact.type || "PaperLens image");

  return [
    "<w:p>",
    "<w:pPr><w:spacing w:before=\"80\" w:after=\"160\"/></w:pPr>",
    "<w:r><w:drawing>",
    `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${Math.max(1, Math.abs(hashString(`${mediaRef.rId}:${name}`)))}" name="${name}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>`,
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>',
    `<pic:nvPicPr><pic:cNvPr id="0" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>`,
    `<pic:blipFill><a:blip r:embed="${mediaRef.rId}"/><a:srcRect l="${cropLeft}" t="${cropTop}" r="${cropRight}" b="${cropBottom}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`,
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`,
    "</pic:pic></a:graphicData></a:graphic></wp:inline>",
    "</w:drawing></w:r>",
    "</w:p>",
  ].join("");
}

function buildDocxDocumentXml(bodyXml) {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" mc:Ignorable="w14 wp14">',
    `<w:body>${bodyXml}</w:body>`,
    "</w:document>",
  ].join("");
}

function buildDocxContentTypes(mediaFiles) {
  const imageDefaults = [...new Set(mediaFiles
    .map((file) => path.extname(file.path).toLowerCase().slice(1))
    .filter(Boolean))]
    .map((ext) => `<Default Extension="${escapeXmlAttribute(ext)}" ContentType="${getImageContentType(ext)}"/>`)
    .join("");
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    imageDefaults,
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
    "</Types>",
  ].join("");
}

function getImageContentType(ext) {
  if (ext === "jpg" || ext === "jpeg") {
    return "image/jpeg";
  }
  if (ext === "webp") {
    return "image/webp";
  }
  return "image/png";
}

function buildDocxRootRels() {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
    "</Relationships>",
  ].join("");
}

function buildDocxDocumentRels(rels) {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    ...rels,
    "</Relationships>",
  ].join("");
}

function buildDocxStyles() {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial"/><w:sz w:val="21"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>',
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial"/><w:sz w:val="21"/></w:rPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="180"/></w:pPr><w:rPr><w:b/><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial"/><w:sz w:val="34"/></w:rPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="120"/></w:pPr><w:rPr><w:b/><w:color w:val="0B5F59"/><w:sz w:val="28"/></w:rPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="Heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="220" w:after="100"/></w:pPr><w:rPr><w:b/><w:color w:val="20302C"/><w:sz w:val="24"/></w:rPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="Heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="80"/></w:pPr><w:rPr><w:b/><w:color w:val="47534F"/><w:sz w:val="21"/></w:rPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="Label"><w:name w:val="Label"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="80" w:after="40"/></w:pPr><w:rPr><w:b/><w:color w:val="20302C"/></w:rPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="Meta"><w:name w:val="Meta"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:color w:val="64706C"/><w:sz w:val="19"/></w:rPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="Caption"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="80"/></w:pPr><w:rPr><w:i/><w:color w:val="64706C"/><w:sz w:val="19"/></w:rPr></w:style>',
    "</w:styles>",
  ].join("");
}

function docxParagraph(text, options = {}) {
  const style = options.style ? `<w:pStyle w:val="${escapeXmlAttribute(options.style)}"/>` : "";
  const pPr = style ? `<w:pPr>${style}</w:pPr>` : "";
  return `<w:p>${pPr}${docxTextRuns(text)}</w:p>`;
}

function docxTextRuns(text) {
  const clean = String(text || "");
  if (!clean) {
    return "<w:r><w:t></w:t></w:r>";
  }

  return clean.split(/\n/).map((line, index) => {
    const br = index ? "<w:br/>" : "";
    return `<w:r>${br}<w:t xml:space="preserve">${escapeXmlText(line)}</w:t></w:r>`;
  }).join("");
}

function createZip(files, date = new Date()) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { time, date: dosDate } = getDosDateTime(date);

  for (const file of files) {
    const name = Buffer.from(file.path, "utf8");
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data), "utf8");
    const crc = crc32(data);
    const localHeader = Buffer.alloc(30 + name.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    name.copy(localHeader, 30);
    localParts.push(localHeader, data);

    const centralHeader = Buffer.alloc(46 + name.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    name.copy(centralHeader, 46);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

function getDosDateTime(date) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let c = index;
  for (let bit = 0; bit < 8; bit += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function hashString(value) {
  let hash = 0;
  for (const char of String(value || "")) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }
  return hash;
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

function escapeXmlText(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeXmlAttribute(text) {
  return escapeXmlText(text)
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

function normalizeImageExtension(ext) {
  const value = String(ext || "").trim().toLowerCase();
  if (!value) {
    return ".png";
  }

  return value.startsWith(".") ? value : `.${value}`;
}

function defaultGetVisiblePaperArtifacts(paper) {
  return Array.isArray(paper?.pageArtifacts)
    ? paper.pageArtifacts.filter((artifact) => !artifact?.hidden)
    : [];
}

function defaultIsReadingParagraphForPaper(_paper, paragraph) {
  return paragraph?.kind === "paragraph" && paragraph.analysisEligible !== false;
}
