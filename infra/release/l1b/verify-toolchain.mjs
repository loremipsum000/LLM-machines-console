#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { arch, platform } from "node:os"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const directory = dirname(fileURLToPath(import.meta.url))
const lock = JSON.parse(
  readFileSync(resolve(directory, "toolchain-lock.json"), "utf8"),
)

function fail(message) {
  throw new Error(message)
}

function command(command_, args) {
  return execFileSync(command_, args, { encoding: "utf8" }).trim()
}

export function verifyHostToolchain(run = command) {
  if (platform() !== "linux" || arch() !== "x64") {
    fail("L1B toolchain requires native Linux amd64")
  }
  const observation = {
    schema: "llm-machines.vm103-l1b-toolchain-observation.v1",
    platform: "linux/amd64",
    node: run("node", ["--version"]),
    pnpm: run("pnpm", ["--version"]),
    zstd: run("zstd", ["--version"]),
    docker: run("docker", ["version", "--format", "{{.Client.Version}}"]),
    buildx: run("docker", ["buildx", "version"]),
    dnsmasqPackage: run("dpkg-query", ["-W", "-f=${Version}", "dnsmasq-base"]),
    dnsmasqBinary: run("dnsmasq", ["--version"]),
    iproute2Package: run("dpkg-query", ["-W", "-f=${Version}", "iproute2"]),
    iproute2Binary: run("ip", ["-Version"]),
  }
  const expected = new Map(
    lock.hostTools.map((entry) => [entry.id, entry.version]),
  )
  if (observation.node !== `v${expected.get("node")}`)
    fail("Node version differs")
  if (observation.pnpm !== expected.get("pnpm")) fail("pnpm version differs")
  if (!observation.zstd.includes(`v${expected.get("zstd")}`))
    fail("zstd version differs")
  if (observation.docker !== "29.5.3") fail("Docker CLI version differs")
  if (!observation.buildx.includes("v0.34.1"))
    fail("Docker Buildx version differs")
  if (observation.dnsmasqPackage !== expected.get("dnsmasq"))
    fail("dnsmasq package version differs")
  const dnsmasq = lock.hostTools.find(({ id }) => id === "dnsmasq")
  if (
    !observation.dnsmasqBinary.includes(
      `Dnsmasq version ${dnsmasq.binaryVersion}`,
    )
  )
    fail("dnsmasq binary version differs")
  const iproute2 = lock.hostTools.find(({ id }) => id === "iproute2")
  if (observation.iproute2Package !== iproute2.version)
    fail("iproute2 package version differs")
  if (!observation.iproute2Binary.includes(iproute2.binaryVersion))
    fail("iproute2 binary version differs")
  return observation
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(verifyHostToolchain(), null, 2)}\n`)
}
