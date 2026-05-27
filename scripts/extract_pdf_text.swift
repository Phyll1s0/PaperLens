import Foundation
import PDFKit
import AppKit

struct TextBlock: Codable {
    let text: String
    let x: Double
    let y: Double
    let width: Double
    let height: Double
    let column: Int
    let lineCount: Int
}

struct PageText: Codable {
    let pageNumber: Int
    let text: String
    let blocks: [TextBlock]
    let width: Double?
    let height: Double?
    let imagePath: String?
    let imageWidth: Int?
    let imageHeight: Int?
}

struct ExtractionResult: Codable {
    let pageCount: Int
    let pages: [PageText]
}

struct LayoutLine {
    let text: String
    let x: CGFloat
    let y: CGFloat
    let width: CGFloat
    let height: CGFloat
    let column: Int

    var maxX: CGFloat { x + width }
    var minY: CGFloat { y }
    var maxY: CGFloat { y + height }
}

struct BlockBuilder {
    var lines: [LayoutLine] = []
    var text: String = ""
    var column: Int = 0

    var isEmpty: Bool {
        text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    mutating func append(_ line: LayoutLine) {
        if lines.isEmpty {
            column = line.column
        }

        if text.hasSuffix("-"), startsWithLowercase(line.text) {
            text.removeLast()
            text += line.text
        } else if text.isEmpty {
            text = line.text
        } else {
            text += " " + line.text
        }

        lines.append(line)
    }

    func build() -> TextBlock? {
        let clean = normalizeInlineText(text)
        guard !clean.isEmpty else {
            return nil
        }

        let minX = lines.map(\.x).min() ?? 0
        let maxX = lines.map(\.maxX).max() ?? 0
        let minY = lines.map(\.minY).min() ?? 0
        let maxY = lines.map(\.maxY).max() ?? 0

        return TextBlock(
            text: clean,
            x: Double(minX),
            y: Double(minY),
            width: Double(maxX - minX),
            height: Double(maxY - minY),
            column: column,
            lineCount: lines.count
        )
    }
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data(message.utf8))
    exit(1)
}

guard CommandLine.arguments.count >= 2 else {
    fail("Usage: swift extract_pdf_text.swift <pdf-path>\n")
}

let pdfPath = CommandLine.arguments[1]
let url = URL(fileURLWithPath: pdfPath)
let assetDirectory = CommandLine.arguments.count >= 4 ? CommandLine.arguments[2] : nil
let assetPublicBase = CommandLine.arguments.count >= 4 ? CommandLine.arguments[3] : nil

guard let document = PDFDocument(url: url) else {
    fail("Unable to open PDF.\n")
}

var pages: [PageText] = []

if let assetDirectory {
    try? FileManager.default.createDirectory(
        at: URL(fileURLWithPath: assetDirectory),
        withIntermediateDirectories: true
    )
}

for index in 0..<document.pageCount {
    guard let page = document.page(at: index) else {
        continue
    }

    let pageNumber = index + 1
    let pageBounds = page.bounds(for: .mediaBox)
    let blocks = convertBlocksToTopLeftCoordinates(
        extractLayoutBlocks(from: page),
        pageHeight: pageBounds.height
    )
    let layoutText = blocks.map(\.text).joined(separator: "\n\n")
    let fallbackText = page.string ?? ""
    let text = layoutText.isEmpty ? fallbackText : layoutText
    let pageImage = renderPageImage(
        page,
        pageNumber: pageNumber,
        assetDirectory: assetDirectory,
        assetPublicBase: assetPublicBase
    )

    pages.append(PageText(
        pageNumber: pageNumber,
        text: text,
        blocks: blocks,
        width: Double(pageBounds.width),
        height: Double(pageBounds.height),
        imagePath: pageImage?.path,
        imageWidth: pageImage?.width,
        imageHeight: pageImage?.height
    ))
}

let result = ExtractionResult(pageCount: document.pageCount, pages: pages)
let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]

do {
    let data = try encoder.encode(result)
    FileHandle.standardOutput.write(data)
} catch {
    fail("Failed to encode extraction result: \(error.localizedDescription)\n")
}

func extractLayoutBlocks(from page: PDFPage) -> [TextBlock] {
    let lines = extractLayoutLines(from: page)
    guard lines.count > 3 else {
        return []
    }

    let orderedLines = orderLinesForReading(assignColumns(lines))
    return groupLinesIntoBlocks(orderedLines)
}

