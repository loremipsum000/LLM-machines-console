import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  chmod,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  inspectInferenceNft,
  inspectInferenceRoute,
  reconcileInferenceRoute,
  renderInferenceFirewallContract,
  verifyManagedScript,
} from "./manage-vm103-inference-route.mjs"

const destination = "10.30.0.3"
const gateway = "10.10.0.1"
const device = "eno1"
const source = "10.30.0.3"
const port = 30_005

function exactRoute(overrides = {}) {
  return [
    {
      dev: device,
      dst: `${destination}/32`,
      flags: [],
      gateway,
      metric: 42_711,
      protocol: 186,
      scope: "global",
      type: "unicast",
      ...overrides,
    },
  ]
}

function exactNft(overrides = {}) {
  const match = (left, right) => ({ match: { left, op: "==", right } })
  return {
    nftables: [
      { metainfo: { json_schema_version: 1 } },
      { table: { family: "inet", name: "llmm_sglang" } },
      {
        chain: {
          family: "inet",
          hook: "input",
          name: "input",
          policy: "accept",
          prio: -5,
          table: "llmm_sglang",
          type: "filter",
          ...overrides.chain,
        },
      },
      {
        rule: {
          chain: "input",
          expr: [
            match({ meta: { key: "iifname" } }, "lo"),
            match({ payload: { field: "dport", protocol: "tcp" } }, port),
            { accept: null },
          ],
          family: "inet",
          table: "llmm_sglang",
        },
      },
      {
        rule: {
          chain: "input",
          expr: [
            match({ payload: { field: "saddr", protocol: "ip" } }, source),
            match({ payload: { field: "dport", protocol: "tcp" } }, port),
            { accept: null },
          ],
          family: "inet",
          table: "llmm_sglang",
        },
      },
      {
        rule: {
          chain: "input",
          expr: [
            match({ payload: { field: "dport", protocol: "tcp" } }, port),
            { drop: null },
          ],
          family: "inet",
          table: "llmm_sglang",
        },
      },
    ],
  }
}

test("classifies only the exact owned route and firewall state", () => {
  assert.equal(
    renderInferenceFirewallContract(source, port),
    `table inet llmm_sglang {\n  chain input {\n    type filter hook input priority -5; policy accept;\n    iifname "lo" tcp dport 30005 accept\n    ip saddr 10.30.0.3 tcp dport 30005 accept\n    tcp dport 30005 drop\n  }\n}\n`,
  )
  assert.deepEqual(inspectInferenceRoute([], destination, gateway, device), {
    state: "absent",
  })
  assert.deepEqual(
    inspectInferenceRoute(exactRoute(), destination, gateway, device),
    { state: "exact" },
  )
  assert.deepEqual(
    inspectInferenceRoute(
      exactRoute({ gateway: "10.10.0.2" }),
      destination,
      gateway,
      device,
    ),
    { state: "collision" },
  )
  assert.deepEqual(inspectInferenceNft(null, source, port), {
    state: "absent",
  })
  assert.deepEqual(inspectInferenceNft(exactNft(), source, port), {
    state: "exact",
  })
  assert.deepEqual(
    inspectInferenceNft(exactNft({ chain: { policy: "drop" } }), source, port),
    { state: "collision" },
  )
  const nftWithRuleComment = exactNft()
  nftWithRuleComment.nftables[3].rule.comment = "foreign"
  assert.deepEqual(inspectInferenceNft(nftWithRuleComment, source, port), {
    state: "collision",
  })
  const nftWithMatchExtension = exactNft()
  nftWithMatchExtension.nftables[3].rule.expr[0].match.foreign = true
  assert.deepEqual(inspectInferenceNft(nftWithMatchExtension, source, port), {
    state: "collision",
  })
})

test("verifies exact manager content, ownership, mode, and canonical path", async () => {
  const root = await mkdtemp(join(tmpdir(), "llmm-inference-manager-"))
  try {
    const canonicalRoot = await realpath(root)
    const manager = join(canonicalRoot, "manager.mjs")
    const link = join(canonicalRoot, "manager-link.mjs")
    const content = "export const admitted = true\n"
    await writeFile(manager, content, { mode: 0o600 })
    await chmod(manager, 0o600)
    const digest = `sha256:${createHash("sha256").update(content).digest("hex")}`
    verifyManagedScript(manager, digest, process.getuid?.() ?? 0)
    assert.throws(
      () =>
        verifyManagedScript(
          manager,
          `sha256:${"0".repeat(64)}`,
          process.getuid?.() ?? 0,
        ),
      /manager identity/,
    )
    await chmod(manager, 0o640)
    assert.throws(
      () => verifyManagedScript(manager, digest, process.getuid?.() ?? 0),
      /manager identity/,
    )
    await chmod(manager, 0o600)
    await symlink(manager, link)
    assert.throws(
      () => verifyManagedScript(link, digest, process.getuid?.() ?? 0),
      /manager identity/,
    )
    await chmod(manager, 0o4600)
    assert.throws(
      () => verifyManagedScript(manager, digest, process.getuid?.() ?? 0),
      /manager identity/,
    )
  } finally {
    await rm(root, { recursive: true })
  }
})

