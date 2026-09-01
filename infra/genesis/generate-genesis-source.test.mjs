import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { after, test } from "node:test"
import {
  inspectGenesis,
  writeGenesisPackage,
} from "./generate-genesis-source.mjs"

const temporaryRoots = []

after(() => {
  for (const root of temporaryRoots) {
    rmSync(root, { force: true, recursive: true })
  }
})

function temporaryRoot(label) {
  const root = mkdtempSync(join(tmpdir(), `llmm-genesis-${label}-`))
  temporaryRoots.push(root)
  return root
}

function runGit(root, arguments_) {
  return execFileSync("git", arguments_, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_EMAIL: "dberisha@example.invalid",
      GIT_AUTHOR_NAME: "dberisha",
      GIT_COMMITTER_EMAIL: "dberisha@example.invalid",
      GIT_COMMITTER_NAME: "dberisha",
    },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim()
}

function write(root, path, value) {
  const absolutePath = resolve(root, path)
  mkdirSync(dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, value)
}

function sourcePolicy(entries) {
  return {
    schema: "llm-machines.genesis-source-classification.v1",
    status: "REVIEWED_SOURCE_POLICY",
    classes: {
      DEFERRED_NOT_ADMITTED: { genesisDisposition: "exclude" },
      HISTORICAL_EVIDENCE: { genesisDisposition: "exclude" },
      PRODUCT_SOURCE: { genesisDisposition: "include" },
      RELEASE_CONTRACT: { genesisDisposition: "include" },
    },
    entries: [...entries].sort((left, right) =>
      Buffer.from(left.path).compare(Buffer.from(right.path)),
    ),
  }
}

function createSourceRepository(extraEntries = []) {
  const root = temporaryRoot("source")
  runGit(root, ["init", "-q"])
  write(root, "README.md", "# Product source\n")
  write(
    root,
    "package.json",
    '{"name":"example","private":true,"scripts":{"source-only":"historical"}}\n',
  )
  write(root, "docs/reduction/history.txt", "historical evidence\n")
  write(
    root,
    "infra/genesis/snapshot-root-package.json",
    '{"name":"example","private":true}\n',
  )
  write(
    root,
    "infra/genesis/source-transforms.json",
    `${JSON.stringify(
      {
        schema: "llm-machines.genesis-source-transforms.v1",
        status: "REVIEWED_DETERMINISTIC_TRANSFORMS",
        transforms: [
          {
            id: "standalone-root-package",
            sourcePath: "infra/genesis/snapshot-root-package.json",
            targetPath: "package.json",
            reason:
              "Use the standalone root package inside the filtered snapshot.",
          },
        ],
      },
      null,
      2,
    )}\n`,
  )
  const entries = [
    { path: "README.md", class: "PRODUCT_SOURCE" },
    { path: "package.json", class: "PRODUCT_SOURCE" },
    { path: "docs/reduction/history.txt", class: "HISTORICAL_EVIDENCE" },
    {
      path: "infra/genesis/source-classification.json",
      class: "RELEASE_CONTRACT",
    },
    {
      path: "infra/genesis/source-transforms.json",
      class: "RELEASE_CONTRACT",
    },
    {
      path: "infra/genesis/snapshot-root-package.json",
      class: "RELEASE_CONTRACT",
    },
    ...extraEntries,
  ]
  write(
    root,
    "infra/genesis/source-classification.json",
    `${JSON.stringify(sourcePolicy(entries), null, 2)}\n`,
  )
  runGit(root, ["add", "-A"])
  runGit(root, ["commit", "-q", "-m", "Create source fixture"])
  return root
}

test("generation is deterministic and preserves a placeholder parent", () => {
  const source = createSourceRepository()
  const first = inspectGenesis(source, "HEAD")
  const second = inspectGenesis(source, "HEAD")
  assert.equal(first.manifest.mode, "SOURCE_INPUT")
  assert.equal(first.manifest.includedPathCount, 5)
  assert.equal(first.manifest.excludedPathCount, 1)
  assert.equal(first.manifest.sourceTransforms.entries.length, 1)
  assert.notEqual(
    first.manifest.sourceTransforms.entries[0].inputObjectId,
    first.manifest.sourceTransforms.entries[0].outputObjectId,
  )
  assert.equal(
    first.manifest.generatedGenesisTree,
    second.manifest.generatedGenesisTree,
  )
  assert.equal(first.manifest.archive.sha256, second.manifest.archive.sha256)

  const snapshot = temporaryRoot("snapshot")
  runGit(snapshot, ["init", "-q"])
  write(snapshot, "README.md", "placeholder\n")
  runGit(snapshot, ["add", "README.md"])
  runGit(snapshot, ["commit", "-q", "-m", "Preserve placeholder history"])
  write(snapshot, "source.tar", first.archive)
  runGit(snapshot, ["rm", "-q", "README.md"])
  execFileSync(
    "tar",
    ["-xf", "source.tar", "--strip-components=1", "-C", snapshot],
    { cwd: snapshot, stdio: ["ignore", "pipe", "pipe"] },
  )
  assert.equal(
    readFileSync(resolve(snapshot, "package.json"), "utf8"),
    readFileSync(
      resolve(snapshot, "infra/genesis/snapshot-root-package.json"),
      "utf8",
    ),
  )
  rmSync(resolve(snapshot, "source.tar"))
  runGit(snapshot, ["add", "-A"])
  runGit(snapshot, ["commit", "-q", "-m", "Add Product source Genesis"])
  assert.equal(runGit(snapshot, ["rev-list", "--count", "HEAD"]), "2")
  assert.equal(
    runGit(snapshot, ["rev-parse", "HEAD^{tree}"]),
    first.manifest.generatedGenesisTree,
  )
  assert.equal(
    inspectGenesis(snapshot, "HEAD").manifest.mode,
    "FILTERED_SNAPSHOT",
  )
})