func extractLayoutLines(from page: PDFPage) -> [LayoutLine] {
    guard
        page.numberOfCharacters > 0,
        let selection = page.selection(for: NSRange(location: 0, length: page.numberOfCharacters))
    else {
        return []
    }

    return selection.selectionsByLine().compactMap { lineSelection in
        let text = normalizeLineText(lineSelection.string ?? "")
        let bounds = lineSelection.bounds(for: page)

        if text.isEmpty || bounds.width <= 0 || bounds.height <= 0 || bounds.isNull || bounds.isInfinite {
            return nil
        }

        return LayoutLine(
            text: text,
            x: bounds.minX,
            y: bounds.minY,
            width: bounds.width,
            height: bounds.height,
            column: 0
        )
    }
}

func assignColumns(_ lines: [LayoutLine]) -> [LayoutLine] {
    guard lines.count > 4 else {
        return lines
    }

    let minX = lines.map(\.x).min() ?? 0
    let maxX = lines.map(\.maxX).max() ?? 0
    let contentWidth = max(CGFloat(1), maxX - minX)
    let midpoint = minX + contentWidth / 2

    return lines.map { line in
        let center = line.x + line.width / 2
        let spansBothColumns = line.width > contentWidth * 0.62 && line.x < midpoint && line.maxX > midpoint
        let centeredWideLine = line.width > contentWidth * 0.32 && abs(center - midpoint) < contentWidth * 0.18
        let column = (spansBothColumns || centeredWideLine) ? 0 : (center < midpoint ? 1 : 2)

        return LayoutLine(
            text: line.text,
            x: line.x,
            y: line.y,
            width: line.width,
            height: line.height,
            column: column
        )
    }
}

func orderLinesForReading(_ lines: [LayoutLine]) -> [LayoutLine] {
    let leftCount = lines.filter { $0.column == 1 && $0.text.count > 8 }.count
    let rightCount = lines.filter { $0.column == 2 && $0.text.count > 8 }.count
    let isTwoColumn = leftCount >= 8 && rightCount >= 8

    if !isTwoColumn {
        return lines.sorted { compareTopToBottom($0, $1) }
    }

    let columnLines = lines.filter { $0.column != 0 }
    let columnTop = columnLines.map(\.maxY).max() ?? CGFloat.greatestFiniteMagnitude
    let topFullWidth = lines
        .filter { $0.column == 0 && $0.maxY >= columnTop - 6 }
        .sorted { compareTopToBottom($0, $1) }
    let leftColumn = lines
        .filter { $0.column == 1 }
        .sorted { compareTopToBottom($0, $1) }
    let rightColumn = lines
        .filter { $0.column == 2 }
        .sorted { compareTopToBottom($0, $1) }
    let remainingFullWidth = lines
        .filter { $0.column == 0 && $0.maxY < columnTop - 6 }
        .sorted { compareTopToBottom($0, $1) }

    return topFullWidth + leftColumn + rightColumn + remainingFullWidth
}

func compareTopToBottom(_ lhs: LayoutLine, _ rhs: LayoutLine) -> Bool {
    if abs(lhs.y - rhs.y) > 2 {
        return lhs.y > rhs.y
    }
    return lhs.x < rhs.x
}

func groupLinesIntoBlocks(_ lines: [LayoutLine]) -> [TextBlock] {
    var blocks: [TextBlock] = []
    var current = BlockBuilder()
    var previousLine: LayoutLine?
    var footnoteContinuation: (column: Int, minY: CGFloat)?

    func flushCurrent() {
        if let block = current.build() {
            blocks.append(block)
        }
        current = BlockBuilder()
    }

    for line in lines {
        if line.text.count <= 1 {
            continue
        }

        if let footnote = footnoteContinuation {
            if line.column == footnote.column && line.y >= footnote.minY {
                continue
            }
            footnoteContinuation = nil
        }

        if isLikelyFootnoteLine(line.text) {
            footnoteContinuation = (line.column, line.y - line.height * 3.2)
            continue
        }

        if isLikelyHeadingLine(line.text) {
            flushCurrent()
            var headingBlock = BlockBuilder()
            headingBlock.append(line)
            if let block = headingBlock.build() {
                blocks.append(block)
            }
            previousLine = line
            continue
        }

        if let previousLine, !current.isEmpty {
            let gap = previousLine.y - line.y
            let changedColumn = previousLine.column != line.column
            let largeVerticalGap = previousLine.column == line.column && gap > max(CGFloat(9), previousLine.height * 1.85)
            let likelyNewIndentedParagraph = previousLine.column == line.column &&
                line.x - previousLine.x > 8 &&
                current.text.count > 180 &&
                endsSentence(current.text)
            let veryLongBlock = current.text.count > 1000 && endsSentence(current.text)

            if (changedColumn && !shouldContinueAcrossColumn(current.text, next: line.text)) ||
                largeVerticalGap ||
                likelyNewIndentedParagraph ||
                veryLongBlock {
                flushCurrent()
            }
        }

        current.append(line)
        previousLine = line
    }

    flushCurrent()
    return blocks
}

