#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const revisionLabel = "org.opencontainers.image.revision"
const treeLabel = "com.llm-machines.source.tree"

export function validateFounderImageInspections(binding, inspections) {
  exactKeys(binding, ["images", "schema", "source"])
  if (binding.schema !== "llm-machines.vm103-founder-images.v1") fail()
  exactKeys(binding.source, ["commit", "tree"])
  if (
    !/^[0-9a-f]{40}$/.test(binding.source.commit) ||
    !/^[0-9a-f]{40}$/.test(binding.source.tree)
  )
    fail()
  exactKeys(binding.images, ["bff", "web"])
  exactKeys(inspections, ["bff", "web"])
  for (const name of ["bff", "web"]) {
    const image = binding.images[name]
    const inspected = inspections[name]
    if (
      !/^sha256:[0-9a-f]{64}$/.test(image) ||
      !inspected ||
      inspected.Id !== image ||
      inspected.Config?.Labels?.[revisionLabel] !== binding.source.commit ||
      inspected.Config?.Labels?.[treeLabel] !== binding.source.tree
    ) {
      fail()
    }
  }
  return { state: "exact" }
}

export function verifyFounderImages(bindingPath) {
  const binding = JSON.parse(readFileSync(bindingPath, "utf8"))
  const inspections = Object.fromEntries(
    ["bff", "web"].map((name) => [
      name,
      JSON.parse(
        execFileSync(
          "/usr/bin/docker",
          ["image", "inspect", binding.images[name]],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        ),
      )[0],
    ]),
  )
  return validateFounderImageInspections(binding, inspections)
}

function exactKeys(value, expected) {
  if (
    !value ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...expected].sort())
  )
    fail()
}

function fail() {
  throw new Error("VM103 founder image source binding is invalid.")
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3)
    throw new Error("Usage: verify-vm103-founder-images.mjs BINDING")
  process.stdout.write(
    `${JSON.stringify(verifyFounderImages(process.argv[2]))}\n`,
  )
}
