export function normalizeConsoleReturnPath(
  value: string | null | undefined,
): string {
  if (!value || !safeReturnShape(value) || unsafePathSyntax(value)) {
    return "/"
  }
  try {
    const url = new URL(value, "https://console.invalid")
    const canonical = `${url.pathname}${url.search}${url.hash}`
    return url.origin === "https://console.invalid" &&
      safeReturnShape(canonical) &&
      !unsafePathSyntax(canonical)
      ? canonical
      : "/"
  } catch {
    return "/"
  }
}

function safeReturnShape(value: string): boolean {
  return (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    !/%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value) &&
    !hasAsciiControl(value)
  )
}

function unsafePathSyntax(value: string): boolean {
  const path = value.split(/[?#]/, 1)[0] ?? ""
  if (/%(?:2f|5c)/i.test(path)) {
    return true
  }
  return path.split("/").some((segment) => {
    try {
      const decoded = decodeURIComponent(segment)
      return decoded === "." || decoded === ".."
    } catch {
      return true
    }
  })
}

function hasAsciiControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) {
      return true
    }
  }
  return false
}
