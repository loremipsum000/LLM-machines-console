import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)))
const classificationPath = "infra/genesis/source-classification.json"
const transformsPath = "infra/genesis/source-transforms.json"
const archivePrefix = "llm-machines-product/"
const forbiddenIdentityPattern = new RegExp(["co", "dex"].join(""), "i")
const blockedGeneratedPathParts = new Set([
  ".next",
  ".pnpm-store",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
])
const blockedExtensions = new Set([
  ".gguf",
  ".onnx",
  ".p12",
  ".pem",
  ".safetensors",
])

function fail(message) {
  throw new Error(`Genesis source generation failed: ${message}`)
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function git(root, arguments_, options = {}) {
  try {
    return execFileSync("git", arguments_, {
      cwd: root,
      encoding: options.encoding ?? "utf8",
      env: options.env,
      input: options.input,
      maxBuffer: 128 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    })
  } catch (error) {
    const detail = error?.stderr?.toString().trim()
    fail(
      detail
        ? `Git rejected the source input: ${detail}`
        : "Git rejected the source input",
    )
  }
}

function comparePaths(left, right) {
  return Buffer.from(left).compare(Buffer.from(right))
}

function parseTree(root, commit) {
  const output = git(
    root,
    ["ls-tree", "-r", "-z", "--full-tree", "--end-of-options", commit],
    { encoding: "buffer" },
  )
  return output
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const separator = record.indexOf("\t")
      if (separator < 0) fail("Git returned a malformed tree entry")
      const [mode, type, objectId] = record.slice(0, separator).split(" ")
      const path = record.slice(separator + 1)
      if (
        !["100644", "100755", "120000", "160000"].includes(mode) ||
        !["blob", "commit"].includes(type) ||
        !/^[0-9a-f]{40,64}$/.test(objectId) ||
        path.length === 0
      ) {
        fail(`unsupported Git tree entry: ${path}`)
      }
      return { mode, objectId, path, type }
    })
    .sort((left, right) => comparePaths(left.path, right.path))
}

function validateSafePath(path) {
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    fail(`unsafe tracked path: ${path}`)
  }
  if (path.split("/").some((part) => blockedGeneratedPathParts.has(part))) {
    fail(`generated or cached path cannot enter Genesis: ${path}`)
  }
  const extension = path.slice(path.lastIndexOf(".")).toLowerCase()
  if (
    blockedExtensions.has(extension) ||
    /(?:^|\/)\.env\.(?!example$)/.test(path)
  ) {
    fail(
      `credential, model or generated artifact path cannot enter Genesis: ${path}`,
    )
  }
}

export function validateClassification(manifest, treeEntries) {
  if (
    manifest?.schema !== "llm-machines.genesis-source-classification.v1" ||
    manifest?.status !== "REVIEWED_SOURCE_POLICY" ||
    !manifest.classes ||
    !Array.isArray(manifest.entries)
  ) {
    fail("source-classification.json has an unsupported schema or status")
  }
  const classNames = new Set(Object.keys(manifest.classes))
  if (
    classNames.size === 0 ||
    [...classNames].some(
      (name) =>
        !["include", "exclude"].includes(
          manifest.classes[name]?.genesisDisposition,
        ),
    )
  ) {
    fail("source-classification.json has an invalid class policy")
  }

  const seen = new Set()
  let previousPath = ""
  for (const entry of manifest.entries) {
    if (
      !entry ||
      typeof entry.path !== "string" ||
      typeof entry.class !== "string" ||
      !classNames.has(entry.class)
    ) {
      fail("source-classification.json has an invalid path entry")
    }
    validateSafePath(entry.path)
    if (seen.has(entry.path)) fail(`duplicate classification: ${entry.path}`)
    if (previousPath && comparePaths(previousPath, entry.path) >= 0) {
      fail("source classifications are not in canonical byte order")
    }
    seen.add(entry.path)
    previousPath = entry.path
  }

  const actualPaths = treeEntries.map((entry) => entry.path)
  const allPaths = manifest.entries.map((entry) => entry.path)
  const includedPaths = manifest.entries
    .filter(
      (entry) => manifest.classes[entry.class].genesisDisposition === "include",
    )
    .map((entry) => entry.path)
  const exact = (left, right) => JSON.stringify(left) === JSON.stringify(right)
  const mode = exact(actualPaths, allPaths)
    ? "SOURCE_INPUT"
    : exact(actualPaths, includedPaths)
      ? "FILTERED_SNAPSHOT"
      : null
  if (!mode) {
    const actual = new Set(actualPaths)
    const expected = new Set(allPaths)
    const missing = allPaths.filter((path) => !actual.has(path)).slice(0, 5)
    const unknown = actualPaths
      .filter((path) => !expected.has(path))
      .slice(0, 5)
    fail(
      `tracked paths do not match the source input or filtered snapshot; missing=${missing.join(",")} unknown=${unknown.join(",")}`,
    )
  }
  return { includedPaths, mode }
}

