import { chmod, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

export async function writeFirecrawlEgressAllowlist(directory, hosts) {
  await mkdir(directory, { mode: 0o755, recursive: true })
  await chmod(directory, 0o755)
  const path = join(directory, "allowed-hosts.txt")
  await writeFile(path, `${hosts.join("\n")}\n`, { mode: 0o644 })
  await chmod(path, 0o644)
  return path
}
