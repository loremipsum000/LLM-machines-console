import { createHash } from "node:crypto"
import {
  adminSettingsLogoAssetSchema,
  type AdminSettingsLogoAsset,
} from "@llm-machines/contracts/inference-core"

const maxLogoBytes = 1024 * 1024
const maxLogoPixels = 4_000_000

const logoDataUrlPrefixByMimeType = {
  "image/jpeg": "data:image/jpeg;base64,",
  "image/png": "data:image/png;base64,",
} as const

export type SettingsLogoKind = "full" | "icon"

export type SettingsLogoValidationResult =
  | { asset: AdminSettingsLogoAsset; valid: true }
  | { detail: string; valid: false }
type LogoDimensionsResult =
  | { height: number; valid: true; width: number }
  | { detail: string; valid: false }

export function validateSettingsLogoAsset(
  value: unknown,
  kind: SettingsLogoKind,
): SettingsLogoValidationResult {
  const parsed = adminSettingsLogoAssetSchema.safeParse(value)
  if (!parsed.success) {
    return {
      valid: false,
      detail: "Logo must be a PNG or JPEG asset at or below 1 MiB.",
    }
  }

  const asset = parsed.data
  const requiredPrefix = logoDataUrlPrefixByMimeType[asset.mimeType]
  if (!asset.dataUrl.startsWith(requiredPrefix)) {
    return {
      valid: false,
      detail: "Logo data URL must match the declared MIME type.",
    }
  }

  const payload = asset.dataUrl.slice(requiredPrefix.length)
  if (!isBase64Payload(payload)) {
    return {
      valid: false,
      detail: "Logo data URL must contain base64-encoded image content.",
    }
  }

  const decoded = Buffer.from(payload, "base64")
  if (decoded.length === 0 || decoded.length > maxLogoBytes) {
    return {
      valid: false,
      detail: "Logo image content must be at or below 1 MiB.",
    }
  }

  const dimensions = dimensionsFromLogoBytes(decoded, asset.mimeType)
  if (!dimensions.valid) {
    return dimensions
  }
  if (dimensions.width * dimensions.height > maxLogoPixels) {
    return {
      valid: false,
      detail: "Logo pixel dimensions are too large.",
    }
  }

  if (kind === "icon" && dimensions.width !== dimensions.height) {
    return {
      valid: false,
      detail: "Icon logo must use a 1:1 aspect ratio.",
    }
  }

  return {
    asset: {
      ...asset,
      checksum: `sha256:${createHash("sha256").update(decoded).digest("hex")}`,
      dataUrl: `${requiredPrefix}${decoded.toString("base64")}`,
      height: dimensions.height,
      sizeBytes: decoded.length,
      width: dimensions.width,
    },
    valid: true,
  }
}

function isBase64Payload(value: string): boolean {
  if (!value || value.length % 4 !== 0) {
    return false
  }
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value)
}

function dimensionsFromLogoBytes(
  bytes: Buffer,
  mimeType: AdminSettingsLogoAsset["mimeType"],
): LogoDimensionsResult {
  return mimeType === "image/png"
    ? pngDimensions(bytes)
    : jpegDimensions(bytes)
}

function pngDimensions(bytes: Buffer): LogoDimensionsResult {
  if (
    bytes.length < 33 ||
    bytes.compare(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 0, 8, 0, 8) !==
      0 ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.toString("ascii", 12, 16) !== "IHDR"
  ) {
    return {
      valid: false,
      detail: "PNG logo must contain a valid PNG signature and IHDR header.",
    }
  }

  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  if (width <= 0 || height <= 0) {
    return {
      valid: false,
      detail: "Logo image dimensions must be positive.",
    }
  }

  if (!pngEndsWithIend(bytes)) {
    return {
      valid: false,
      detail: "PNG logo must end with an IEND chunk.",
    }
  }

  return { height, valid: true, width }
}

function pngEndsWithIend(bytes: Buffer): boolean {
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const typeOffset = offset + 4
    const dataOffset = typeOffset + 4
    const nextOffset = dataOffset + length + 4
    if (nextOffset > bytes.length) {
      return false
    }
    const type = bytes.toString("ascii", typeOffset, dataOffset)
    if (type === "IEND") {
      return nextOffset === bytes.length
    }
    offset = nextOffset
  }
  return false
}

function jpegDimensions(bytes: Buffer): LogoDimensionsResult {
  if (
    bytes.length < 4 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[bytes.length - 2] !== 0xff ||
    bytes[bytes.length - 1] !== 0xd9
  ) {
    return {
      valid: false,
      detail: "JPEG logo must contain valid JPEG SOI and EOI markers.",
    }
  }

  let offset = 2
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      return {
        valid: false,
        detail: "JPEG logo contains an invalid marker sequence.",
      }
    }

    let marker = bytes[offset + 1]
    offset += 2
    while (marker === 0xff && offset < bytes.length) {
      marker = bytes[offset]
      offset += 1
    }
    if (marker === 0xd9) {
      break
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      continue
    }
    if (offset + 2 > bytes.length) {
      break
    }
    const segmentLength = bytes.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      return {
        valid: false,
        detail: "JPEG logo contains an invalid segment length.",
      }
    }
    if (isJpegStartOfFrame(marker)) {
      if (segmentLength < 7) {
        return {
          valid: false,
          detail: "JPEG logo contains an invalid frame header.",
        }
      }
      const height = bytes.readUInt16BE(offset + 3)
      const width = bytes.readUInt16BE(offset + 5)
      if (width <= 0 || height <= 0) {
        return {
          valid: false,
          detail: "Logo image dimensions must be positive.",
        }
      }
      return { height, valid: true, width }
    }
    offset += segmentLength
  }

  return {
    valid: false,
    detail: "JPEG logo must contain a valid dimensions frame.",
  }
}

function isJpegStartOfFrame(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  )
}
