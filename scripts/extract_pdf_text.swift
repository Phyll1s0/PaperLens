import Foundation
import PDFKit

struct PageText: Codable {
    let pageNumber: Int
    let text: String
}

struct ExtractionResult: Codable {
    let pageCount: Int
    let pages: [PageText]
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

guard let document = PDFDocument(url: url) else {
    fail("Unable to open PDF.\n")
}

var pages: [PageText] = []

for index in 0..<document.pageCount {
    guard let page = document.page(at: index) else {
        continue
    }

    let text = page.string ?? ""
    pages.append(PageText(pageNumber: index + 1, text: text))
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
