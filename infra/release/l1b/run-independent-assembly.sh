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

exec 9>/run/lock/llmm-l1b-assembly.lock
flock -n 9 || { echo "another L1B assembly is active" >&2; exit 1; }

docker_root=$assembly_root/docker-data
docker_exec=$assembly_root/docker-exec
docker_socket=$assembly_root/docker.sock
docker_pid=$assembly_root/dockerd.pid
docker_log=$assembly_root/dockerd.log
temporary_root=$assembly_root/tmp
case "$assembly_id" in
  A) bridge=llmml1ba0; bridge_cidr=172.30.118.1/24 ;;
  B) bridge=llmml1bb0; bridge_cidr=172.31.118.1/24 ;;
esac

install -d -m 0700 -o dberisha -g dberisha "$docker_root" "$docker_exec" "$temporary_root"
[ ! -e "$assembly_root/run" ] || { echo "assembly run output already exists" >&2; exit 1; }
[ ! -e "$docker_pid" ] || { echo "assembly Docker PID file already exists" >&2; exit 1; }

dockerd \
  --host "unix://$docker_socket" \
  --data-root "$docker_root" \
  --exec-root "$docker_exec" \
  --pidfile "$docker_pid" \
  --bridge "$bridge" \
  --bip "$bridge_cidr" \
  --iptables=true \
  --ip-forward=true \
  --storage-driver overlay2 \
  --log-driver local \
  >"$docker_log" 2>&1 &
dockerd_launcher=$!
cleanup() {
  if [ -f "$docker_pid" ]; then kill "$(cat "$docker_pid")" 2>/dev/null || true; fi
  wait "$dockerd_launcher" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

attempt=0
while [ "$attempt" -lt 60 ]; do
  if DOCKER_HOST="unix://$docker_socket" docker info >/dev/null 2>&1; then break; fi
  attempt=$((attempt + 1))
  sleep 1
done
[ "$attempt" -lt 60 ] || { echo "assembly Docker daemon did not become ready" >&2; exit 1; }

export DOCKER_HOST="unix://$docker_socket"
export TMPDIR=$temporary_root
node "$source_root/infra/release/l1b/run-core-assembly.mjs" \
  --assembly-root "$assembly_root" \
  --assembly-id "$assembly_id" \
  --source-root "$source_root" \
  --expected-commit "$expected_commit" \
  --expected-tree "$expected_tree" \
  --release-version "$release_version" \
  --builder-name "llmm-l1b-$assembly_lower"