function buildTree(root, entries) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "llmm-genesis-index-"))
  const indexPath = join(temporaryRoot, "index")
  try {
    const input = entries
      .map((entry) => `${entry.mode} ${entry.objectId}\t${entry.path}\0`)
      .join("")
    const environment = { ...process.env, GIT_INDEX_FILE: indexPath }
    const update = spawnSync("git", ["update-index", "-z", "--index-info"], {
      cwd: root,
      encoding: "utf8",
      env: environment,
      input,
      maxBuffer: 128 * 1024 * 1024,
    })
    if (update.status !== 0) {
      fail(`Git could not assemble the filtered tree: ${update.stderr.trim()}`)
    }
    return git(root, ["write-tree"], { env: environment }).trim()
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true })
  }
}

function createArchive(root, commit, tree) {
  const sourceEpoch = git(root, ["show", "-s", "--format=%ct", commit]).trim()
  if (!/^\d+$/.test(sourceEpoch)) fail("source commit timestamp is invalid")
  const identity = {
    ...process.env,
    GIT_AUTHOR_DATE: `@${sourceEpoch} +0000`,
    GIT_AUTHOR_EMAIL: "dberisha@example.invalid",
    GIT_AUTHOR_NAME: "dberisha",
    GIT_COMMITTER_DATE: `@${sourceEpoch} +0000`,
    GIT_COMMITTER_EMAIL: "dberisha@example.invalid",
    GIT_COMMITTER_NAME: "dberisha",
  }
  const archiveCommit = git(root, ["commit-tree", tree], {
    env: identity,
    input: "Product source Genesis archive\n",
  }).trim()
  return git(
    root,
    ["archive", "--format=tar", `--prefix=${archivePrefix}`, archiveCommit],
    { encoding: "buffer" },
  )
}

function loadTransforms(root, commit, sourceByPath, includedSet) {
  const bytes = git(root, ["show", `${commit}:${transformsPath}`], {
    encoding: "buffer",
  })
  let document
  try {
    document = JSON.parse(bytes.toString("utf8"))
  } catch {
    fail(`${transformsPath} is invalid JSON at ${commit}`)
  }
  if (
    document?.schema !== "llm-machines.genesis-source-transforms.v1" ||
    document?.status !== "REVIEWED_DETERMINISTIC_TRANSFORMS" ||
    !Array.isArray(document.transforms)
  ) {
    fail(`${transformsPath} has an unsupported schema or status`)
  }
  const identifiers = new Set()
  const targets = new Set()
  const transforms = document.transforms.map((transform) => {
    if (
      !transform ||
      typeof transform.id !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(transform.id) ||
      typeof transform.sourcePath !== "string" ||
      typeof transform.targetPath !== "string" ||
      typeof transform.reason !== "string" ||
      transform.reason.length < 20 ||
      identifiers.has(transform.id) ||
      targets.has(transform.targetPath)
    ) {
      fail(`${transformsPath} contains an invalid or duplicate transform`)
    }
    validateSafePath(transform.sourcePath)
    validateSafePath(transform.targetPath)
    if (
      transform.sourcePath === transform.targetPath ||
      !includedSet.has(transform.sourcePath) ||
      !includedSet.has(transform.targetPath)
    ) {
      fail(`transform ${transform.id} does not bind two included paths`)
    }
    const source = sourceByPath.get(transform.sourcePath)
    const target = sourceByPath.get(transform.targetPath)
    if (
      source?.type !== "blob" ||
      target?.type !== "blob" ||
      !["100644", "100755"].includes(source.mode) ||
      !["100644", "100755"].includes(target.mode)
    ) {
      fail(`transform ${transform.id} requires regular source and target files`)
    }
    identifiers.add(transform.id)
    targets.add(transform.targetPath)
    return {
      ...transform,
      inputObjectId: target.objectId,
      outputObjectId: source.objectId,
      outputMode: source.mode,
    }
  })
  return { bytes, transforms }
}

