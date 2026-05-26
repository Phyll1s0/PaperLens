import Foundation
import PDFKit
import AppKit

struct PageText: Codable {
    let pageNumber: Int
    let text: String
    let imagePath: String?
    let imageWidth: Int?
    let imageHeight: Int?
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

    let text = page.string ?? ""
    let pageImage = renderPageImage(
        page,
        pageNumber: index + 1,
        assetDirectory: assetDirectory,
        assetPublicBase: assetPublicBase
    )

    pages.append(PageText(
        pageNumber: index + 1,
        text: text,
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
