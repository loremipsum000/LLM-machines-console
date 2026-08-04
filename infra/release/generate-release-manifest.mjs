import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const directory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(directory, "../..")
const sha1Pattern = /^[a-f0-9]{40}$/
const sha256Pattern = /^sha256:[a-f0-9]{64}$/
const versionPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/
const safePathPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

function sha256File(path) {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`
}

function fail(message) {
  throw new Error(message)
}

function assertDigest(value, field) {
  if (!sha256Pattern.test(value ?? "")) {
    fail(`${field} must be an exact SHA-256 digest`)
  }
}

export function generateReleaseManifest(input, root = repositoryRoot) {
  if (!versionPattern.test(input?.release?.version ?? "")) {
    fail("release.version must be a semantic release version")
  }
  if (!sha1Pattern.test(input?.release?.sourceCommit ?? "")) {
    fail("release.sourceCommit must be a full Git object ID")
  }
  if (!sha1Pattern.test(input?.release?.sourceTree ?? "")) {
    fail("release.sourceTree must be a full Git tree ID")
  }
  if (
    !Number.isInteger(input?.release?.sourceDateEpoch) ||
    input.release.sourceDateEpoch < 1
  ) {
    fail("release.sourceDateEpoch must be a positive integer")
  }
  const version = input.release.version
  const expectedName = `llm-machines-core-${version}-linux-amd64.tar.zst`
  if (input.release.artifactName !== expectedName) {
    fail("release.artifactName does not match the deterministic naming rule")
  }

  const artifacts = Array.isArray(input?.artifacts) ? input.artifacts : []
  if (artifacts.length === 0) {
    fail("at least one release artifact is required")
  }
  const sorted = [...artifacts].sort((left, right) =>
    Buffer.from(left.path ?? "").compare(Buffer.from(right.path ?? "")),
  )
  const paths = new Set()
  const normalizedArtifacts = []
  for (const artifact of sorted) {
    const pathSegments = (artifact?.path ?? "").split("/")
    if (
      !safePathPattern.test(artifact?.path ?? "") ||
      artifact.path.startsWith("/") ||
      artifact.path.endsWith("/") ||
      pathSegments.some(
        (segment) => segment === "" || segment === "." || segment === "..",
      )
    ) {
      fail(`unsafe artifact path: ${artifact?.path ?? "missing"}`)
    }
    if (paths.has(artifact.path)) {
      fail(`duplicate artifact path: ${artifact.path}`)
    }
    paths.add(artifact.path)
    if (!Number.isInteger(artifact.size) || artifact.size < 0) {
      fail(`artifact size is invalid: ${artifact.path}`)
    }
    assertDigest(artifact.sha256, `artifact ${artifact.path}`)
    if (
      typeof artifact.mediaType !== "string" ||
      artifact.mediaType.length < 3
    ) {
      fail(`artifact media type is invalid: ${artifact.path}`)
    }
    if (
      ![
        "core",
        "evidence",
        "license",
        "source",
        "installer",
        "rollback",
        "public-trust",
      ].includes(artifact.classification)
    ) {
      fail(`artifact classification is invalid: ${artifact.path}`)
    }
    normalizedArtifacts.push({
      path: artifact.path,
      size: artifact.size,
      sha256: artifact.sha256,
      mediaType: artifact.mediaType,
      classification: artifact.classification,
    })
  }

  const contracts = {
    releasePlanSha256: sha256File(
      resolve(root, "infra/release/release-plan.json"),
    ),
    coreImageInventorySha256: sha256File(
      resolve(root, "infra/release/core-image-inventory.json"),
    ),
    coreImageLockSha256: input?.contracts?.coreImageLockSha256,
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
  for (const [field, value] of Object.entries(contracts)) {
    assertDigest(value, `contracts.${field}`)
  }

  return {
    schema: "llm-machines.release-manifest.v1",
    status: "PACKAGED_UNQUALIFIED",
    release: {
      version,
      artifactName: expectedName,
      sourceCommit: input.release.sourceCommit,
      sourceTree: input.release.sourceTree,
      sourceDateEpoch: input.release.sourceDateEpoch,
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
      fail("expected --input PATH --output PATH")
    }
    values.set(flag, value)
  }
  if (values.size !== 2 || !values.has("--input") || !values.has("--output")) {
    fail("expected --input PATH --output PATH")
  }
  return values
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argumentsByName = parseArguments(process.argv.slice(2))
  const input = JSON.parse(
    readFileSync(resolve(argumentsByName.get("--input")), "utf8"),
  )
  const manifest = generateReleaseManifest(input)
  writeFileSync(
    resolve(argumentsByName.get("--output")),
    canonicalJson(manifest),
    {
      flag: "wx",
    },
  )
}
