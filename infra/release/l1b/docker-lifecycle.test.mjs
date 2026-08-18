import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"

const root = import.meta.dirname
const lifecyclePath = resolve(root, "docker-lifecycle.sh")
const runner = readFileSync(
  resolve(root, "run-independent-assembly.sh"),
  "utf8",
)
const lifecycle = readFileSync(lifecyclePath, "utf8")

function executable(path, source) {
  writeFileSync(path, source)
  chmodSync(path, 0o755)
}

function fixture() {
  const directory = mkdtempSync(resolve(tmpdir(), "llmm-l1b-lifecycle-"))
  const bin = resolve(directory, "bin")
  const assembly = resolve(directory, "assembly")
  const sysClassNet = resolve(directory, "sys-class-net")
  mkdirSync(bin)
  mkdirSync(assembly)
  mkdirSync(sysClassNet)
  executable(resolve(bin, "id"), '#!/bin/sh\n[ "$1" = -u ] && echo 0\n')
  for (const command of ["docker", "dockerd", "jq"]) {
    executable(resolve(bin, command), "#!/bin/sh\nexit 0\n")
  }
  executable(
    resolve(bin, "ps"),
    '#!/bin/sh\n[ "${LLMM_FAKE_PROCESS:-0}" = 1 ] && echo "dockerd dockerd --data-root $LLMM_RUNTIME_ROOT"\n',
  )
  executable(
    resolve(bin, "iptables-save"),
    '#!/bin/sh\n[ "${LLMM_FAKE_FIREWALL:-0}" = 1 ] && echo "-A FORWARD -i llmml1ba0 -s 172.30.118.0/24"\nexit 0\n',
  )
  executable(resolve(bin, "nft"), "#!/bin/sh\nexit 0\n")
  executable(
    resolve(bin, "ip"),
    `#!/bin/sh
set -eu
bridge=llmml1ba0
state=$LLMM_L1B_SYS_CLASS_NET/$bridge
case "$*" in
  "link show dev $bridge") [ -d "$state" ] ;;
  "-o -4 address show") [ -d "$state" ] && echo "2: $bridge inet 172.30.118.1/24" || true ;;
  "-o -4 address show dev $bridge") [ -d "$state" ] && echo "2: $bridge inet 172.30.118.1/24" ;;
  "-o -4 route show table all") [ -d "$state" ] && echo "172.30.118.0/24 dev $bridge" || true ;;
  "netns list") exit 0 ;;
  "link add name $bridge type bridge") mkdir "$state"; echo 77 > "$state/ifindex"; : > "$state/ifalias" ;;
  "link set dev $bridge alias "*)
    [ "\${LLMM_FAKE_BRIDGE_SETUP_FAILURE:-0}" != 1 ] || exit 1
    printf '%s\n' "$6" > "$state/ifalias"
    ;;
  "address add 172.30.118.1/24 dev $bridge") exit 0 ;;
  "link set dev $bridge up") exit 0 ;;
  "link delete dev $bridge type bridge") rm -rf "$state" ;;
  *) echo "unexpected fake ip invocation: $*" >&2; exit 64 ;;
esac
`,
  )
  return { directory, bin, assembly, sysClassNet }
}

function runFixture(fixture_, script, extra = {}) {
  return spawnSync("sh", ["-c", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...extra,
      LIFECYCLE: lifecyclePath,
      PATH: `${fixture_.bin}:${process.env.PATH}`,
      ASSEMBLY_ROOT: fixture_.assembly,
      LLMM_L1B_SYS_CLASS_NET: fixture_.sysClassNet,
    },
  })
}

const setup = `
. "$LIFECYCLE"
LLMM_L1B_ASSEMBLY=A
LLMM_L1B_BRIDGE=llmml1ba0
LLMM_L1B_NETWORK_CIDR=172.30.118.0/24
LLMM_L1B_GATEWAY_ADDRESS=172.30.118.1
LLMM_L1B_GATEWAY_CIDR=172.30.118.1/24
LLMM_L1B_ADDRESS_PREFIX=172.30.118.
LLMM_RUNTIME_ROOT=$ASSEMBLY_ROOT
llmm_l1b_preflight \
  "$ASSEMBLY_ROOT" \
  "$ASSEMBLY_ROOT/docker-data" \
  "$ASSEMBLY_ROOT/docker-exec" \
  "$ASSEMBLY_ROOT/docker.sock" \
  "$ASSEMBLY_ROOT/dockerd.pid" \
  "$ASSEMBLY_ROOT/dockerd.log" \
  "$ASSEMBLY_ROOT/dnsmasq.conf" \
  "$ASSEMBLY_ROOT/dnsmasq.log"
`

