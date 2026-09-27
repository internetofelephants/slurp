// Contact sheet of exact video frames.
// usage: swift sheet.swift <video> <out.png> <t0> <t1> <step> <cols> <tileW> [cropX cropY cropW cropH (fractions)]
import AVFoundation
import CoreGraphics
import CoreText
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
let url = URL(fileURLWithPath: args[1])
let out = URL(fileURLWithPath: args[2])
let t0 = Double(args[3])!, t1 = Double(args[4])!, step = Double(args[5])!
let cols = Int(args[6])!, tileW = Int(args[7])!
let crop = args.count >= 12 ? (Double(args[8])!, Double(args[9])!, Double(args[10])!, Double(args[11])!) : (0.0, 0.0, 1.0, 1.0)

let asset = AVURLAsset(url: url)
let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.requestedTimeToleranceBefore = .zero
gen.requestedTimeToleranceAfter = .zero

var times: [Double] = []
var t = t0
while t <= t1 + 1e-6 { times.append(t); t += step }

var tileH = 0
var frames: [(Double, CGImage)] = []
for tt in times {
    let img = try gen.copyCGImage(at: CMTime(seconds: tt, preferredTimescale: 600), actualTime: nil)
    let cx = Int(Double(img.width) * crop.0), cy = Int(Double(img.height) * crop.1)
    let cw = Int(Double(img.width) * crop.2), ch = Int(Double(img.height) * crop.3)
    let c = img.cropping(to: CGRect(x: cx, y: cy, width: cw, height: ch))!
    tileH = Int(Double(tileW) * Double(ch) / Double(cw))
    frames.append((tt, c))
}

let rows = (frames.count + cols - 1) / cols
let W = cols * tileW, H = rows * tileH
let ctx = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: 0,
                    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))
let font = CTFontCreateWithName("Helvetica-Bold" as CFString, 13, nil)
for (i, (tt, img)) in frames.enumerated() {
    let x = (i % cols) * tileW
    let y = H - (i / cols + 1) * tileH  // CG origin is bottom-left
    ctx.draw(img, in: CGRect(x: x, y: y, width: tileW, height: tileH))
    ctx.setStrokeColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1)); ctx.setLineWidth(2)
    ctx.stroke(CGRect(x: x, y: y, width: tileW, height: tileH))
    ctx.setFillColor(CGColor(red: 0, green: 0, blue: 0, alpha: 1))
    ctx.fill(CGRect(x: x + 2, y: y + tileH - 18, width: 44, height: 16))
    let attr = [kCTFontAttributeName: font, kCTForegroundColorAttributeName: CGColor(red: 1, green: 1, blue: 0, alpha: 1)] as CFDictionary
    let line = CTLineCreateWithAttributedString(CFAttributedStringCreate(nil, String(format: "%.2f", tt) as CFString, attr))
    ctx.textPosition = CGPoint(x: x + 5, y: y + tileH - 14)
    CTLineDraw(line, ctx)
}
let dest = CGImageDestinationCreateWithURL(out as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, ctx.makeImage()!, nil)
CGImageDestinationFinalize(dest)
print("\(frames.count) frames, \(W)x\(H)")
