import test from "node:test"
import assert from "node:assert/strict"
import { detectExifMetadata, inspectImageBytes } from "../src/services/imageService.js"

function toArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

test("Server EXIF Rejection - Rejects JPEG containing APP1 Exif segment", () => {
  // JPEG Header (FF D8) + APP1 (FF E1 00 0A) + "Exif\0\0" + EOI (FF D9)
  const jpegWithExif = Buffer.from([
    0xff, 0xd8, 0xff, 0xe1, 0x00, 0x0a, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0xff, 0xd9,
  ])
  const ab = toArrayBuffer(jpegWithExif)

  const exifCheck = detectExifMetadata(ab)
  assert.equal(exifCheck.hasExif, true)

  const res = inspectImageBytes(ab)
  assert.equal(res.valid, false)
  assert.match(res.error, /EXIF_METADATA_PROHIBITED/)
})

test("Server EXIF Rejection - Rejects WebP containing EXIF chunk", () => {
  // RIFF WebP with 'EXIF' chunk
  const webpWithExif = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, // RIFF....WEBP
    0x45, 0x58, 0x49, 0x46, 0x04, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, // EXIF chunk
  ])
  const ab = toArrayBuffer(webpWithExif)

  const exifCheck = detectExifMetadata(ab)
  assert.equal(exifCheck.hasExif, true)

  const res = inspectImageBytes(ab)
  assert.equal(res.valid, false)
  assert.match(res.error, /EXIF_METADATA_PROHIBITED/)
})

test("Server EXIF Rejection - Accepts clean WebP without EXIF chunks", () => {
  const cleanWebp = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, // RIFF....WEBP
    0x56, 0x50, 0x38, 0x20, 0x00, 0x00, 0x00, 0x00,                         // VP8
  ])
  const ab = toArrayBuffer(cleanWebp)

  const res = inspectImageBytes(ab)
  assert.equal(res.valid, true)
  assert.equal(res.hasExif, false)
})
