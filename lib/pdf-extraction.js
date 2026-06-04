import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.dirname(path.dirname(__filename));

export async function extractPdfText(pdfPath, assetDir = "", assetPublicBase = "", options = {}) {
  const errors = [];
  const requestedEngine = String(options.pdfEngine || process.env.PAPERLENS_PDF_ENGINE || "auto").toLowerCase();

  if (requestedEngine !== "swift") {
    try {
      return await extractPdfWithPoppler(pdfPath, assetDir, assetPublicBase, options);
    } catch (error) {
      if (requestedEngine === "poppler") {
        throw error;
      }
      errors.push(`Poppler: ${error.message}`);
    }
  }

  if (requestedEngine !== "poppler") {
    try {
      return await extractPdfWithSwift(pdfPath, assetDir, assetPublicBase, options);
    } catch (error) {
      errors.push(`Swift/PDFKit: ${error.message}`);
    }
  }

  throw new Error(`PDF 提取失败。${errors.join(" ")}`);
}

export async function extractPdfWithPoppler(pdfPath, assetDir = "", assetPublicBase = "", options = {}) {
  const rootDir = options.rootDir || ROOT_DIR;
  const runCommandText = options.runCommandText || execFileText;
  const xml = await runCommandText(options.pdftotextCommand || "pdftotext", [
    "-bbox-layout",
    "-enc",
    "UTF-8",
    pdfPath,
    "-",
  ], {
    cwd: rootDir,
    timeout: options.pdftotextTimeoutMs || 90_000,
    maxBuffer: options.pdftotextMaxBuffer || 80 * 1024 * 1024,
  });

  const pages = parsePopplerBboxLayout(xml);
  if (!pages.length) {
    throw new Error("pdftotext 没有返回可解析页面。");
  }

  if (assetDir && assetPublicBase) {
    await renderPdfPagesWithPoppler(pdfPath, assetDir, assetPublicBase, pages, options);
  }

  return {
    pageCount: pages.length,
    pages,
  };
}

async function extractPdfWithSwift(pdfPath, assetDir = "", assetPublicBase = "", options = {}) {
  const rootDir = options.rootDir || ROOT_DIR;
  const scriptPath = path.join(rootDir, "scripts", "extract_pdf_text.swift");
  const args = [scriptPath, pdfPath];
  if (assetDir && assetPublicBase) {
    args.push(assetDir, assetPublicBase);
  }

  return new Promise((resolve, reject) => {
    execFile(options.swiftCommand || "/usr/bin/swift", args, {
      cwd: rootDir,
      env: {
        ...process.env,
        CLANG_MODULE_CACHE_PATH: options.swiftModuleCacheDir || path.join(rootDir, ".cache", "swift-module-cache"),
        TMPDIR: options.tmpDir || path.join(rootDir, ".cache", "tmp"),
      },
      timeout: options.swiftTimeoutMs || 60_000,
      maxBuffer: options.swiftMaxBuffer || 40 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (parseError) {
        reject(new Error(`Could not parse PDF extraction output: ${parseError.message}`));
      }
    });
  });
}

async function execFileText(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        const message = error.code === "ENOENT"
          ? `${command} 未安装或不在 PATH 中。`
          : stderr || error.message;
        reject(new Error(message));
        return;
      }

      resolve(stdout);
    });
  });
}

async function renderPdfPagesWithPoppler(pdfPath, assetDir, assetPublicBase, pages, options = {}) {
  const rootDir = options.rootDir || ROOT_DIR;
  const runCommandText = options.runCommandText || execFileText;
  await mkdir(assetDir, { recursive: true });
  const outputPrefix = path.join(assetDir, "page");
  await runCommandText(options.pdftoppmCommand || "pdftoppm", [
    "-png",
    "-r",
    "144",
    "-scale-to-x",
    "1100",
    "-scale-to-y",
    "-1",
    pdfPath,
    outputPrefix,
  ], {
    cwd: rootDir,
    timeout: options.pdftoppmTimeoutMs || 120_000,
    maxBuffer: options.pdftoppmMaxBuffer || 10 * 1024 * 1024,
  });

  const files = await readdir(assetDir);
  const pageFiles = files
    .map((file) => ({ file, match: file.match(/^page-(\d+)\.png$/i) }))
    .filter((item) => item.match)
    .map((item) => ({
      file: item.file,
      pageNumber: Number(item.match[1]),
    }))
    .filter((item) => Number.isFinite(item.pageNumber))
    .sort((a, b) => a.pageNumber - b.pageNumber);

  for (const item of pageFiles) {
    const filename = `page-${String(item.pageNumber).padStart(3, "0")}.png`;
    const sourcePath = path.join(assetDir, item.file);
    const targetPath = path.join(assetDir, filename);
    if (sourcePath !== targetPath) {
      await rename(sourcePath, targetPath).catch(() => {});
    }

    const page = pages[item.pageNumber - 1];
    if (!page) {
      continue;
    }

    const image = await readFile(targetPath).catch(() => null);
    const size = image ? readPngSize(image) : null;
    page.imagePath = `${assetPublicBase}/${filename}`;
    page.imageWidth = size?.width || null;
    page.imageHeight = size?.height || null;
  }
}

