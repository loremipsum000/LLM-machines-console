import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const directory = dirname(fileURLToPath(import.meta.url))
const digestPattern = /^sha256:[a-f0-9]{64}$/
const sha256Pattern = /^[a-f0-9]{64}$/

function readJson(name) {
  return JSON.parse(readFileSync(resolve(directory, name), "utf8"))
}

function exactKeys(value, expected) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...expected].sort())
  )
}

export function validateL1bSource({ profile, toolchain, egress }) {
  const errors = []
  if (
    profile?.schema !== "llm-machines.vm103-l1b-builder-profile.v1" ||
    profile?.status !== "SOURCE_PROFILE_NOT_PROVISIONED" ||
    profile?.containsCredentials !== false
  ) {
    errors.push("builder profile identity differs")
  }
  if (
    profile?.vm?.vmid !== 118 ||
    profile?.vm?.name !== "llmm-vm103-l1b-builder" ||
    profile?.vm?.architecture !== "amd64" ||
    profile?.vm?.vcpus !== 6 ||
    profile?.vm?.memoryMiB !== 24576 ||
    profile?.vm?.ballooning !== false ||
    profile?.vm?.onboot !== false ||
    profile?.vm?.protectionRequiredAfterInstallation !== true
  ) {
    errors.push("builder VM profile differs")
  }
  if (
    JSON.stringify(profile?.disks) !==
    JSON.stringify([
      { id: "system", sizeGiB: 40, mount: "/" },
      {
        id: "assembly-a",
        sizeGiB: 80,
        mount: "/srv/llmm-l1b/assembly-a",
      },
      {
        id: "assembly-b",
        sizeGiB: 80,
        mount: "/srv/llmm-l1b/assembly-b",
      },
    ])
  ) {
    errors.push("builder disk ownership differs")
  }
  if (
    profile?.assembly?.sequential !== true ||
    profile?.assembly?.maximumRootGiB !== 80 ||
    Object.entries(profile?.assembly ?? {}).some(
      ([key, value]) => key.startsWith("shared") && value !== false,
    ) ||
    profile?.assembly?.dockerOnSystemDisk !== false
  ) {
    errors.push("independent assembly boundary differs")
  }
  if (
    toolchain?.schema !== "llm-machines.vm103-l1b-toolchain-lock.v1" ||
    toolchain?.status !== "LOCKED_SOURCE_TOOLCHAIN" ||
    toolchain?.containsCredentials !== false ||
    toolchain?.platform !== "linux/amd64" ||
    !sha256Pattern.test(toolchain?.installationMediaSha256 ?? "")
  ) {
    errors.push("toolchain lock identity differs")
  }
  for (const entry of toolchain?.hostTools ?? []) {
    if (!/^[a-z0-9-]+$/.test(entry.id ?? "") || !entry.version) {
      errors.push("host tool identity is invalid")
    }
    if (entry.url && !sha256Pattern.test(entry.sha256 ?? "")) {
      errors.push(`${entry.id} host tool is not content-addressed`)
    }
  }
  const hostToolsById = new Map(
    (toolchain?.hostTools ?? []).map((entry) => [entry.id, entry]),
  )
  if (
    hostToolsById.get("pnpm")?.url !==
      "https://registry.npmjs.org/pnpm/-/pnpm-10.0.0.tgz" ||
    !sha256Pattern.test(hostToolsById.get("pnpm")?.sha256 ?? "")
  ) {
    errors.push("pnpm is not byte-pinned")
  }
  for (const entry of toolchain?.dockerPackages ?? []) {
    if (
      !entry.url?.startsWith("https://download.docker.com/") ||
      !sha256Pattern.test(entry.sha256 ?? "") ||
      /latest/i.test(JSON.stringify(entry))
    ) {
      errors.push(`${entry.id ?? "docker package"} is not immutable`)
    }
  }
  for (const entry of toolchain?.containerTools ?? []) {
    if (
      !entry.repository ||
      !entry.version ||
      !digestPattern.test(entry.indexDigest ?? "") ||
      !digestPattern.test(entry.platformDigest ?? "") ||
      /(?:^|[-_.:/])latest(?:$|[-_.:/])/i.test(JSON.stringify(entry))
    ) {
      errors.push(`${entry.id ?? "container tool"} is not immutable`)
    }
  }
  if (
    egress?.schema !== "llm-machines.vm103-l1b-egress-allowlist.v1" ||
    egress?.status !== "SOURCE_POLICY" ||
    egress?.containsCredentials !== false ||
    egress?.defaultPolicy !== "DROP" ||
    JSON.stringify(egress?.transport) !== JSON.stringify(["tcp/443"]) ||
    egress?.dnsResolver !== "10.33.74.1" ||
    !Array.isArray(egress?.hosts) ||
    egress.hosts.length === 0 ||
    [...egress.hosts].sort().join("\n") !== egress.hosts.join("\n") ||
    new Set(egress.hosts).size !== egress.hosts.length ||
    egress.hosts.some(
      (host) =>
        !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(host) ||
        host.includes("*"),
    )
  ) {
    errors.push("egress allowlist is not exact and default-deny")
  }
  if (
    !exactKeys(profile?.installationMedia, [
      "distribution",
      "version",
      "file",
      "sha256",
      "checksumSignerFingerprint",
    ]) ||
    profile.installationMedia.sha256 !== toolchain.installationMediaSha256
  ) {
    errors.push("installation media and toolchain lock disagree")
  }
  return errors
}

export function readL1bSource() {
  return {
    profile: readJson("builder-profile.json"),
    toolchain: readJson("toolchain-lock.json"),
    egress: readJson("egress-allowlist.json"),
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = validateL1bSource(readL1bSource())
  if (errors.length > 0) {
    for (const error of errors) console.error(error)
    process.exitCode = 1
  } else {
    console.log("VM103-L1B source profile passed")
  }
}
