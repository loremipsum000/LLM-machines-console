import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  lstatSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { dirname, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import {
  readCoreImageInventory,
  validateCoreImageLock,
} from "./validate-image-lock.mjs"

const directory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(directory, "../..")
const sha1Pattern = /^[a-f0-9]{40}$/
const versionPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/
const safePathPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/
const mutablePathPattern = /(?:^|[._/-])latest(?:$|[._/-])/i
const classifications = new Set([
  "core",
  "evidence",
  "license",
  "source",
  "installer",
  "rollback",
  "public-trust",
])

function sha256File(path) {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`
}

function fail(message) {
  throw new Error(message)
}

function exactKeys(value, expected, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${field} must be an object`)
  }
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail(`${field} keys must be exactly ${wanted.join(", ")}`)
  }
}

function validateSafePath(path, field = "artifact") {
  const segments = (path ?? "").split("/")
  if (
    !safePathPattern.test(path ?? "") ||
    path.startsWith("/") ||
    path.endsWith("/") ||
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    fail(`unsafe ${field} path: ${path ?? "missing"}`)
  }
  if (mutablePathPattern.test(path)) {
    fail(`mutable ${field} path: ${path}`)
  }
}

function toPortablePath(path) {
  return path.split(sep).join("/")
}

function listArtifactFiles(root, current = root) {
  const files = []
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const absolute = resolve(current, entry.name)
    const relativePath = toPortablePath(relative(root, absolute))
    if (entry.isSymbolicLink()) {
      fail(`unsafe symbolic-link artifact: ${relativePath}`)
    }
    if (entry.isDirectory()) {
      files.push(...listArtifactFiles(root, absolute))
    } else if (entry.isFile()) {
      const metadata = lstatSync(absolute)
      if (metadata.nlink !== 1) {
        fail(`unsafe hard-linked artifact: ${relativePath}`)
      }
      files.push(relativePath)
    } else {
      fail(`unsafe non-regular artifact: ${relativePath}`)
    }
  }
  return files.sort((left, right) =>
    Buffer.from(left).compare(Buffer.from(right)),
  )
}

function readGitIdentity(root) {
  const git = (...arguments_) =>
    execFileSync("git", ["-C", root, ...arguments_], {
      encoding: "utf8",
    }).trim()
  if (git("status", "--porcelain=v1", "--untracked-files=all") !== "") {
    fail("checked-out release input must be a clean Git worktree")
  }
  return {
    sourceCommit: git("rev-parse", "HEAD^{commit}"),
    sourceTree: git("rev-parse", "HEAD^{tree}"),
    sourceDateEpoch: Number.parseInt(
      git("show", "-s", "--format=%ct", "HEAD"),
      10,
    ),
  }
}

function readJson(path, field) {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    fail(`${field} is not valid JSON`)
  }
}

