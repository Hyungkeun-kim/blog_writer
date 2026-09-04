const MAX_BYTES = 10 * 1024 * 1024;
const MAX_DIMENSION = 2048;
function detectExifMetadata(bytes) {
  const u8 = new Uint8Array(bytes);
  if (u8.length >= 4 && u8[0] === 255 && u8[1] === 216) {
    let offset = 2;
    while (offset < u8.length - 4) {
      if (u8[offset] !== 255)
        break;
      const marker = u8[offset + 1];
      if (marker === 218 || marker === 217)
        break;
      const length = u8[offset + 2] << 8 | u8[offset + 3];
      if (marker === 225) {
        const segment = u8.slice(offset + 4, offset + 4 + Math.min(length - 2, 32));
        const segStr = String.fromCharCode(...segment);
        if (segStr.startsWith("Exif") || segStr.includes("http://ns.adobe.com")) {
          return { hasExif: true, reason: "JPEG APP1 Exif/XMP metadata detected" };
        }
      }
      offset += 2 + length;
    }
  }
  if (u8.length >= 12 && u8[0] === 82 && u8[1] === 73 && u8[2] === 70 && u8[3] === 70) {
    let offset = 12;
    while (offset + 8 <= u8.length) {
      const fourCC = String.fromCharCode(u8[offset], u8[offset + 1], u8[offset + 2], u8[offset + 3]);
      const chunkSize = u8[offset + 4] | u8[offset + 5] << 8 | u8[offset + 6] << 16 | u8[offset + 7] << 24;
      if (fourCC === "EXIF" || fourCC === "XMP ") {
        return { hasExif: true, reason: `WebP ${fourCC} metadata chunk detected` };
      }
      offset += 8 + chunkSize + chunkSize % 2;
    }
  }
  if (u8.length >= 8 && u8[0] === 137 && u8[1] === 80 && u8[2] === 78 && u8[3] === 71) {
    let offset = 8;
    while (offset + 8 <= u8.length) {
      const length = u8[offset] << 24 | u8[offset + 1] << 16 | u8[offset + 2] << 8 | u8[offset + 3];
      const type = String.fromCharCode(u8[offset + 4], u8[offset + 5], u8[offset + 6], u8[offset + 7]);
      if (type === "eXIf" || type === "iTXt" || type === "tEXt" || type === "zTXt") {
        return { hasExif: true, reason: `PNG ${type} metadata chunk detected` };
      }
      offset += 12 + length;
    }
  }
  return { hasExif: false };
}
function inspectImageBytes(bytes, _expectedType) {
  const sizeBytes = bytes.byteLength;
  if (sizeBytes === 0 || sizeBytes > MAX_BYTES) {
    return { valid: false, detectedType: null, sizeBytes, error: "INVALID_SIZE" };
  }
  const u8 = new Uint8Array(bytes);
  let detectedType = null;
  let width = 0;
  let height = 0;
  if (u8.length >= 12 && u8[0] === 82 && u8[1] === 73 && u8[2] === 70 && u8[3] === 70 && u8[8] === 87 && u8[9] === 69 && u8[10] === 66 && u8[11] === 80) {
    detectedType = "image/webp";
    if (u8.length >= 30) {
      const chunkFourCC = String.fromCharCode(u8[12], u8[13], u8[14], u8[15]);
      if (chunkFourCC === "VP8X") {
        width = 1 + (u8[24] | u8[25] << 8 | u8[26] << 16);
        height = 1 + (u8[27] | u8[28] << 8 | u8[29] << 16);
      } else if (chunkFourCC === "VP8 " && u8.length >= 29) {
        const keyframe = (u8[23] & 1) === 0;
        if (keyframe && u8[26] === 157 && u8[27] === 1 && u8[28] === 42) {
          width = (u8[29] | u8[30] << 8) & 16383;
          height = (u8[31] | u8[32] << 8) & 16383;
        }
      }
    }
  } else if (u8.length >= 3 && u8[0] === 255 && u8[1] === 216 && u8[2] === 255) {
    detectedType = "image/jpeg";
  } else if (u8.length >= 24 && u8[0] === 137 && u8[1] === 80 && u8[2] === 78 && u8[3] === 71) {
    detectedType = "image/png";
    width = u8[16] << 24 | u8[17] << 16 | u8[18] << 8 | u8[19];
    height = u8[20] << 24 | u8[21] << 16 | u8[22] << 8 | u8[23];
  } else {
    return { valid: false, detectedType: null, sizeBytes, error: "UNSUPPORTED_TYPE" };
  }
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    return {
      valid: false,
      detectedType,
      sizeBytes,
      width,
      height,
      error: `DIMENSION_EXCEEDED: \uC774\uBBF8\uC9C0 \uAE34 \uBCC0\uC774 \uD5C8\uC6A9 \uAE30\uC900(${MAX_DIMENSION}px)\uC744 \uCD08\uACFC\uD588\uC2B5\uB2C8\uB2E4. (${width}x${height})`
    };
  }
  const exifCheck = detectExifMetadata(bytes);
  if (exifCheck.hasExif) {
    return {
      valid: false,
      detectedType,
      sizeBytes,
      hasExif: true,
      error: `EXIF_METADATA_PROHIBITED: ${exifCheck.reason}`
    };
  }
  return {
    valid: true,
    detectedType,
    sizeBytes,
    width: width || void 0,
    height: height || void 0,
    hasExif: false
  };
}
export {
  detectExifMetadata,
  inspectImageBytes
};
