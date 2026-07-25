import { describe, expect, it } from "vitest"
import { validateSettingsLogoAsset } from "./admin-settings-validation"

describe("Settings logo validation", () => {
  it("accepts PNG and JPEG logo assets under 1 MiB", () => {
    expect(
      validateSettingsLogoAsset(pngLogo("logo.png", 320, 120), "full"),
    ).toMatchObject({ valid: true })
    expect(validateSettingsLogoAsset(jpegLogo("logo.jpg", 320, 120), "full"))
      .toMatchObject({ valid: true })
  })

  it("rejects unsupported or mismatched logo assets", () => {
    expect(
      validateSettingsLogoAsset(
        {
          ...pngLogo("logo.gif", 320, 120),
          mimeType: "image/gif",
        },
        "full",
      ),
    ).toMatchObject({ valid: false })
    expect(
      validateSettingsLogoAsset(
        {
          ...pngLogo("logo.png", 320, 120),
          dataUrl: jpegLogo("logo.jpg", 320, 120).dataUrl,
        },
        "full",
      ),
    ).toMatchObject({ valid: false })
  })

  it("rejects MIME spoofed non-image bytes", () => {
    expect(
      validateSettingsLogoAsset(
        {
          ...pngLogo("spoof.png", 1, 1),
          dataUrl: "data:image/png;base64,aGVsbG8=",
          sizeBytes: 5,
        },
        "full",
      ),
    ).toMatchObject({ valid: false })
  })

  it("rejects oversized logo assets", () => {
    expect(
      validateSettingsLogoAsset(
        {
          ...pngLogo("big-logo.png", 320, 120),
          sizeBytes: 1024 * 1024 + 1,
        },
        "full",
      ),
    ).toMatchObject({ valid: false })
  })

  it("rejects oversized decoded pixel dimensions", () => {
    expect(
      validateSettingsLogoAsset(pngLogo("huge-logo.png", 5000, 1000), "full"),
    ).toMatchObject({ valid: false })
  })

  it("requires the icon logo to be square", () => {
    expect(
      validateSettingsLogoAsset(
        pngLogo("icon.png", 120, 120),
        "icon",
      ),
    ).toMatchObject({ valid: true })
    expect(
      validateSettingsLogoAsset(
        pngLogo("wide-icon.png", 200, 100),
        "icon",
      ),
    ).toMatchObject({ valid: false })
  })

  it("normalizes decoded size, dimensions, data URL, and checksum before persistence", () => {
    const input = {
      ...pngLogo("metadata-spoof.png", 64, 32),
      checksum: "sha256:forged",
      height: 999,
      sizeBytes: 999,
      width: 999,
    }

    const result = validateSettingsLogoAsset(input, "full")

    expect(result).toMatchObject({
      valid: true,
      asset: {
        checksum: expect.not.stringContaining("forged"),
        height: 32,
        mimeType: "image/png",
        width: 64,
      },
    })
    expect(result.valid ? result.asset.sizeBytes : 0).toBe(
      minimalPng(64, 32).length,
    )
    expect(result.valid ? result.asset.dataUrl : "").toBe(
      `data:image/png;base64,${minimalPng(64, 32).toString("base64")}`,
    )
  })
})

function pngLogo(
  fileName: string,
  width = 320,
  height = 120,
) {
  const bytes = minimalPng(width, height)
  return {
    checksum: `sha256:${fileName}`,
    dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
    fileName,
    height,
    mimeType: "image/png" as const,
    sizeBytes: bytes.length,
    updatedAt: "2026-05-29T12:00:00.000Z",
    width,
  }
}

function jpegLogo(fileName: string, width = 320, height = 120) {
  const bytes = minimalJpeg(width, height)
  return {
    checksum: `sha256:${fileName}`,
    dataUrl: `data:image/jpeg;base64,${bytes.toString("base64")}`,
    fileName,
    height,
    mimeType: "image/jpeg" as const,
    sizeBytes: bytes.length,
    updatedAt: "2026-05-29T12:00:00.000Z",
    width,
  }
}

function minimalPng(width: number, height: number): Buffer {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ])
  const ihdr = Buffer.alloc(25)
  ihdr.writeUInt32BE(13, 0)
  ihdr.write("IHDR", 4, "ascii")
  ihdr.writeUInt32BE(width, 8)
  ihdr.writeUInt32BE(height, 12)
  ihdr[16] = 8
  ihdr[17] = 2
  ihdr[18] = 0
  ihdr[19] = 0
  ihdr[20] = 0
  const iend = Buffer.from([
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0x00, 0x00, 0x00, 0x00,
  ])
  return Buffer.concat([signature, ihdr, iend])
}

function minimalJpeg(width: number, height: number): Buffer {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0,
    0x00, 0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01, 0x11, 0x00,
    0x02, 0x11, 0x00,
    0x03, 0x11, 0x00,
    0xff, 0xd9,
  ])
}