export function generateReleaseManifest(
  input,
  { root = repositoryRoot, artifactRoot } = {},
) {
  exactKeys(input, ["release", "artifacts"], "manifest input")
  exactKeys(
    input.release,
    [
      "version",
      "artifactName",
      "sourceCommit",
      "sourceTree",
      "sourceDateEpoch",
    ],
    "manifest release input",
  )
  if (!artifactRoot) fail("artifactRoot is required")
  if (!versionPattern.test(input.release.version ?? "")) {
    fail("release.version must be a semantic release version")
  }
  const version = input.release.version
  const expectedName = `llm-machines-core-${version}-linux-amd64.tar.zst`
  if (input.release.artifactName !== expectedName) {
    fail("release.artifactName does not match the deterministic naming rule")
  }

  const gitIdentity = readGitIdentity(root)
  if (
    !sha1Pattern.test(input.release.sourceCommit ?? "") ||
    input.release.sourceCommit !== gitIdentity.sourceCommit
  ) {
    fail("release.sourceCommit does not match the checked-out release input")
  }
  if (
    !sha1Pattern.test(input.release.sourceTree ?? "") ||
    input.release.sourceTree !== gitIdentity.sourceTree
  ) {
    fail("release.sourceTree does not match the checked-out release input")
  }
  if (
    !Number.isInteger(input.release.sourceDateEpoch) ||
    input.release.sourceDateEpoch !== gitIdentity.sourceDateEpoch
  ) {
    fail("release.sourceDateEpoch does not match the checked-out release input")
  }

  const planPath = resolve(root, "infra/release/release-plan.json")
  const plan = readJson(planPath, "release plan")
  const requiredEvidence = Array.isArray(plan?.requiredEvidence)
    ? plan.requiredEvidence
    : fail("release plan requiredEvidence is invalid")
  if (new Set(requiredEvidence).size !== requiredEvidence.length) {
    fail("release plan contains duplicate evidence identifiers")
  }

  const declarations = Array.isArray(input.artifacts) ? input.artifacts : []
  if (declarations.length === 0)
    fail("at least one release artifact is required")
  const paths = new Set()
  const ids = new Set()
  const evidenceIds = new Set()
  for (const declaration of declarations) {
    exactKeys(
      declaration,
      ["id", "evidenceId", "path", "mediaType", "classification"],
      "artifact declaration",
    )
    validateSafePath(declaration.path)
    if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(declaration.id ?? "")) {
      fail(`artifact ID is invalid: ${declaration.id ?? "missing"}`)
    }
    if (ids.has(declaration.id))
      fail(`duplicate artifact ID: ${declaration.id}`)
    if (paths.has(declaration.path))
      fail(`duplicate artifact path: ${declaration.path}`)
    ids.add(declaration.id)
    paths.add(declaration.path)
    if (declaration.evidenceId !== null) {
      if (!requiredEvidence.includes(declaration.evidenceId)) {
        fail(`extra evidence declaration: ${declaration.evidenceId}`)
      }
      if (evidenceIds.has(declaration.evidenceId)) {
        fail(`duplicate evidence declaration: ${declaration.evidenceId}`)
      }
      evidenceIds.add(declaration.evidenceId)
    }
    if (
      typeof declaration.mediaType !== "string" ||
      declaration.mediaType.length < 3
    ) {
      fail(`artifact media type is invalid: ${declaration.path}`)
    }
    if (!classifications.has(declaration.classification)) {
      fail(`artifact classification is invalid: ${declaration.path}`)
    }
  }
  for (const evidenceId of requiredEvidence) {
    if (!evidenceIds.has(evidenceId)) {
      fail(`missing required evidence declaration: ${evidenceId}`)
    }
  }
  const corePackage = declarations.find(({ id }) => id === "core-package")
  if (
    corePackage?.evidenceId !== null ||
    corePackage?.classification !== "core" ||
    corePackage?.path !== `core/${expectedName}`
  ) {
    fail("the deterministic Core package artifact is missing or invalid")
  }
  if (
    declarations.filter(({ evidenceId }) => evidenceId === null).length !== 1
  ) {
    fail("only the deterministic Core package may omit an evidence identifier")
  }

  const artifactDirectory = resolve(artifactRoot)
  const actualFiles = listArtifactFiles(artifactDirectory)
  const declaredFiles = [...paths].sort((left, right) =>
    Buffer.from(left).compare(Buffer.from(right)),
  )
  for (const path of actualFiles) {
    if (!paths.has(path)) fail(`untracked artifact file: ${path}`)
  }
  for (const path of declaredFiles) {
    if (!actualFiles.includes(path)) fail(`missing artifact file: ${path}`)
  }

  const sorted = [...declarations].sort((left, right) =>
    Buffer.from(left.path).compare(Buffer.from(right.path)),
  )
  const normalizedArtifacts = sorted.map((declaration) => {
    const absolute = resolve(artifactDirectory, declaration.path)
    const metadata = statSync(absolute)
    return {
      id: declaration.id,
      evidenceId: declaration.evidenceId,
      path: declaration.path,
      size: metadata.size,
      sha256: sha256File(absolute),
      mediaType: declaration.mediaType,
      classification: declaration.classification,
    }
  })

  const coreLockDeclaration = declarations.find(
    ({ evidenceId }) => evidenceId === "core-image-lock",
  )
  const coreLockPath = resolve(artifactDirectory, coreLockDeclaration.path)
  const coreLock = readJson(coreLockPath, "Core image lock")
  let coreLockErrors
  try {
    coreLockErrors = validateCoreImageLock(
      coreLock,
      readCoreImageInventory(root),
      root,
    )
  } catch {
    fail("Core image lock is malformed")
  }
  if (coreLockErrors.length > 0) {
    fail(`Core image lock is invalid: ${coreLockErrors.join("; ")}`)
  }
  if (
    coreLock.release.sourceCommit !== gitIdentity.sourceCommit ||
    coreLock.release.sourceTree !== gitIdentity.sourceTree ||
    coreLock.release.version !== version
  ) {
    fail("Core image lock does not bind the checked-out release input")
  }

  const contracts = {
    releasePlanSha256: sha256File(planPath),
    coreImageInventorySha256: sha256File(
      resolve(root, "infra/release/core-image-inventory.json"),
    ),
    coreImageLockSha256: sha256File(coreLockPath),
    deliveryProfileSchemaSha256: sha256File(
      resolve(root, "infra/inference/delivery-profile.schema.json"),
    ),
    inferenceArtifactLockSchemaSha256: sha256File(
      resolve(root, "infra/release/inference-artifact-lock.schema.json"),
    ),
    firecrawlSourcePackageSha256: sha256File(
      resolve(root, "infra/firecrawl/release/source-package.json"),
    ),
  }

  return {
    schema: "llm-machines.release-manifest.v1",
    status: "PACKAGED_UNQUALIFIED",
    release: {
      version,
      artifactName: expectedName,
      sourceCommit: gitIdentity.sourceCommit,
      sourceTree: gitIdentity.sourceTree,
      sourceDateEpoch: gitIdentity.sourceDateEpoch,
      platform: "linux/amd64",
    },
    contracts,
    artifacts: normalizedArtifacts,
    qualification: {
      runtimeQualified: false,
      q0: "NOT_STARTED",
      contractActivation: "INACTIVE",
    },
  }
}

export function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!flag?.startsWith("--") || value === undefined) {
      fail("expected --input PATH --artifact-root PATH --output PATH")
    }
    values.set(flag, value)
  }
  if (
    values.size !== 3 ||
    !values.has("--input") ||
    !values.has("--artifact-root") ||
    !values.has("--output")
  ) {
    fail("expected --input PATH --artifact-root PATH --output PATH")
  }
  return values
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argumentsByName = parseArguments(process.argv.slice(2))
  const input = JSON.parse(
    readFileSync(resolve(argumentsByName.get("--input")), "utf8"),
  )
  const manifest = generateReleaseManifest(input, {
    artifactRoot: resolve(argumentsByName.get("--artifact-root")),
  })
  writeFileSync(
    resolve(argumentsByName.get("--output")),
    canonicalJson(manifest),
    { flag: "wx" },
  )
}
