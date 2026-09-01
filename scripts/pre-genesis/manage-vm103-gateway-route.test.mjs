import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  acquireGatewayLifecycleLock,
  inspectGatewayFirewall,
  reconcileGatewayFirewall,
  renderGatewayRuleArguments,
  verifyManagedGatewayScript,
} from "./manage-vm103-gateway-route.mjs"

const source = "10.0.0.3"
const destination = "10.33.74.166"
const port = 30_005
const exactRule = `-A POSTROUTING -s ${source}/32 -d ${destination}/32 -p tcp -m tcp --dport ${port} -m comment --comment llmm-vm103-sglang -j ACCEPT`
const unrelatedRule =
  "-A POSTROUTING -s 10.0.0.8/32 -d 10.33.74.129/32 -p tcp -m tcp --dport 443 -j ACCEPT"
const immediateLock = () => () => {}

test("renders one exact TCP-scoped gateway rule", () => {
  assert.deepEqual(renderGatewayRuleArguments(source, destination, port), [
    "-s",
    `${source}/32`,
    "-d",
    `${destination}/32`,
    "-p",
    "tcp",
    "--dport",
    String(port),
    "-m",
    "comment",
    "--comment",
    "llmm-vm103-sglang",
    "-j",
    "ACCEPT",
  ])
})

test("classifies only one exact owned rule while preserving unrelated rules", () => {
  assert.deepEqual(
    inspectGatewayFirewall(`${unrelatedRule}\n`, source, destination, port),
    { exactOwnedCount: 0, state: "absent" },
  )
  assert.deepEqual(
    inspectGatewayFirewall(
      `-P POSTROUTING ACCEPT\n${unrelatedRule}\n${exactRule}\n`,
      source,
      destination,
      port,
    ),
    { exactOwnedCount: 1, state: "exact" },
  )
})

test("rejects owned-comment, broad, duplicate, and semantically extended collisions", () => {
  for (const rules of [
    "-A OUTPUT -m comment --comment llmm-vm103-sglang -j ACCEPT",
    `-A POSTROUTING -s ${source}/32 -d ${destination}/32 -j ACCEPT`,
    `${exactRule}\n${exactRule}`,
    `${exactRule} -m conntrack --ctstate NEW`,
    `-A POSTROUTING -s ${source}/32 -d ${destination}/32 -p tcp -m tcp --dport ${port} -j DROP`,
  ]) {
    assert.equal(
      inspectGatewayFirewall(`${rules}\n`, source, destination, port).state,
      "collision",
    )
  }
  assert.deepEqual(
    inspectGatewayFirewall(
      `-A POSTROUTING -s ${source}/32 -d ${destination}/32 -p tcp -m tcp --dport 30006 -j ACCEPT\n`,
      source,
      destination,
      port,
    ),
    { exactOwnedCount: 0, state: "absent" },
  )
})

test("rejects every overlapping port selector while preserving disjoint traffic", () => {
  for (const selector of [
    "--dport 30000:30010",
    "--dport 30000-30010",
    "--dport 30005:30005",
    "-m multiport --dports 443,30000:30010,8443",
  ]) {
    assert.equal(
      inspectGatewayFirewall(
        `-A POSTROUTING -s ${source}/32 -d ${destination}/32 -p tcp ${selector} -j ACCEPT\n`,
        source,
        destination,
        port,
      ).state,
      "collision",
    )
  }

  for (const rule of [
    `-A POSTROUTING -s ${source}/32 -d ${destination}/32 -p tcp --dport 30006:30010 -j ACCEPT`,
    `-A POSTROUTING -s ${source}/32 -d ${destination}/32 -p tcp -m multiport --dports 443,8443 -j ACCEPT`,
    `-A POSTROUTING -s ${source}/32 -d ${destination}/32 -p udp --dport ${port} -j ACCEPT`,
    `-A POSTROUTING -s 10.0.1.0/24 -d ${destination}/32 -p tcp --dport ${port} -j ACCEPT`,
    `-A POSTROUTING -s ${source}/32 -d 10.33.75.0/24 -p tcp --dport ${port} -j ACCEPT`,
    `-A POSTROUTING -s ${source}/32 -d ${destination}/32 -p tcp ! --dport ${port} -j ACCEPT`,
  ]) {
    assert.deepEqual(
      inspectGatewayFirewall(`${rule}\n`, source, destination, port),
      { exactOwnedCount: 0, state: "absent" },
    )
  }
})

