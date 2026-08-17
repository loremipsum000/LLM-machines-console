import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const scriptPath = resolve(
  import.meta.dirname,
  "manage-vm118-installer-disks.sh",
)
const script = readFileSync(scriptPath, "utf8")

test("VM118 disk transition shell is syntactically valid", () => {
  const result = spawnSync("sh", ["-n", scriptPath], { encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
})

test("VM118 installation detaches and restores only the exact assembly volumes", () => {
  assert.match(script, /vmid=118/)
  assert.match(script, /system_volume=local-zfs:vm-118-disk-0/)
  assert.match(script, /assembly_a_volume=local-zfs:vm-118-disk-1/)
  assert.match(script, /assembly_b_volume=local-zfs:vm-118-disk-2/)
  assert.match(script, /--delete scsi1/)
  assert.match(script, /--delete scsi2/)
  assert.match(script, /pre-single-disk-install-dde4e36/)
  assert.match(script, /"\$blkdiscard" -f/)
  assert.match(script, /--scsi1 "\$assembly_a_volume/)
  assert.match(script, /--scsi2 "\$assembly_b_volume/)
})
