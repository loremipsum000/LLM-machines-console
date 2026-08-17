import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

test("preseed uses HTTPS and embeds only the supplied public key", () => {
  const root = mkdtempSync(join(tmpdir(), "llmm-l1b-preseed-"))
  const key = join(root, "operator.pub")
  const output = join(root, "preseed.cfg")
  const publicKey = `ssh-ed25519 ${"A".repeat(68)} operator`
  writeFileSync(key, `${publicKey}\n`, { mode: 0o600 })
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("./render-preseed.mjs", import.meta.url)),
      "--ssh-public-key",
      key,
      "--output",
      output,
    ],
    { encoding: "utf8" },
  )
  assert.equal(result.status, 0, result.stderr)
  const preseed = readFileSync(output, "utf8")
  assert.match(preseed, /mirror\/protocol select https/)
  assert.match(preseed, /mirror\/https\/hostname string deb\.debian\.org/)
  assert.match(preseed, /mirror\/https\/directory string \/debian/)
  assert.match(preseed, /mirror\/https\/proxy string\n/)
  assert.match(preseed, /mirror\/suite select trixie/)
  assert.doesNotMatch(preseed, /mirror\/http\//)
  assert.match(preseed, new RegExp(publicKey))
  assert.match(preseed, /passwd\/user-password-crypted password !/)
})