test("rejects broader source and destination selectors that cover owned traffic", () => {
  for (const rule of [
    `-A POSTROUTING -s 10.0.0.0/24 -d ${destination}/32 -p tcp --dport ${port} -j MASQUERADE`,
    `-A POSTROUTING -s ${source}/32 -d 10.33.74.0/24 -p tcp --dport ${port} -j SNAT --to-source 10.33.74.140`,
    `-A POSTROUTING -p tcp --dport ${port} -j ACCEPT`,
  ]) {
    assert.equal(
      inspectGatewayFirewall(`${rule}\n`, source, destination, port).state,
      "collision",
    )
  }
})

test("applies and removes only the exact independently owned rule", () => {
  let state = { exactOwnedCount: 0, state: "absent" }
  let locked = false
  const operations = []
  const dependencies = {
    acquireLock: () => {
      assert.equal(locked, false)
      locked = true
      return () => {
        assert.equal(locked, true)
        locked = false
      }
    },
    addRule: () => {
      assert.equal(locked, true)
      operations.push("add")
      state = { exactOwnedCount: 1, state: "exact" }
    },
    deleteRule: () => {
      assert.equal(locked, true)
      operations.push("delete")
      state = { exactOwnedCount: 0, state: "absent" }
    },
    inspect: () => {
      assert.equal(locked, true)
      return state
    },
  }
  assert.deepEqual(reconcileGatewayFirewall("apply", dependencies), {
    preimage: "absent",
    state: "exact",
  })
  assert.deepEqual(reconcileGatewayFirewall("remove", dependencies), {
    state: "absent",
  })
  assert.deepEqual(operations, ["add", "delete"])
  assert.deepEqual(reconcileGatewayFirewall("remove", dependencies), {
    state: "absent",
  })
  assert.equal(locked, false)
})

test("rejects every pre-existing exact or colliding rule without mutation", () => {
  for (const state of ["exact", "collision"]) {
    assert.throws(
      () =>
        reconcileGatewayFirewall("apply", {
          acquireLock: immediateLock,
          addRule: assert.fail,
          deleteRule: assert.fail,
          inspect: () => ({
            exactOwnedCount: state === "exact" ? 1 : 0,
            state,
          }),
        }),
      /pre-existing state/,
    )
  }
})

test("a failed add never deletes a racing foreign rule", () => {
  let inspection = 0
  let deleteCalls = 0
  assert.throws(
    () =>
      reconcileGatewayFirewall("apply", {
        acquireLock: immediateLock,
        addRule: () => {
          throw new Error("simulated add race")
        },
        deleteRule: () => {
          deleteCalls += 1
        },
        inspect: () => {
          inspection += 1
          return inspection === 1
            ? { exactOwnedCount: 0, state: "absent" }
            : { exactOwnedCount: 0, state: "collision" }
        },
      }),
    /simulated add race/,
  )
  assert.equal(deleteCalls, 0)
})

test("a failed post-check removes only the one exact rule it created", () => {
  let inspection = 0
  let deleteCalls = 0
  assert.throws(
    () =>
      reconcileGatewayFirewall("apply", {
        acquireLock: immediateLock,
        addRule: () => {},
        deleteRule: () => {
          deleteCalls += 1
        },
        inspect: () => {
          inspection += 1
          if (inspection === 1) return { exactOwnedCount: 0, state: "absent" }
          if (inspection <= 3) return { exactOwnedCount: 1, state: "collision" }
          return { exactOwnedCount: 0, state: "collision" }
        },
      }),
    /apply/,
  )
  assert.equal(deleteCalls, 1)
})

