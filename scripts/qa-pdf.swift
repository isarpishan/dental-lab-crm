// کمک آزمون (فقط Mac): متن PDF، کد QR روی صفحه‌ها، و در صورت خواستن تصویر PNG صفحهٔ اول.
// با PDFKit و CoreImage خود macOS، بدون ابزار اضافه.
// اجرا: swift scripts/qa-pdf.swift <file.pdf> [<seite1.png>]  ← JSON: {"seiten", "text", "qr"}
import AppKit
import CoreImage
import Foundation
import PDFKit

let argumente = CommandLine.arguments
guard argumente.count >= 2, let dokument = PDFDocument(url: URL(fileURLWithPath: argumente[1])) else {
  print("{\"fehler\":\"PDF nicht lesbar\"}")
  exit(1)
}

var text = ""
var codes: [String] = []
let erkenner = CIDetector(ofType: CIDetectorTypeQRCode, context: nil, options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])

for i in 0..<dokument.pageCount {
  guard let seite = dokument.page(at: i) else { continue }
  text += (seite.string ?? "") + "\n"
  let rahmen = seite.bounds(for: .mediaBox)
  let bild = seite.thumbnail(of: NSSize(width: rahmen.width * 3, height: rahmen.height * 3), for: .mediaBox)
  guard let tiff = bild.tiffRepresentation, let ci = CIImage(data: tiff) else { continue }
  for f in erkenner?.features(in: ci) ?? [] {
    if let q = f as? CIQRCodeFeature, let inhalt = q.messageString { codes.append(inhalt) }
  }
  if i == 0, argumente.count >= 3, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) {
    try? png.write(to: URL(fileURLWithPath: argumente[2]))
  }
}

let ausgabe: [String: Any] = ["seiten": dokument.pageCount, "text": text, "qr": codes]
let daten = try JSONSerialization.data(withJSONObject: ausgabe)
print(String(data: daten, encoding: .utf8)!)
