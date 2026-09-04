import test from "node:test"
import assert from "node:assert/strict"

function inspectImageBytes(bytes) {
  const sizeBytes = bytes.byteLength
  const MAX_BYTES = 10 * 1024 * 1024

  if (sizeBytes === 0 || sizeBytes > MAX_BYTES) {
    return { valid: false, detectedType: null, sizeBytes, error: "INVALID_SIZE" }
  }

  const u8 = new Uint8Array(bytes)
  let detectedType = null

  // JPEG Check: FF D8 FF
  if (u8.length >= 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) {
    detectedType = "image/jpeg"
  }
  // PNG Check: 89 50 4E 47
  else if (u8.length >= 8 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) {
    detectedType = "image/png"
  }
  // WebP Check: RIFF....WEBP
  else if (
    u8.length >= 12 &&
    u8[0] === 0x52 &&
    u8[1] === 0x49 &&
    u8[2] === 0x46 &&
    u8[3] === 0x46 &&
    u8[8] === 0x57 &&
    u8[9] === 0x45 &&
    u8[10] === 0x42 &&
    u8[11] === 0x50
  ) {
    detectedType = "image/webp"
  } else {
    return { valid: false, detectedType: null, sizeBytes, error: "UNSUPPORTED_TYPE" }
  }

  return { valid: true, detectedType, sizeBytes }
}

test("Image Preprocessing - Valid WebP Byte Detection", () => {
  // RIFF (4) + size (4) + WEBP (4)
  const webpHeader = new Uint8Array([
    0x52, 0x49, 0x46, 0x46,
    0x20, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x20
  ])
  const res = inspectImageBytes(webpHeader.buffer)
  assert.equal(res.valid, true)
  assert.equal(res.detectedType, "image/webp")
})

test("Image Preprocessing - Valid JPEG Byte Detection", () => {
  const jpegHeader = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
  const res = inspectImageBytes(jpegHeader.buffer)
  assert.equal(res.valid, true)
  assert.equal(res.detectedType, "image/jpeg")
})

test("Image Preprocessing - Reject Non-image or Unknown Binary", () => {
  const exeHeader = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00])
  const res = inspectImageBytes(exeHeader.buffer)
  assert.equal(res.valid, false)
  assert.equal(res.error, "UNSUPPORTED_TYPE")
})

test("Image Preprocessing - Reject 0 byte or oversized file", () => {
  const empty = new ArrayBuffer(0)
  assert.equal(inspectImageBytes(empty).error, "INVALID_SIZE")

  const oversized = new ArrayBuffer(11 * 1024 * 1024)
  assert.equal(inspectImageBytes(oversized).error, "INVALID_SIZE")
})
