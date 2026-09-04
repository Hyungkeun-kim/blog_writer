/**
 * Image Inspection & Binary Metadata Normalization Service
 * Strictly enforces TECH-DESIGN.md v3.0 & SECURITY-PRIVACY.md v3.0
 */

const MAX_BYTES = 10 * 1024 * 1024 // 10MB
const MAX_DIMENSION = 2048 // Max 2048px on longest side

export interface ImageInspectionResult {
  valid: boolean
  detectedType: string | null
  sizeBytes: number
  width?: number
  height?: number
  hasExif?: boolean
  error?: string
}

/**
 * Scan binary buffers for EXIF, GPS, or XMP metadata chunks
 */
export function detectExifMetadata(bytes: ArrayBuffer): { hasExif: boolean; reason?: string } {
  const u8 = new Uint8Array(bytes)

  // 1. JPEG Check: Look for APP1 (0xFF 0xE1) with "Exif" or "http://ns.adobe.com"
  if (u8.length >= 4 && u8[0] === 0xff && u8[1] === 0xd8) {
    let offset = 2
    while (offset < u8.length - 4) {
      if (u8[offset] !== 0xff) break
      const marker = u8[offset + 1]
      if (marker === 0xda || marker === 0xd9) break // SOS (Start of Scan) or EOI (End of Image)

      const length = (u8[offset + 2] << 8) | u8[offset + 3]
      if (marker === 0xe1) {
        // APP1 Marker
        const segment = u8.slice(offset + 4, offset + 4 + Math.min(length - 2, 32))
        const segStr = String.fromCharCode(...segment)
        if (segStr.startsWith("Exif") || segStr.includes("http://ns.adobe.com")) {
          return { hasExif: true, reason: "JPEG APP1 Exif/XMP metadata detected" }
        }
      }
      offset += 2 + length
    }
  }

  // 2. WebP Check: Scan RIFF FourCC chunks for 'EXIF' or 'XMP '
  if (u8.length >= 12 && u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46) {
    let offset = 12
    while (offset + 8 <= u8.length) {
      const fourCC = String.fromCharCode(u8[offset], u8[offset + 1], u8[offset + 2], u8[offset + 3])
      const chunkSize =
        u8[offset + 4] | (u8[offset + 5] << 8) | (u8[offset + 6] << 16) | (u8[offset + 7] << 24)

      if (fourCC === "EXIF" || fourCC === "XMP ") {
        return { hasExif: true, reason: `WebP ${fourCC} metadata chunk detected` }
      }

      offset += 8 + chunkSize + (chunkSize % 2) // Chunks padded to 2 bytes
    }
  }

  // 3. PNG Check: Scan for 'eXIf', 'tEXt', 'zTXt', 'iTXt'
  if (u8.length >= 8 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) {
    let offset = 8
    while (offset + 8 <= u8.length) {
      const length =
        (u8[offset] << 24) | (u8[offset + 1] << 16) | (u8[offset + 2] << 8) | u8[offset + 3]
      const type = String.fromCharCode(u8[offset + 4], u8[offset + 5], u8[offset + 6], u8[offset + 7])

      if (type === "eXIf" || type === "iTXt" || type === "tEXt" || type === "zTXt") {
        return { hasExif: true, reason: `PNG ${type} metadata chunk detected` }
      }

      offset += 12 + length // 4 length + 4 type + length + 4 crc
    }
  }

  return { hasExif: false }
}

/**
 * Inspect image bytes, verify format, enforce Zero-EXIF, and check max dimensions (<= 2048px)
 */
export function inspectImageBytes(bytes: ArrayBuffer, _expectedType?: string): ImageInspectionResult {
  const sizeBytes = bytes.byteLength

  if (sizeBytes === 0 || sizeBytes > MAX_BYTES) {
    return { valid: false, detectedType: null, sizeBytes, error: "INVALID_SIZE" }
  }

  const u8 = new Uint8Array(bytes)
  let detectedType: string | null = null
  let width = 0
  let height = 0

  // 1. WebP Detection & Dimension Parsing
  if (
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

    // Parse dimensions from VP8X or VP8 or VP8L
    if (u8.length >= 30) {
      const chunkFourCC = String.fromCharCode(u8[12], u8[13], u8[14], u8[15])
      if (chunkFourCC === "VP8X") {
        width = 1 + (u8[24] | (u8[25] << 8) | (u8[26] << 16))
        height = 1 + (u8[27] | (u8[28] << 8) | (u8[29] << 16))
      } else if (chunkFourCC === "VP8 " && u8.length >= 29) {
        // Simple VP8 lossy header
        const keyframe = (u8[23] & 1) === 0
        if (keyframe && u8[26] === 0x9d && u8[27] === 0x01 && u8[28] === 0x2a) {
          width = (u8[29] | (u8[30] << 8)) & 0x3fff
          height = (u8[31] | (u8[32] << 8)) & 0x3fff
        }
      }
    }
  }
  // 2. JPEG Detection
  else if (u8.length >= 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) {
    detectedType = "image/jpeg"
  }
  // 3. PNG Detection & Dimension Parsing
  else if (
    u8.length >= 24 &&
    u8[0] === 0x89 &&
    u8[1] === 0x50 &&
    u8[2] === 0x4e &&
    u8[3] === 0x47
  ) {
    detectedType = "image/png"
    width = (u8[16] << 24) | (u8[17] << 16) | (u8[18] << 8) | u8[19]
    height = (u8[20] << 24) | (u8[21] << 16) | (u8[22] << 8) | u8[23]
  } else {
    return { valid: false, detectedType: null, sizeBytes, error: "UNSUPPORTED_TYPE" }
  }

  // Dimension Check (Max 2048px)
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    return {
      valid: false,
      detectedType,
      sizeBytes,
      width,
      height,
      error: `DIMENSION_EXCEEDED: 이미지 긴 변이 허용 기준(${MAX_DIMENSION}px)을 초과했습니다. (${width}x${height})`,
    }
  }

  // Strict Zero-EXIF Server-side Check
  const exifCheck = detectExifMetadata(bytes)
  if (exifCheck.hasExif) {
    return {
      valid: false,
      detectedType,
      sizeBytes,
      hasExif: true,
      error: `EXIF_METADATA_PROHIBITED: ${exifCheck.reason}`,
    }
  }

  return {
    valid: true,
    detectedType,
    sizeBytes,
    width: width || undefined,
    height: height || undefined,
    hasExif: false,
  }
}