test("a symlinked CLI entrypoint reaches custody validation and fails closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "llmm-inference-cli-"))
  try {
    const canonicalRoot = await realpath(root)
    const manager = join(canonicalRoot, "manager.mjs")
    const link = join(canonicalRoot, "manager-link.mjs")
    const content = await readFile(
      new URL("./manage-vm103-inference-route.mjs", import.meta.url),
    )
    await writeFile(manager, content, { mode: 0o600 })
    await chmod(manager, 0o600)
    await symlink(manager, link)
    const digest = `sha256:${createHash("sha256").update(content).digest("hex")}`
    const result = spawnSync(
      process.execPath,
      [
        link,
        "status",
        digest,
        destination,
        gateway,
        device,
        source,
        String(port),
        join(canonicalRoot, "firewall.nft"),
      ],
      { encoding: "utf8" },
    )
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /manager identity/)
  } finally {
    await rm(root, { recursive: true })
  }
})

test("applies and removes only one exact independently owned lifecycle", () => {
  let route = "absent"
  let nft = "absent"
  const operations = []
  const dependencies = {
    addNft: () => {
      operations.push("add-nft")
      nft = "exact"
    },
    addRoute: () => {
      operations.push("add-route")
      route = "exact"
    },
    deleteNft: () => {
      operations.push("delete-nft")
      nft = "absent"
    },
    deleteRoute: () => {
      operations.push("delete-route")
      route = "absent"
    },
    inspectNft: () => ({ state: nft }),
    inspectRoute: () => ({ state: route }),
  }

  assert.deepEqual(reconcileInferenceRoute("apply", dependencies), {
    preimage: "absent",
    state: "exact",
  })
  assert.deepEqual(operations, ["add-route", "add-nft"])
  assert.deepEqual(reconcileInferenceRoute("remove", dependencies), {
    state: "absent",
  })
  assert.deepEqual(operations, [
    "add-route",
    "add-nft",
    "delete-route",
    "delete-nft",
  ])
  assert.deepEqual(reconcileInferenceRoute("remove", dependencies), {
    state: "absent",
  })
})

test("rejects every pre-existing exact or foreign route and firewall state", () => {
  for (const [route, nft] of [
    ["exact", "absent"],
    ["collision", "absent"],
    ["absent", "exact"],
    ["absent", "collision"],
  ]) {
    assert.throws(
      () =>
        reconcileInferenceRoute("apply", {
          addNft: assert.fail,
          addRoute: assert.fail,
          deleteNft: assert.fail,
          deleteRoute: assert.fail,
          inspectNft: () => ({ state: nft }),
          inspectRoute: () => ({ state: route }),
        }),
      /pre-existing state/,
    )
  }
})

test("restores the absent preimage after a partially failed apply", () => {
  let route = "absent"
  const operations = []
  assert.throws(
    () =>
      reconcileInferenceRoute("apply", {
        addNft: () => {
          operations.push("add-nft")
          throw new Error("simulated nft failure")
        },
        addRoute: () => {
          operations.push("add-route")
          route = "exact"
        },
        deleteNft: assert.fail,
        deleteRoute: () => {
          operations.push("delete-route")
          route = "absent"
        },
        inspectNft: () => ({ state: "absent" }),
        inspectRoute: () => ({ state: route }),
      }),
    /simulated nft failure/,
  )
  assert.deepEqual(operations, ["add-route", "add-nft", "delete-route"])
})

test("does not delete a racing route when route creation itself fails", () => {
  let route = "absent"
  let deleteCalls = 0
  assert.throws(
    () =>
      reconcileInferenceRoute("apply", {
        addNft: assert.fail,
        addRoute: () => {
          route = "collision"
          throw new Error("simulated route race")
        },
        deleteNft: assert.fail,
        deleteRoute: () => {
          deleteCalls += 1
        },
        inspectNft: () => ({ state: "absent" }),
        inspectRoute: () => ({ state: route }),
      }),
    /simulated route race/,
  )
  assert.equal(deleteCalls, 0)
})

test("fails closed without deleting foreign or partially owned rollback state", () => {
  for (const [route, nft] of [
    ["collision", "exact"],
    ["exact", "collision"],
    ["absent", "exact"],
    ["exact", "absent"],
  ]) {
    assert.throws(
      () =>
        reconcileInferenceRoute("remove", {
          addNft: assert.fail,
          addRoute: assert.fail,
          deleteNft: assert.fail,
          deleteRoute: assert.fail,
          inspectNft: () => ({ state: nft }),
          inspectRoute: () => ({ state: route }),
        }),
      /rollback ownership/,
    )
  }
})

test("keeps the firewall in place if route rollback does not complete", () => {
  let route = "exact"
  let nftDeleteCalls = 0
  assert.throws(
    () =>
      reconcileInferenceRoute("remove", {
        addNft: assert.fail,
        addRoute: assert.fail,
        deleteNft: () => {
          nftDeleteCalls += 1
        },
        deleteRoute: () => {},
        inspectNft: () => ({ state: "exact" }),
        inspectRoute: () => ({ state: route }),
      }),
    /route rollback/,
  )
  assert.equal(nftDeleteCalls, 0)
  route = "absent"
})
