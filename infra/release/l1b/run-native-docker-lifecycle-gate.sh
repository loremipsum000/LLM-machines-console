#!/bin/sh
set -eu

usage() {
  echo "usage: run-native-docker-lifecycle-gate.sh A|B ASSEMBLY_ROOT EVIDENCE_DIRECTORY" >&2
  exit 2
}

[ "$#" -eq 3 ] || usage
assembly_id=$1
assembly_root=$2
evidence_root=$3
case "$assembly_id" in A|B) ;; *) usage ;; esac
[ -d "$assembly_root" ] || { echo "assembly root is missing" >&2; exit 1; }
[ -d "$evidence_root" ] || { echo "evidence directory is missing" >&2; exit 1; }

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
bridge_profile=$script_dir/docker-bridge-profiles.json
node "$script_dir/validate-docker-bridge-profiles.mjs"
. "$script_dir/docker-lifecycle.sh"
llmm_l1b_require_root
llmm_l1b_load_bridge_profile "$assembly_id" "$bridge_profile"

gate_root=$assembly_root/.docker-lifecycle-gate
docker_root=$gate_root/docker-data
docker_exec=$gate_root/docker-exec
docker_socket=$gate_root/docker.sock
docker_pid=$gate_root/dockerd.pid
docker_log=$evidence_root/docker-lifecycle-$assembly_id.log
dnsmasq_config=$gate_root/dnsmasq.conf
dnsmasq_log=$gate_root/dnsmasq.log
receipt=$evidence_root/docker-lifecycle-$assembly_id.json

llmm_l1b_path_absent "$gate_root"
llmm_l1b_path_absent "$receipt"
llmm_l1b_preflight \
  "$assembly_root" \
  "$docker_root" \
  "$docker_exec" \
  "$docker_socket" \
  "$docker_pid" \
  "$docker_log" \
  "$dnsmasq_config" \
  "$dnsmasq_log"

gate_succeeded=false
finalize() {
  original_status=$?
  trap - EXIT HUP INT TERM
  set +e
  llmm_l1b_cleanup
  cleanup_status=$?
  if [ "$original_status" -eq 0 ] && [ "$cleanup_status" -eq 0 ] &&
    [ "$gate_succeeded" = true ]; then
    if findmnt -R "$docker_root" >/dev/null 2>&1 ||
      findmnt -R "$docker_exec" >/dev/null 2>&1; then
      echo "native lifecycle gate runtime roots remain mounted" >&2
      root_cleanup_status=1
    else
      rm -rf -- "$docker_root" "$docker_exec"
      rmdir "$gate_root" 2>/dev/null
      root_cleanup_status=$?
    fi
    if [ "$root_cleanup_status" -eq 0 ]; then
      bridge_profile_sha=$(sha256sum "$bridge_profile" | awk '{print $1}')
      docker_log_sha=$(sha256sum "$docker_log" | awk '{print $1}')
      jq -n \
        --arg assembly "$assembly_id" \
        --arg bridge "$LLMM_L1B_BRIDGE" \
        --arg networkCidr "$LLMM_L1B_NETWORK_CIDR" \
        --arg gatewayAddress "$LLMM_L1B_GATEWAY_ADDRESS" \
        --arg bridgeProfileSha256 "$bridge_profile_sha" \
        --arg dockerLogSha256 "$docker_log_sha" \
        '{
          schema: "llm-machines.vm103-l1b-native-docker-lifecycle-gate.v1",
          status: "PASS",
          containsCredentials: false,
          assembly: $assembly,
          dockerVersion: "29.5.3",
          bridge: $bridge,
          networkCidr: $networkCidr,
          gatewayAddress: $gatewayAddress,
          bridgeProfileSha256: $bridgeProfileSha256,
          dockerLogSha256: $dockerLogSha256,
          cleanup: {
            processResidue: false,
            socketResidue: false,
            pidResidue: false,
            bridgeResidue: false,
            routeResidue: false,
            namespaceResidue: false,
            firewallResidue: false,
            runtimeRootResidue: false
          }
        }' > "$receipt"
      chmod 0600 "$receipt"
    else
      cleanup_status=1
    fi
  fi
  set -e
  if [ "$original_status" -ne 0 ]; then
    exit "$original_status"
  fi
  exit "$cleanup_status"
}
trap finalize EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

install -d -m 0700 "$gate_root"
llmm_l1b_create_bridge
llmm_l1b_start_docker
llmm_l1b_wait_for_docker
llmm_l1b_verify_docker
gate_succeeded=true
