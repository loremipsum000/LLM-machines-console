#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { realpathSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const gitId = /^[0-9a-f]{40}$/

export function verifyFounderSourceCheckout(
  sourceRoot,
  expectedCommit,
  expectedTree,
  runGit = (arguments_, options) =>
    spawnSync("/usr/bin/git", arguments_, options),
) {
  if (!gitId.test(expectedCommit) || !gitId.test(expectedTree)) fail()

  let canonicalRoot
  try {
    canonicalRoot = realpathSync(sourceRoot)
  } catch {
    fail()
  }
  if (resolve(sourceRoot) !== canonicalRoot) fail()

  const execute = (arguments_) => {
    const result = runGit(
      [
        "--no-replace-objects",
        "-c",
        `safe.directory=${canonicalRoot}`,
        ...arguments_,
      ],
      {
        cwd: canonicalRoot,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    )
    if (
      result?.error ||
      result?.status !== 0 ||
      typeof result?.stdout !== "string"
    ) {
      fail()
    }
    return result.stdout.trimEnd()
  }

  let topLevel
  try {
    topLevel = realpathSync(execute(["rev-parse", "--show-toplevel"]))
  } catch {
    fail()
  }
  if (topLevel !== canonicalRoot) fail()
  if (execute(["rev-parse", "--verify", "HEAD"]) !== expectedCommit) fail()
  if (execute(["rev-parse", "--verify", "HEAD^{tree}"]) !== expectedTree) fail()
  const trackedFlags = execute(["ls-files", "-v", "-z"])
  if (
    trackedFlags !== "" &&
    trackedFlags
      .split("\0")
      .filter(Boolean)
      .some((entry) => !entry.startsWith("H "))
  ) {
    fail()
  }
  if (execute(["status", "--porcelain=v1", "--untracked-files=all"]) !== "")
    fail()

  return {
    commit: expectedCommit,
    state: "exact-clean-checkout",
    tree: expectedTree,
  }
}

function fail() {
  throw new Error("VM103 founder source checkout binding is invalid.")
}

if (
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1] === "-"
) {
  if (process.argv.length !== 5) {
    throw new Error(
      "Usage: verify-vm103-founder-source.mjs SOURCE_ROOT COMMIT TREE",
    )
  }
  process.stdout.write(
    `${JSON.stringify(
      verifyFounderSourceCheckout(
        process.argv[2],
        process.argv[3],
        process.argv[4],
      ),
    )}\n`,
  )
}