test("portable bridge lifecycle creates and removes only its owned state", () => {
  const fixture_ = fixture()
  try {
    const result = runFixture(
      fixture_,
      `${setup}
llmm_l1b_create_bridge
llmm_l1b_cleanup
`,
    )
    assert.equal(result.status, 0, result.stderr)
    assert.equal(existsSync(resolve(fixture_.sysClassNet, "llmml1ba0")), false)
  } finally {
    rmSync(fixture_.directory, { force: true, recursive: true })
  }
})

test("pre-existing runtime roots and firewall residue fail closed", () => {
  const fixture_ = fixture()
  try {
    mkdirSync(resolve(fixture_.assembly, "docker-data"))
    const rootResult = runFixture(fixture_, setup)
    assert.equal(rootResult.status, 1)
    assert.match(rootResult.stderr, /pre-existing runner path is denied/)

    rmSync(resolve(fixture_.assembly, "docker-data"), { recursive: true })
    const firewallResult = runFixture(fixture_, setup, {
      LLMM_FAKE_FIREWALL: "1",
    })
    assert.equal(firewallResult.status, 1)
    assert.match(firewallResult.stderr, /runner-owned firewall residue/)

    const processResult = runFixture(fixture_, setup, {
      LLMM_FAKE_PROCESS: "1",
      LLMM_RUNTIME_ROOT: fixture_.assembly,
    })
    assert.equal(processResult.status, 1)
    assert.match(processResult.stderr, /runner-owned process residue/)
  } finally {
    rmSync(fixture_.directory, { force: true, recursive: true })
  }
})

test("cleanup refuses to delete a bridge whose ownership identity changed", () => {
  const fixture_ = fixture()
  try {
    const result = runFixture(
      fixture_,
      `${setup}
llmm_l1b_create_bridge
printf '%s\n' foreign-owner > "$LLMM_L1B_SYS_CLASS_NET/$LLMM_L1B_BRIDGE/ifalias"
llmm_l1b_cleanup
`,
    )
    assert.equal(result.status, 1)
    assert.match(result.stderr, /foreign state was not removed/)
    assert.equal(existsSync(resolve(fixture_.sysClassNet, "llmml1ba0")), true)
  } finally {
    rmSync(fixture_.directory, { force: true, recursive: true })
  }
})

test("setup failure removes the exact partially created bridge", () => {
  const fixture_ = fixture()
  try {
    const result = runFixture(
      fixture_,
      `set -eu
${setup}
trap 'original=$?; set +e; llmm_l1b_cleanup; cleanup=$?; [ "$original" -ne 0 ] && exit "$original"; exit "$cleanup"' EXIT
llmm_l1b_create_bridge
`,
      { LLMM_FAKE_BRIDGE_SETUP_FAILURE: "1" },
    )
    assert.equal(result.status, 1)
    assert.equal(existsSync(resolve(fixture_.sysClassNet, "llmml1ba0")), false)
  } finally {
    rmSync(fixture_.directory, { force: true, recursive: true })
  }
})

test("runner uses one global lock and the shared A or B lifecycle", () => {
  assert.match(runner, /exec 9>\/run\/lock\/llmm-l1b-assembly\.lock/)
  assert.match(runner, /flock -n 9/)
  assert.match(runner, /llmm_l1b_load_bridge_profile "\$assembly_id"/)
  assert.match(runner, /llmm_l1b_create_bridge/)
  assert.match(runner, /llmm_l1b_cleanup/)
})

test("Docker startup rejects the former simultaneous bridge and bip form", () => {
  const startFunction = lifecycle.match(
    /llmm_l1b_start_docker\(\) \{[\s\S]*?\n\}/,
  )?.[0]
  assert.ok(startFunction)
  assert.match(startFunction, /--bridge "\$LLMM_L1B_BRIDGE"/)
  assert.doesNotMatch(startFunction, /--bip/)
  assert.match(lifecycle, /simultaneous Docker --bridge and --bip is denied/)
})

test("daemon exit is detected during readiness and active work", () => {
  assert.match(lifecycle, /assembly Docker daemon exited before readiness/)
  assert.match(
    lifecycle,
    /assembly Docker daemon exited while the workload was active/,
  )
  assert.match(lifecycle, /bounded credential-free Docker log follows/)
  assert.match(lifecycle, /complete Docker log preserved at/)
})

test("cleanup preserves the original runner status unless cleanup itself blocks success", () => {
  assert.match(runner, /original_status=\$\?/)
  assert.match(runner, /if \[ "\$original_status" -ne 0 \]/)
  assert.match(runner, /exit "\$original_status"/)
  assert.match(runner, /exit "\$cleanup_status"/)
  assert.match(lifecycle, /ps -o stat= -p "\$llmm_stop_pid"/)
  assert.match(lifecycle, /""\|Z\*\) break/)
})
