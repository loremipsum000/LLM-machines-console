export const MAX_KNOWLEDGE_UPLOAD_FILE_BYTES = 50 * 1024 * 1024
export const MAX_KNOWLEDGE_UPLOAD_FILES = 5

export const SUPPORTED_KNOWLEDGE_UPLOAD_EXTENSIONS = [
  "pdf",
  "docx",
  "pptx",
  "txt",
  "md",
  "html",
  "csv",
  "tsv",
  "xlsx",
  "odt",
  "ods",
  "odp",
  "rtf",
  "eml",
  "msg",
  "epub",
  "json",
  "jsonl",
  "xml",
  "yaml",
  "yml",
  "jpg",
  "jpeg",
  "png",
  "tif",
  "tiff",
  "bmp",
  "webp",
] as const

export const KNOWLEDGE_UPLOAD_ACCEPT =
  SUPPORTED_KNOWLEDGE_UPLOAD_EXTENSIONS.map(
    (extension) => `.${extension}`,
  ).join(",")

const SUPPORTED_EXTENSION_SET = new Set<string>(
  SUPPORTED_KNOWLEDGE_UPLOAD_EXTENSIONS,
)

export interface KnowledgeUploadCandidate {
  name: string
  size: number
}

export interface KnowledgeUploadFileValidation {
  error: string | null
  extension: string
  name: string
  size: number
}

export interface KnowledgeUploadValidationResult {
  errors: string[]
  files: KnowledgeUploadFileValidation[]
  valid: boolean
}

export function validateKnowledgeUploadCandidates(
  files: KnowledgeUploadCandidate[],
): KnowledgeUploadValidationResult {
  const errors: string[] = []
  const validatedFiles = files.map((file) => validateKnowledgeUploadFile(file))

  if (files.length === 0) {
    errors.push("Select at least one document.")
  } else if (files.length > MAX_KNOWLEDGE_UPLOAD_FILES) {
    errors.push(`Select at most ${MAX_KNOWLEDGE_UPLOAD_FILES} documents.`)
  }

  for (const file of validatedFiles) {
    if (file.error) {
      errors.push(`${file.name}: ${file.error}`)
    }
  }

  return {
    errors,
    files: validatedFiles,
    valid: errors.length === 0,
  }
}

export function formatKnowledgeUploadSize(size: number): string {
  if (size < 1024) {
    return `${size} B`
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function validateKnowledgeUploadFile(
  file: KnowledgeUploadCandidate,
): KnowledgeUploadFileValidation {
  const extension = extensionForFileName(file.name)
  let error: string | null = null

  if (!extension || !SUPPORTED_EXTENSION_SET.has(extension)) {
    error = "Unsupported file type."
  } else if (file.size <= 0) {
    error = "File is empty."
  } else if (file.size > MAX_KNOWLEDGE_UPLOAD_FILE_BYTES) {
    error = `File exceeds ${formatKnowledgeUploadSize(
      MAX_KNOWLEDGE_UPLOAD_FILE_BYTES,
    )}.`
  }

  return {
    error,
    extension: extension || "unknown",
    name: file.name,
    size: file.size,
  }
}

function extensionForFileName(fileName: string): string | null {
  const lastDot = fileName.lastIndexOf(".")
  if (lastDot < 0 || lastDot === fileName.length - 1) {
    return null
  }
  return fileName.slice(lastDot + 1).toLowerCase()
}