func convertBlocksToTopLeftCoordinates(_ blocks: [TextBlock], pageHeight: CGFloat) -> [TextBlock] {
    blocks.map { block in
        TextBlock(
            text: block.text,
            x: block.x,
            y: Double(max(CGFloat(0), pageHeight - CGFloat(block.y) - CGFloat(block.height))),
            width: block.width,
            height: block.height,
            column: block.column,
            lineCount: block.lineCount
        )
    }
}

func shouldContinueAcrossColumn(_ current: String, next: String) -> Bool {
    let trimmed = current.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.hasSuffix("-") {
        return true
    }

    if !endsSentence(trimmed) && startsWithLowercase(next) {
        return true
    }

    return false
}

func startsWithLowercase(_ text: String) -> Bool {
    guard let scalar = text.trimmingCharacters(in: .whitespacesAndNewlines).unicodeScalars.first else {
        return false
    }

    return CharacterSet.lowercaseLetters.contains(scalar)
}

func endsSentence(_ text: String) -> Bool {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let last = trimmed.unicodeScalars.last else {
        return false
    }

    return ".!?。！？)]\"'".unicodeScalars.contains(last)
}

func isLikelyHeadingLine(_ text: String) -> Bool {
    let clean = normalizeInlineText(text)
    if clean.count < 3 || clean.count > 90 {
        return false
    }

    if clean.range(of: #"^\d+(\.\d+)*\.?\s+[A-Z][A-Za-z0-9\s:,\-/]+$"#, options: .regularExpression) != nil {
        return true
    }

    let known: Set<String> = [
        "abstract",
        "introduction",
        "related work",
        "background",
        "method",
        "methods",
        "methodology",
        "experiments",
        "experiment",
        "results",
        "discussion",
        "conclusion",
        "references",
        "appendix",
        "acknowledgments"
    ]

    return known.contains(clean.lowercased())
}

func isLikelyFootnoteLine(_ text: String) -> Bool {
    let clean = normalizeInlineText(text)
    return clean.hasPrefix("∗") || clean.hasPrefix("*") || clean.hasPrefix("†") || clean.hasPrefix("‡")
}

func normalizeLineText(_ text: String) -> String {
    normalizeInlineText(text.replacingOccurrences(of: "\n", with: " "))
}

func normalizeInlineText(_ text: String) -> String {
    text
        .replacingOccurrences(of: "\u{00ad}", with: "")
        .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

func renderPageImage(
    _ page: PDFPage,
    pageNumber: Int,
    assetDirectory: String?,
    assetPublicBase: String?
) -> (path: String, width: Int, height: Int)? {
    guard let assetDirectory, let assetPublicBase else {
        return nil
    }

    let bounds = page.bounds(for: .mediaBox)
    guard bounds.width > 0, bounds.height > 0 else {
        return nil
    }

    let targetWidth = CGFloat(1100)
    let scale = targetWidth / bounds.width
    let targetHeight = max(CGFloat(1), bounds.height * scale)
    let targetSize = CGSize(width: targetWidth, height: targetHeight)
    let thumbnail = page.thumbnail(of: targetSize, for: .mediaBox)

    guard
        let tiff = thumbnail.tiffRepresentation,
        let bitmap = NSBitmapImageRep(data: tiff),
        let png = bitmap.representation(using: .png, properties: [:])
    else {
        return nil
    }

    let filename = String(format: "page-%03d.png", pageNumber)
    let fileURL = URL(fileURLWithPath: assetDirectory).appendingPathComponent(filename)

    do {
        try png.write(to: fileURL)
        return (
            path: "\(assetPublicBase)/\(filename)",
            width: Int(thumbnail.size.width.rounded()),
            height: Int(thumbnail.size.height.rounded())
        )
    } catch {
        return nil
    }
}