export function readPngSize(buffer) {
  if (!buffer || buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") {
    return null;
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

export function parsePopplerBboxLayout(xml) {
  const pages = [];
  const pageRegex = /<page\b([^>]*)>([\s\S]*?)<\/page>/gi;
  let pageMatch;

  while ((pageMatch = pageRegex.exec(xml))) {
    const pageAttrs = parseXmlAttributes(pageMatch[1]);
    const rawBlocks = parsePopplerBlocks(pageMatch[2]);
    const blocks = orderPopplerBlocks(rawBlocks);
    pages.push({
      pageNumber: pages.length + 1,
      text: blocks.map((block) => block.text).join("\n\n"),
      blocks,
      width: Number(pageAttrs.width || 0) || null,
      height: Number(pageAttrs.height || 0) || null,
      imagePath: null,
      imageWidth: null,
      imageHeight: null,
    });
  }

  return pages;
}

function parsePopplerBlocks(pageXml) {
  const blocks = [];
  const blockRegex = /<block\b([^>]*)>([\s\S]*?)<\/block>/gi;
  let blockMatch;

  while ((blockMatch = blockRegex.exec(pageXml))) {
    const blockAttrs = parseXmlAttributes(blockMatch[1]);
    const lines = parsePopplerLines(blockMatch[2]);
    const text = normalizePopplerText(lines.map((line) => line.text).join(" "));
    if (!text) {
      continue;
    }

    const xMin = Number(blockAttrs.xMin ?? blockAttrs.xmin ?? 0);
    const yMin = Number(blockAttrs.yMin ?? blockAttrs.ymin ?? 0);
    const xMax = Number(blockAttrs.xMax ?? blockAttrs.xmax ?? xMin);
    const yMax = Number(blockAttrs.yMax ?? blockAttrs.ymax ?? yMin);

    blocks.push({
      text,
      x: xMin,
      y: yMin,
      width: Math.max(0, xMax - xMin),
      height: Math.max(0, yMax - yMin),
      column: 0,
      lineCount: Math.max(1, lines.length),
      lines: lines.map((line) => ({
        text: line.text,
        x: line.x,
        y: line.y,
        width: line.width,
        height: line.height,
      })).filter((line) =>
        Number.isFinite(line.x) &&
        Number.isFinite(line.y) &&
        Number.isFinite(line.width) &&
        Number.isFinite(line.height) &&
        line.width > 0 &&
        line.height > 0),
    });
  }

  return blocks;
}

function parsePopplerLines(blockXml) {
  const lines = [];
  const lineRegex = /<line\b([^>]*)>([\s\S]*?)<\/line>/gi;
  let lineMatch;

  while ((lineMatch = lineRegex.exec(blockXml))) {
    const lineAttrs = parseXmlAttributes(lineMatch[1]);
    const words = [];
    const wordRegex = /<word\b([^>]*)>([\s\S]*?)<\/word>/gi;
    let wordMatch;

    while ((wordMatch = wordRegex.exec(lineMatch[2]))) {
      const wordAttrs = parseXmlAttributes(wordMatch[1]);
      const word = decodeXmlEntities(wordMatch[2].replace(/<[^>]+>/g, ""));
      if (word.trim()) {
        words.push({
          text: word.trim(),
          xMin: Number(wordAttrs.xMin ?? wordAttrs.xmin ?? NaN),
          yMin: Number(wordAttrs.yMin ?? wordAttrs.ymin ?? NaN),
          xMax: Number(wordAttrs.xMax ?? wordAttrs.xmax ?? NaN),
          yMax: Number(wordAttrs.yMax ?? wordAttrs.ymax ?? NaN),
        });
      }
    }

    const text = normalizePopplerText(words.map((word) => word.text).join(" "));
    if (text) {
      const wordBoxes = words.filter((word) =>
        [word.xMin, word.yMin, word.xMax, word.yMax].every(Number.isFinite) &&
        word.xMax > word.xMin &&
        word.yMax > word.yMin);
      const attrXMin = Number(lineAttrs.xMin ?? lineAttrs.xmin ?? NaN);
      const attrYMin = Number(lineAttrs.yMin ?? lineAttrs.ymin ?? NaN);
      const attrXMax = Number(lineAttrs.xMax ?? lineAttrs.xmax ?? NaN);
      const attrYMax = Number(lineAttrs.yMax ?? lineAttrs.ymax ?? NaN);
      const hasLineBox = [attrXMin, attrYMin, attrXMax, attrYMax].every(Number.isFinite) &&
        attrXMax > attrXMin &&
        attrYMax > attrYMin;
      const xMin = hasLineBox ? attrXMin : Math.min(...wordBoxes.map((word) => word.xMin));
      const yMin = hasLineBox ? attrYMin : Math.min(...wordBoxes.map((word) => word.yMin));
      const xMax = hasLineBox ? attrXMax : Math.max(...wordBoxes.map((word) => word.xMax));
      const yMax = hasLineBox ? attrYMax : Math.max(...wordBoxes.map((word) => word.yMax));
      lines.push({
        text,
        x: Number.isFinite(xMin) ? xMin : 0,
        y: Number.isFinite(yMin) ? yMin : 0,
        width: Number.isFinite(xMax - xMin) ? Math.max(0, xMax - xMin) : 0,
        height: Number.isFinite(yMax - yMin) ? Math.max(0, yMax - yMin) : 0,
      });
    }
  }

  return lines;
}

function orderPopplerBlocks(blocks) {
  if (blocks.length <= 4) {
    return blocks.sort(comparePopplerTopToBottom);
  }

  const minX = Math.min(...blocks.map((block) => block.x));
  const maxX = Math.max(...blocks.map((block) => block.x + block.width));
  const contentWidth = Math.max(1, maxX - minX);
  const midpoint = minX + contentWidth / 2;
  const withColumns = blocks.map((block) => {
    const center = block.x + block.width / 2;
    const spansBothColumns = block.width > contentWidth * 0.62 && block.x < midpoint && block.x + block.width > midpoint;
    const centeredWideBlock = block.width > contentWidth * 0.32 && Math.abs(center - midpoint) < contentWidth * 0.18;
    return {
      ...block,
      column: (spansBothColumns || centeredWideBlock) ? 0 : (center < midpoint ? 1 : 2),
    };
  });

  const leftCount = withColumns.filter((block) => block.column === 1 && block.text.length > 8).length;
  const rightCount = withColumns.filter((block) => block.column === 2 && block.text.length > 8).length;
  if (leftCount < 4 || rightCount < 4) {
    return withColumns.sort(comparePopplerTopToBottom);
  }

  const columnTop = Math.min(...withColumns.filter((block) => block.column !== 0).map((block) => block.y));
  const topFullWidth = withColumns
    .filter((block) => block.column === 0 && block.y <= columnTop + 6)
    .sort(comparePopplerTopToBottom);
  const leftColumn = withColumns
    .filter((block) => block.column === 1)
    .sort(comparePopplerTopToBottom);
  const rightColumn = withColumns
    .filter((block) => block.column === 2)
    .sort(comparePopplerTopToBottom);
  const remainingFullWidth = withColumns
    .filter((block) => block.column === 0 && block.y > columnTop + 6)
    .sort(comparePopplerTopToBottom);

  return [...topFullWidth, ...leftColumn, ...rightColumn, ...remainingFullWidth];
}

function comparePopplerTopToBottom(a, b) {
  if (Math.abs(a.y - b.y) > 2) {
    return a.y - b.y;
  }

  return a.x - b.x;
}

function parseXmlAttributes(source) {
  const attrs = {};
  const attrRegex = /([:\w-]+)="([^"]*)"/g;
  let match;

  while ((match = attrRegex.exec(source))) {
    attrs[match[1]] = decodeXmlEntities(match[2]);
  }

  return attrs;
}

function decodeXmlEntities(text) {
  return String(text || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, value) => String.fromCodePoint(Number.parseInt(value, 16)))
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number.parseInt(value, 10)))
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function normalizePopplerText(text) {
  return String(text || "")
    .replace(/\u00ad/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
