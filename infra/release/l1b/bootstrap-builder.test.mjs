import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"

const directory = import.meta.dirname
const script = readFileSync(resolve(directory, "bootstrap-builder.sh"), "utf8")
const toolchain = JSON.parse(
  readFileSync(resolve(directory, "toolchain-lock.json"), "utf8"),
)

test("bootstrap enumerates every locked host and Docker input before installation", () => {
  const expected = [
    ...toolchain.hostTools.filter(({ url }) => url).map(({ id }) => id),
    ...toolchain.dockerPackages.map(({ id }) => id),
  ]
  assert.deepEqual(expected, [
    "node",
    "pnpm",
    "dnsmasq",
    "iproute2",
    "docker-ce",
    "docker-ce-cli",
    "containerd.io",
    "docker-buildx-plugin",
  ])
  assert.match(
    script,
    /jq -ce '\[\(\.hostTools\[\] \| select\(\.url != null\)\), \.dockerPackages\[\]\] \| \.\[\]'/,
  )
  assert.match(script, /done < "\$locked_inputs"/)
})

test("bootstrap binds host resolution to the exact reviewed firewall observation", () => {
  assert.match(script, /--egress-transaction/)
  assert.match(script, /--firewall-receipt/)
  assert.doesNotMatch(script, /--egress-resolution/)
  assert.match(script, /render-egress-bindings\.py/)
  assert.match(script, /# BEGIN LLM MACHINES VM103-L1B EGRESS BINDING/)
  assert.match(script, /--format verify-transaction/)
  assert.match(script, /--format verify-system/)
  assert.match(script, /\.llmm-l1b-egress-transaction/)
  assert.match(script, /vm118\.firewall/)
  assert.match(script, /transaction\.json/)
  assert.match(script, /firewall-receipt\.json/)
  assert.match(
    script,
    /--transaction-directory "\$bound_transaction"[\s\S]*--firewall-receipt "\$bound_receipt"/,
  )
})

test("bootstrap installs the content-addressed dnsmasq package", () => {
  const dnsmasq = toolchain.hostTools.find(({ id }) => id === "dnsmasq")
  assert.equal(dnsmasq.version, "2.91-1+deb13u1")
  assert.equal(
    dnsmasq.sha256,
    "32fe2686b0adbe31dbedfadeea7eee8e47785e0ab39ffa9f655ca1bd7ba25d55",
  )
  assert.match(
    script,
    /apt-get install -y --no-install-recommends \$docker_debs "\$dnsmasq_deb" "\$iproute2_deb"/,
  )
})

test("bootstrap installs and verifies the content-addressed iproute2 package", () => {
  const iproute2 = toolchain.hostTools.find(({ id }) => id === "iproute2")
  assert.deepEqual(iproute2, {
    id: "iproute2",
    version: "6.15.0-1",
    binaryVersion: "ip utility, iproute2-6.15.0",
    url: "https://deb.debian.org/debian/pool/main/i/iproute2/iproute2_6.15.0-1_amd64.deb",
    sha256: "7b2dcade4a83ded723fcab21c5a53c47f29352c9c5e1661a089a1e481b3fb48a",
  })
  assert.match(script, /iproute2_deb=/)
  assert.match(script, /dpkg-query -W -f='\$\{Version\}' iproute2/)
  assert.match(
    script,
    /ip -Version \| grep -Fq "ip utility, iproute2-6\.15\.0"/,
  )
})

test("bootstrap denies package-triggered Docker and containerd startup", () => {
  assert.match(
    script,
    /runtime_units="docker\.service docker\.socket containerd\.service"/,
  )
  assert.match(script, /service_start_guard=\/usr\/sbin\/policy-rc\.d/)
  assert.match(
    script,
    /\[ -e "\$service_start_guard" \] \|\| \[ -L "\$service_start_guard" \]/,
  )
  assert.match(script, /printf '%s\\n' '#!\/bin\/sh' 'exit 101'/)
  assert.match(script, /trap cleanup_service_start_guard EXIT/)
  assert.match(script, /trap 'exit 129' HUP/)
  assert.match(script, /trap 'exit 130' INT/)
  assert.match(script, /trap 'exit 143' TERM/)
  assert.match(script, /systemctl disable --now \$runtime_units/)
  assert.doesNotMatch(
    script,
    /systemctl disable --now \$runtime_units \|\| true/,
  )
  assert.match(script, /for runtime_unit in \$runtime_units; do/)
  assert.match(script, /systemctl is-active "\$runtime_unit"/)
  assert.match(script, /systemctl is-enabled "\$runtime_unit"/)
  assert.match(script, /rm -f "\$service_start_guard"/)

  const guardIndex = script.indexOf("service_start_guard=/usr/sbin/policy-rc.d")
  const dockerInstallIndex = script.indexOf(
    'apt-get install -y --no-install-recommends $docker_debs "$dnsmasq_deb" "$iproute2_deb"',
  )
  const guardRemovalIndex = script.lastIndexOf('rm -f "$service_start_guard"')
  assert.ok(guardIndex >= 0)
  assert.ok(guardIndex < dockerInstallIndex)
  assert.ok(dockerInstallIndex < guardRemovalIndex)
})

test("bootstrap signal handlers stop execution and leave cleanup to EXIT", () => {
  const cleanupFunction = script.match(
    /cleanup_service_start_guard\(\) \{[\s\S]*?\n\}/,
  )?.[0]
  assert.ok(cleanupFunction)

  const root = mkdtempSync(resolve(tmpdir(), "llmm-l1b-signal-"))
  const guard = resolve(root, "policy-rc.d")
  const packageMarker = resolve(root, "package-ran")
  try {
    const result = spawnSync(
      "sh",
      [
        "-c",
        `${cleanupFunction}
service_start_guard=$TEST_GUARD
service_start_guard_active=true
: > "$service_start_guard"
trap cleanup_service_start_guard EXIT
trap 'exit 143' TERM
kill -TERM "$$"
: > "$TEST_PACKAGE_MARKER"`,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          TEST_GUARD: guard,
          TEST_PACKAGE_MARKER: packageMarker,
        },
      },
    )
    assert.equal(result.status, 143, result.stderr)
    assert.equal(existsSync(guard), false)
    assert.equal(existsSync(packageMarker), false)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test("bootstrap proves both global runtime roots clean before formatting", () => {
  assert.match(
    script,
    /assert_global_runtime_storage_clean \/var\/lib\/docker Docker/g,
  )
  assert.match(
    script,
    /assert_global_runtime_storage_clean \/var\/lib\/containerd containerd/g,
  )
  assert.match(
    script,
    /find "\$storage_path" -mindepth 1 -maxdepth 1 -print -quit/,
  )
  assert.match(
    script,
    /if ! storage_entry=\$\(find "\$storage_path" -mindepth 1 -maxdepth 1 -print -quit\); then/,
  )

  const dockerChecks = [
    ...script.matchAll(
      /assert_global_runtime_storage_clean \/var\/lib\/docker Docker/g,
    ),
  ]
  const containerdChecks = [
    ...script.matchAll(
      /assert_global_runtime_storage_clean \/var\/lib\/containerd containerd/g,
    ),
  ]
  assert.equal(dockerChecks.length, 2)
  assert.equal(containerdChecks.length, 2)
  const dockerInstallIndex = script.indexOf(
    'apt-get install -y --no-install-recommends $docker_debs "$dnsmasq_deb" "$iproute2_deb"',
  )
  const postInstallDockerCheck = dockerChecks.at(-1).index
  const postInstallContainerdCheck = containerdChecks.at(-1).index
  const firstFormatIndex = script.indexOf(
    'prepare_volume "$assembly_a_device" llmm-l1b-a',
  )
  assert.ok(dockerChecks[0].index < dockerInstallIndex)
  assert.ok(containerdChecks[0].index < dockerInstallIndex)
  assert.ok(dockerInstallIndex < postInstallDockerCheck)
  assert.ok(dockerInstallIndex < postInstallContainerdCheck)
  assert.ok(postInstallDockerCheck < firstFormatIndex)
  assert.ok(postInstallContainerdCheck < firstFormatIndex)
})

test("bootstrap fails closed when a runtime-root inspection fails", () => {
  const storageFunction = script.match(
    /assert_global_runtime_storage_clean\(\) \{[\s\S]*?\n\}/,
  )?.[0]
  assert.ok(storageFunction)

  const root = mkdtempSync(resolve(tmpdir(), "llmm-l1b-inspection-"))
  try {
    const result = spawnSync(
      "sh",
      [
        "-c",
        `${storageFunction}
find() { return 73; }
assert_global_runtime_storage_clean "$TEST_STORAGE_ROOT" Docker`,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, TEST_STORAGE_ROOT: root },
      },
    )
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Docker global storage inspection failed/)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test("bootstrap keeps Debian package retrieval inside the HTTPS-only IPv4 policy", () => {
  assert.match(
    script,
    /s\|http:\/\/security\.debian\.org\/\|https:\/\/security\.debian\.org\/\|g/,
  )
  assert.match(script, /Acquire::ForceIPv4 "true";/)
  assert.match(script, /APT::Update::Error-Mode "any";/)
  assert.match(script, /prohibited tcp\/80 egress/)
})

test("bootstrap accepts the preseed-owned authorized key without self-copy", () => {
  assert.match(script, /if \[ "\$ssh_public_key" -ef "\$authorized_keys" \]/)
  assert.match(script, /chmod 0600 "\$authorized_keys"/)
  assert.match(script, /install -m 0600 "\$ssh_public_key" "\$authorized_keys"/)
  assert.match(script, /chown -R dberisha:dberisha \/home\/dberisha\/\.ssh/)
})