test("unknown source paths fail closed", () => {
  const source = createSourceRepository()
  write(source, "unexpected.txt", "unreviewed\n")
  runGit(source, ["add", "unexpected.txt"])
  runGit(source, ["commit", "-q", "-m", "Add unreviewed path"])
  assert.throws(
    () => inspectGenesis(source, "HEAD"),
    /tracked paths do not match/,
  )
})

test("unadmitted LiteLLM candidate and lab artifact evidence stay excluded", () => {
  const candidatePaths = [
    "infra/litellm/oss-downstream/patches/sidebar-functional-candidate.patch",
    "infra/litellm/oss-downstream/sidebar-functional-candidate.json",
    "infra/litellm/oss-downstream/validate-sidebar-functional-candidate.mjs",
    "infra/litellm/oss-downstream/validate-sidebar-functional-candidate.test.mjs",
  ]
  const source = createSourceRepository(
    candidatePaths.map((path) => ({
      path,
      class: "DEFERRED_NOT_ADMITTED",
    })),
  )
  for (const path of candidatePaths) {
    write(
      source,
      path,
      path.endsWith(".json")
        ? '{"version":"v1.96.2-llmm.2","labArtifact":{"status":"unadmitted"},"runtimeEvidence":{"status":"unadmitted"}}\n'
        : "unadmitted functional candidate evidence\n",
    )
  }
  runGit(source, ["add", "-A"])
  runGit(source, ["commit", "-q", "-m", "Add unadmitted candidate evidence"])

  const result = inspectGenesis(source, "HEAD")
  assert.equal(result.manifest.includedPathCount, 5)
  assert.equal(result.manifest.excludedPathCount, 5)
  const generatedPaths = runGit(source, [
    "ls-tree",
    "-r",
    "--name-only",
    result.manifest.generatedGenesisTree,
  ]).split("\n")
  for (const path of candidatePaths) {
    assert.doesNotMatch(generatedPaths.join("\n"), new RegExp(`^${path}$`, "m"))
  }
})

test("included text cannot contain the forbidden automation identity", () => {
  const marker = ["co", "dex"].join("")
  const source = createSourceRepository([
    { path: "marker.txt", class: "PRODUCT_SOURCE" },
  ])
  write(source, "marker.txt", `${marker}\n`)
  runGit(source, ["add", "marker.txt"])
  runGit(source, ["commit", "-q", "-m", "Add marker fixture"])
  assert.throws(
    () => inspectGenesis(source, "HEAD"),
    /forbidden automation identity/,
  )
})

test("included modules cannot import an excluded path", () => {
  const source = createSourceRepository([
    { path: "src/validator.mjs", class: "PRODUCT_SOURCE" },
    { path: "docs/reduction/history.mjs", class: "HISTORICAL_EVIDENCE" },
  ])
  write(source, "docs/reduction/history.mjs", "export const value = true\n")
  write(
    source,
    "src/validator.mjs",
    'import { value } from "../docs/reduction/history.mjs"\nexport { value }\n',
  )
  runGit(source, ["add", "-A"])
  runGit(source, ["commit", "-q", "-m", "Add dependency fixture"])
  assert.throws(
    () => inspectGenesis(source, "HEAD"),
    /unresolved relative import/,
  )
})

test("a pre-existing output symlink is rejected without changing its target", () => {
  const source = createSourceRepository()
  const parent = temporaryRoot("output")
  const target = temporaryRoot("target")
  write(target, "sentinel.txt", "unchanged\n")
  const output = resolve(parent, "product-output")
  symlinkSync(target, output, "dir")
  assert.throws(
    () => writeGenesisPackage(source, "HEAD", output),
    /pre-existing symbolic link/,
  )
  assert.equal(
    readFileSync(resolve(target, "sentinel.txt"), "utf8"),
    "unchanged\n",
  )
})