function listFiles(root, relativeRoot = "") {
  const files = []
  const pending = [relativeRoot]
  while (pending.length > 0) {
    const directory = pending.pop()
    const absoluteDirectory = resolve(root, directory)
    for (const entry of readdirSync(absoluteDirectory, {
      withFileTypes: true,
    })) {
      if (entry.name === ".git") continue
      const path = directory ? `${directory}/${entry.name}` : entry.name
      const absolutePath = resolve(root, path)
      if (entry.isSymbolicLink())
        fail(`archive contains a symbolic link: ${path}`)
      if (entry.isDirectory()) pending.push(path)
      else if (entry.isFile()) files.push(path)
      else fail(`archive contains an unsupported filesystem object: ${path}`)
    }
  }
  return files.sort(comparePaths)
}

function extractRepositoryPaths(source) {
  return [
    ...source.matchAll(
      /["'`](docs\/reduction|infra\/(?:portainer|deployment|release\/l1b)|scripts\/(?:pre-genesis|inference-core))\/([^"'`\s)]+)["'`]/g,
    ),
  ].map((match) => `${match[1]}/${match[2]}`)
}

function validateStandaloneReferences(root, files, includedSet) {
  for (const path of files) {
    if (path.startsWith("infra/genesis/")) continue
    if (!/\.(?:js|jsx|json|mjs|mts|ts|tsx)$/.test(path)) continue
    const source = readFileSync(resolve(root, path), "utf8")
    for (const reference of extractRepositoryPaths(source)) {
      if (
        !reference.includes("*") &&
        existsSync(resolve(root, reference)) &&
        !includedSet.has(reference)
      ) {
        fail(`${path} depends on excluded path ${reference}`)
      }
    }
    const relativeImports = [
      ...source.matchAll(
        /(?:^|\n)\s*(?:import|export)\s+(?:[\s\S]{0,500}?\sfrom\s+)?["'](\.{1,2}\/[^"']+)["']/g,
      ),
      ...source.matchAll(/\bimport\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g),
    ]
    for (const match of relativeImports) {
      const reference = match[1]
      const base = resolve(root, dirname(path), reference)
      const candidates = [
        base,
        base.replace(/\.js$/, ".ts"),
        base.replace(/\.js$/, ".tsx"),
        base.replace(/\.mjs$/, ".mts"),
        `${base}.js`,
        `${base}.jsx`,
        `${base}.d.ts`,
        `${base}.mjs`,
        `${base}.mts`,
        `${base}.ts`,
        `${base}.tsx`,
        resolve(base, "index.js"),
        resolve(base, "index.d.ts"),
        resolve(base, "index.mjs"),
        resolve(base, "index.ts"),
        resolve(base, "index.tsx"),
      ]
      const resolved = candidates.find((candidate) => existsSync(candidate))
      if (!resolved)
        fail(`${path} has an unresolved relative import ${reference}`)
      const repositoryPath = relative(root, resolved).split(sep).join("/")
      if (!includedSet.has(repositoryPath)) {
        fail(`${path} imports excluded path ${repositoryPath}`)
      }
    }
  }
}

function verifyArchive({ archive, entries }) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "llmm-genesis-archive-"))
  const archivePath = join(temporaryRoot, "product-genesis.tar")
  const extractionRoot = join(temporaryRoot, "extract")
  mkdirSync(extractionRoot, { mode: 0o700 })
  writeFileSync(archivePath, archive, { mode: 0o600 })
  try {
    execFileSync("tar", ["-xf", archivePath, "-C", extractionRoot], {
      stdio: ["ignore", "pipe", "pipe"],
    })
    const productRoot = resolve(extractionRoot, archivePrefix)
    const files = listFiles(productRoot)
    const expectedPaths = entries.map((entry) => entry.path)
    if (JSON.stringify(files) !== JSON.stringify(expectedPaths)) {
      fail("archive paths do not equal the filtered tree")
    }
    const expectedByPath = new Map(entries.map((entry) => [entry.path, entry]))
    for (const path of files) {
      if (forbiddenIdentityPattern.test(path)) {
        fail(
          `archive path contains a forbidden automation identity marker: ${path}`,
        )
      }
      const absolutePath = resolve(productRoot, path)
      const entry = expectedByPath.get(path)
      const objectId = execFileSync(
        "git",
        ["hash-object", "--no-filters", "--", absolutePath],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ).trim()
      const mode = statSync(absolutePath).mode & 0o111 ? "100755" : "100644"
      if (objectId !== entry.objectId || mode !== entry.mode) {
        fail(`archive bytes or mode drifted for ${path}`)
      }
      const bytes = readFileSync(absolutePath)
      if (
        !bytes.includes(0) &&
        forbiddenIdentityPattern.test(bytes.toString("utf8"))
      ) {
        fail(
          `archive text contains a forbidden automation identity marker: ${path}`,
        )
      }
    }
    validateStandaloneReferences(productRoot, files, new Set(files))
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true })
  }
}

function classificationCounts(manifest) {
  const counts = Object.fromEntries(
    Object.keys(manifest.classes).map((className) => [
      className,
      { excluded: 0, included: 0, total: 0 },
    ]),
  )
  for (const entry of manifest.entries) {
    const disposition = manifest.classes[entry.class].genesisDisposition
    counts[entry.class].total += 1
    counts[entry.class][disposition === "include" ? "included" : "excluded"] +=
      1
  }
  return counts
}

export function inspectGenesis(root = repositoryRoot, sourceRef = "HEAD") {
  const commit = git(root, [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${sourceRef}^{commit}`,
  ]).trim()
  const tree = git(root, [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${commit}^{tree}`,
  ]).trim()
  const classificationBytes = git(
    root,
    ["show", `${commit}:${classificationPath}`],
    { encoding: "buffer" },
  )
  let manifest
  try {
    manifest = JSON.parse(classificationBytes.toString("utf8"))
  } catch {
    fail(`${classificationPath} is invalid JSON at ${commit}`)
  }
  const sourceEntries = parseTree(root, commit)
  const { includedPaths, mode } = validateClassification(
    manifest,
    sourceEntries,
  )
  const sourceByPath = new Map(
    sourceEntries.map((entry) => [entry.path, entry]),
  )
  const includedSet = new Set(includedPaths)
  const transformPolicy = loadTransforms(
    root,
    commit,
    sourceByPath,
    includedSet,
  )
  const transformByTarget = new Map(
    transformPolicy.transforms.map((transform) => [
      transform.targetPath,
      transform,
    ]),
  )
  const includedEntries = includedPaths.map((path) => {
    const entry = sourceByPath.get(path)
    if (!entry) fail(`included path is absent from the source tree: ${path}`)
    if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode)) {
      fail(`included path is not a regular file: ${path}`)
    }
    const transform = transformByTarget.get(path)
    if (transform) {
      return {
        mode: transform.outputMode,
        objectId: transform.outputObjectId,
        path,
        type: "blob",
      }
    }
    return entry
  })
  const generatedTree = buildTree(root, includedEntries)
  if (mode === "FILTERED_SNAPSHOT" && generatedTree !== tree) {
    fail(
      "filtered snapshot HEAD does not equal its reconstructed included tree",
    )
  }
  const archive = createArchive(root, commit, generatedTree)
  verifyArchive({ archive, entries: includedEntries })
  const excludedEntries = manifest.entries.filter(
    (entry) => manifest.classes[entry.class].genesisDisposition === "exclude",
  )
  const excludedReport = excludedEntries
    .map((entry) => `${entry.class}\t${entry.path}`)
    .join("\n")
  const excludedReportBytes = Buffer.from(
    excludedReport.length > 0 ? `${excludedReport}\n` : "",
  )
  return {
    archive,
    excludedReportBytes,
    manifest: {
      schema: "llm-machines.product-source-genesis.v1",
      status: "SOURCE_GENESIS_UNRELEASED",
      containsCredentials: false,
      mode,
      sourceInputCommit: commit,
      sourceInputTree: tree,
      classificationPath,
      classificationSha256: sha256(classificationBytes),
      classificationCounts: classificationCounts(manifest),
      sourceTransforms: {
        path: transformsPath,
        sha256: sha256(transformPolicy.bytes),
        entries: transformPolicy.transforms.map((transform) => ({
          id: transform.id,
          inputObjectId: transform.inputObjectId,
          outputObjectId: transform.outputObjectId,
          sourcePath: transform.sourcePath,
          targetPath: transform.targetPath,
        })),
      },
      includedPathCount: includedEntries.length,
      excludedPathCount: excludedEntries.length,
      generatedGenesisTree: generatedTree,
      archive: {
        file: "product-genesis.tar",
        prefix: archivePrefix,
        sha256: sha256(archive),
        bytes: archive.length,
      },
      excludedPathReport: {
        file: "excluded-paths.txt",
        sha256: sha256(excludedReportBytes),
        bytes: excludedReportBytes.length,
      },
    },
  }
}

export function writeGenesisPackage(root, sourceRef, outputDirectory) {
  const absoluteOutput = resolve(outputDirectory)
  const outputParent = dirname(absoluteOutput)
  let existingOutput = null
  try {
    existingOutput = lstatSync(absoluteOutput)
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }
  if (existingOutput) {
    fail(
      existingOutput.isSymbolicLink()
        ? "output directory is a pre-existing symbolic link"
        : "output directory already exists",
    )
  }
  const parentStatus = lstatSync(outputParent)
  if (parentStatus.isSymbolicLink() || !parentStatus.isDirectory()) {
    fail("output parent must be an existing non-symbolic-link directory")
  }
  const realRoot = realpathSync(root)
  const realParent = realpathSync(outputParent)
  const realOutput = resolve(
    realParent,
    absoluteOutput.slice(outputParent.length + 1),
  )
  const pathFromRoot = relative(realRoot, realOutput)
  if (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== "..")
  ) {
    fail("output directory must be outside the source repository")
  }
  const result = inspectGenesis(root, sourceRef)
  if (result.manifest.mode !== "SOURCE_INPUT") {
    fail(
      "a Genesis package can be generated only from the complete source input",
    )
  }
  mkdirSync(absoluteOutput, { mode: 0o700 })
  writeFileSync(
    resolve(absoluteOutput, "product-genesis.tar"),
    result.archive,
    {
      flag: "wx",
      mode: 0o600,
    },
  )
  writeFileSync(
    resolve(absoluteOutput, "excluded-paths.txt"),
    result.excludedReportBytes,
    { flag: "wx", mode: 0o600 },
  )
  writeFileSync(
    resolve(absoluteOutput, "genesis-manifest.json"),
    `${JSON.stringify(result.manifest, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  )
  for (const path of [
    "product-genesis.tar",
    "excluded-paths.txt",
    "genesis-manifest.json",
  ]) {
    chmodSync(resolve(absoluteOutput, path), 0o600)
  }
  return result.manifest
}

function parseArguments(arguments_) {
  if (arguments_.length === 2 && arguments_[0] === "--check") {
    return { operation: "check", sourceRef: arguments_[1] }
  }
  if (
    arguments_.length === 4 &&
    arguments_[0] === "--source-ref" &&
    arguments_[2] === "--output-dir"
  ) {
    return {
      operation: "write",
      sourceRef: arguments_[1],
      outputDirectory: arguments_[3],
    }
  }
  fail(
    "usage: generate-genesis-source.mjs --check REF | --source-ref REF --output-dir PATH",
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const request = parseArguments(process.argv.slice(2))
  const result =
    request.operation === "check"
      ? inspectGenesis(repositoryRoot, request.sourceRef).manifest
      : writeGenesisPackage(
          repositoryRoot,
          request.sourceRef,
          request.outputDirectory,
        )
  process.stdout.write(
    `${JSON.stringify({
      archiveSha256: result.archive.sha256,
      excluded: result.excludedPathCount,
      genesisTree: result.generatedGenesisTree,
      included: result.includedPathCount,
      mode: result.mode,
      sourceCommit: result.sourceInputCommit,
      sourceTree: result.sourceInputTree,
      status: "pass",
    })}\n`,
  )
}
