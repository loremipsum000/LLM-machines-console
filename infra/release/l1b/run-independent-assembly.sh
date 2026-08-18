#!/bin/sh
set -eu

usage() {
  echo "usage: run-independent-assembly.sh A|B SOURCE_ROOT COMMIT TREE VERSION" >&2
  exit 2
}

[ "$#" -eq 5 ] || usage
assembly_id=$1
source_root=$2
expected_commit=$3
expected_tree=$4
release_version=$5
case "$assembly_id" in A|B) ;; *) usage ;; esac

assembly_lower=$(printf '%s' "$assembly_id" | tr 'A-Z' 'a-z')
assembly_root=/srv/llmm-l1b/assembly-$assembly_lower
[ -d "$assembly_root" ] || { echo "assembly root is missing" >&2; exit 1; }
case "$source_root" in "$assembly_root"/*) ;; *) echo "source checkout is outside the assembly root" >&2; exit 1 ;; esac

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
bridge_profile=$script_dir/docker-bridge-profiles.json
node "$script_dir/validate-docker-bridge-profiles.mjs"
. "$script_dir/docker-lifecycle.sh"
llmm_l1b_require_root
llmm_l1b_load_bridge_profile "$assembly_id" "$bridge_profile"

exec 9>/run/lock/llmm-l1b-assembly.lock
flock -n 9 || { echo "another L1B assembly is active" >&2; exit 1; }

docker_root=$assembly_root/docker-data
docker_exec=$assembly_root/docker-exec
docker_socket=$assembly_root/docker.sock
docker_pid=$assembly_root/dockerd.pid
docker_log=$assembly_root/dockerd.log
temporary_root=$assembly_root/tmp
egress_transaction=$assembly_root/.llmm-l1b-egress-transaction
egress_resolution=$egress_transaction/egress-resolution.json
firewall_receipt=$assembly_root/.llmm-l1b-firewall-receipt.json
dnsmasq_config=$assembly_root/dnsmasq.conf
dnsmasq_log=$assembly_root/dnsmasq.log
[ -d "$egress_transaction" ] || { echo "assembly egress transaction is missing" >&2; exit 1; }
[ -f "$firewall_receipt" ] || { echo "assembly firewall receipt is missing" >&2; exit 1; }

[ ! -e "$assembly_root/run" ] || { echo "assembly run output already exists" >&2; exit 1; }
llmm_l1b_path_absent "$temporary_root"
llmm_l1b_preflight \
  "$assembly_root" \
  "$docker_root" \
  "$docker_exec" \
  "$docker_socket" \
  "$docker_pid" \
  "$docker_log" \
  "$dnsmasq_config" \
  "$dnsmasq_log"

finalize() {
  original_status=$?
  trap - EXIT HUP INT TERM
  set +e
  llmm_l1b_cleanup
  cleanup_status=$?
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

install -d -m 0700 -o dberisha -g dberisha "$temporary_root"
llmm_l1b_create_bridge
llmm_l1b_start_docker
llmm_l1b_wait_for_docker
llmm_l1b_verify_docker

python3 "$source_root/infra/release/l1b/render-egress-bindings.py" \
  --resolution "$egress_resolution" \
  --format dnsmasq \
  --interface "$LLMM_L1B_BRIDGE" \
  --listen-address "$LLMM_L1B_GATEWAY_ADDRESS" \
  --output "$dnsmasq_config"
dnsmasq --test --conf-file="$dnsmasq_config"
dnsmasq --keep-in-foreground --conf-file="$dnsmasq_config" >"$dnsmasq_log" 2>&1 &
LLMM_L1B_DNSMASQ_PID=$!
attempt=0
while [ "$attempt" -lt 30 ]; do
  if kill -0 "$LLMM_L1B_DNSMASQ_PID" 2>/dev/null &&
    ss -H -lun "sport = :53" | grep -Fq "$LLMM_L1B_GATEWAY_ADDRESS:53"; then
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done
[ "$attempt" -lt 30 ] || { echo "assembly DNS service did not become ready" >&2; exit 1; }

export DOCKER_HOST="unix://$docker_socket"
export TMPDIR=$temporary_root
llmm_l1b_run_with_docker_watch \
  node "$source_root/infra/release/l1b/run-core-assembly.mjs" \
  --assembly-root "$assembly_root" \
  --assembly-id "$assembly_id" \
  --source-root "$source_root" \
  --expected-commit "$expected_commit" \
  --expected-tree "$expected_tree" \
  --release-version "$release_version" \
  --builder-name "llmm-l1b-$assembly_lower" \
  --egress-transaction "$egress_transaction" \
  --firewall-receipt "$firewall_receipt"