test("rollback rejects drift and never deletes it", () => {
  let deleteCalls = 0
  assert.throws(
    () =>
      reconcileGatewayFirewall("remove", {
        acquireLock: immediateLock,
        addRule: assert.fail,
        deleteRule: () => {
          deleteCalls += 1
        },
        inspect: () => ({ exactOwnedCount: 0, state: "collision" }),
      }),
    /rollback ownership/,
  )
  assert.equal(deleteCalls, 0)
})

test("verifies the exact root-custody script contract before mutation", (t) => {
  const root = mkdtempSync(
    join(realpathSync(tmpdir()), "llmm-gateway-manager-"),
  )
  t.after(() => rmSync(root, { force: true, recursive: true }))
  const path = join(root, "manager.mjs")
  const alias = join(root, "manager-link.mjs")
  writeFileSync(path, "managed gateway lifecycle\n", { mode: 0o600 })
  const digest = `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`
  const uid = process.getuid?.() ?? 0

  assert.deepEqual(verifyManagedGatewayScript(path, digest, uid), {
    sha256: digest,
  })
  assert.throws(
    () => verifyManagedGatewayScript(path, `sha256:${"0".repeat(64)}`, uid),
    /managed script/,
  )
  chmodSync(path, 0o640)
  assert.throws(
    () => verifyManagedGatewayScript(path, digest, uid),
    /managed script/,
  )
  chmodSync(path, 0o600)
  symlinkSync(path, alias)
  assert.throws(
    () => verifyManagedGatewayScript(alias, digest, uid),
    /managed script/,
  )
  assert.throws(
    () => verifyManagedGatewayScript(path, digest, uid + 1),
    /managed script/,
  )
  chmodSync(path, 0o4600)
  assert.throws(
    () => verifyManagedGatewayScript(path, digest, uid),
    /managed script/,
  )
})

test("a symlinked CLI entrypoint reaches custody validation and fails closed", (t) => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "llmm-gateway-cli-"))
  t.after(() => rmSync(root, { force: true, recursive: true }))
  const path = join(root, "manager.mjs")
  const alias = join(root, "manager-link.mjs")
  const content = readFileSync(
    new URL("./manage-vm103-gateway-route.mjs", import.meta.url),
  )
  writeFileSync(path, content, { mode: 0o600 })
  chmodSync(path, 0o600)
  symlinkSync(path, alias)
  const digest = `sha256:${createHash("sha256").update(content).digest("hex")}`
  const result = spawnSync(
    process.execPath,
    [alias, "status", digest, source, destination, String(port)],
    { encoding: "utf8" },
  )
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /managed script/)
})

test("holds one exact no-follow lifecycle lock through cleanup", (t) => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "llmm-gateway-lock-"))
  chmodSync(root, 0o700)
  t.after(() => rmSync(root, { force: true, recursive: true }))
  const path = join(root, "gateway.lock")
  const uid = process.getuid?.() ?? 0
  const release = acquireGatewayLifecycleLock(path, uid)
  assert.throws(
    () => acquireGatewayLifecycleLock(path, uid),
    /lifecycle lock collision/,
  )
  release()
  const releaseAgain = acquireGatewayLifecycleLock(path, uid)
  releaseAgain()
})

test("rejects concurrent apply and remove while one lifecycle owns the lock", (t) => {
  const root = mkdtempSync(
    join(realpathSync(tmpdir()), "llmm-gateway-concurrency-"),
  )
  chmodSync(root, 0o700)
  t.after(() => rmSync(root, { force: true, recursive: true }))
  const path = join(root, "gateway.lock")
  const uid = process.getuid?.() ?? 0
  const release = acquireGatewayLifecycleLock(path, uid)
  for (const action of ["apply", "remove"]) {
    assert.throws(
      () =>
        reconcileGatewayFirewall(action, {
          acquireLock: () => acquireGatewayLifecycleLock(path, uid),
          addRule: assert.fail,
          deleteRule: assert.fail,
          inspect: assert.fail,
        }),
      /lifecycle lock collision/,
    )
  }
  release()
})
