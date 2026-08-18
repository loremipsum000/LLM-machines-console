#!/bin/sh

# This file is sourced by the assembly runner and native lifecycle gate. Both
# callers use the same exact bridge, daemon, verification, and cleanup rules.

llmm_l1b_lifecycle_fail() {
  echo "$1" >&2
  return 1
}

llmm_l1b_require_root() {
  [ "$(id -u)" -eq 0 ] ||
    llmm_l1b_lifecycle_fail "L1B Docker lifecycle requires root privileges"
}

llmm_l1b_require_commands() {
  for llmm_command in \
    docker dockerd ip iptables iptables-save ip6tables ip6tables-save \
    nft ps jq node sysctl find awk cat; do
    command -v "$llmm_command" >/dev/null 2>&1 ||
      llmm_l1b_lifecycle_fail "L1B Docker lifecycle requires $llmm_command" ||
      return 1
  done
}

llmm_l1b_load_bridge_profile() {
  LLMM_L1B_ASSEMBLY=$1
  LLMM_L1B_BRIDGE_PROFILE=$2
  [ -f "$LLMM_L1B_BRIDGE_PROFILE" ] ||
    llmm_l1b_lifecycle_fail "Docker bridge profile is missing" || return 1
  LLMM_L1B_BRIDGE=$(
    jq -er --arg assembly "$LLMM_L1B_ASSEMBLY" \
      '.profiles[] | select(.assembly == $assembly) | .bridge' \
      "$LLMM_L1B_BRIDGE_PROFILE"
  ) || return 1
  LLMM_L1B_NETWORK_CIDR=$(
    jq -er --arg assembly "$LLMM_L1B_ASSEMBLY" \
      '.profiles[] | select(.assembly == $assembly) | .networkCidr' \
      "$LLMM_L1B_BRIDGE_PROFILE"
  ) || return 1
  LLMM_L1B_GATEWAY_ADDRESS=$(
    jq -er --arg assembly "$LLMM_L1B_ASSEMBLY" \
      '.profiles[] | select(.assembly == $assembly) | .gatewayAddress' \
      "$LLMM_L1B_BRIDGE_PROFILE"
  ) || return 1
  LLMM_L1B_GATEWAY_CIDR=$(
    jq -er --arg assembly "$LLMM_L1B_ASSEMBLY" \
      '.profiles[] | select(.assembly == $assembly) | .gatewayCidr' \
      "$LLMM_L1B_BRIDGE_PROFILE"
  ) || return 1
  LLMM_L1B_ADDRESS_PREFIX=$(
    jq -er --arg assembly "$LLMM_L1B_ASSEMBLY" \
      '.profiles[] | select(.assembly == $assembly) | .addressPrefix' \
      "$LLMM_L1B_BRIDGE_PROFILE"
  ) || return 1
  case "$LLMM_L1B_ASSEMBLY:$LLMM_L1B_BRIDGE:$LLMM_L1B_NETWORK_CIDR:$LLMM_L1B_GATEWAY_CIDR" in
    A:llmml1ba0:172.30.118.0/24:172.30.118.1/24) ;;
    B:llmml1bb0:172.31.118.0/24:172.31.118.1/24) ;;
    *) llmm_l1b_lifecycle_fail "Docker bridge profile differs"; return 1 ;;
  esac
}

llmm_l1b_path_absent() {
  [ ! -e "$1" ] && [ ! -L "$1" ] ||
    llmm_l1b_lifecycle_fail "pre-existing runner path is denied: $1"
}

llmm_l1b_process_residue() {
  llmm_process_inventory=$(ps -eo comm=,args=) || return 2
  printf '%s\n' "$llmm_process_inventory" | awk \
    '$1 ~ /^(dockerd|containerd|containerd-shim|dnsmasq|buildkitd|buildkit-runc)$/ { found = 1 }
      END { exit found ? 0 : 1 }
    '
}

llmm_l1b_namespace_residue() {
  llmm_netns_inventory=$(ip netns list) || return 2
  [ -n "$llmm_netns_inventory" ] && return 0
  for llmm_namespace_root in /run/docker/netns "$LLMM_L1B_DOCKER_EXEC"; do
    if [ -d "$llmm_namespace_root" ]; then
      llmm_namespace_inventory=$(find "$llmm_namespace_root" \
        -mindepth 1 -path '*/netns/*' -print -quit) || return 2
    else
      llmm_namespace_inventory=
    fi
    if [ -n "$llmm_namespace_inventory" ]; then
      return 0
    fi
  done
  return 1
}

llmm_l1b_network_residue() {
  [ -e "$LLMM_L1B_SYS_CLASS_NET/$LLMM_L1B_BRIDGE" ] && return 0
  llmm_address_inventory=$(ip -o -4 address show) || return 2
  llmm_route_inventory=$(ip -o -4 route show table all) || return 2
  llmm_netns_inventory=$(ip netns list) || return 2
  printf '%s\n' "$llmm_address_inventory" |
    grep -Fq "$LLMM_L1B_ADDRESS_PREFIX" && return 0
  printf '%s\n' "$llmm_route_inventory" | grep -Eq \
    "(^|[[:space:]])${LLMM_L1B_NETWORK_CIDR%/*}(/24)?([[:space:]]|$)|dev[[:space:]]+$LLMM_L1B_BRIDGE([[:space:]]|$)" && return 0
  printf '%s\n' "$llmm_netns_inventory" | grep -Fq "$LLMM_L1B_BRIDGE"
}

llmm_l1b_firewall_residue() {
  llmm_firewall_pattern="$LLMM_L1B_BRIDGE|${LLMM_L1B_NETWORK_CIDR%/*}|$LLMM_L1B_GATEWAY_ADDRESS"
  llmm_iptables=$(iptables-save) || return 2
  printf '%s\n' "$llmm_iptables" | grep -Eq "$llmm_firewall_pattern" && return 0
  llmm_nft=$(nft list ruleset) || return 2
  printf '%s\n' "$llmm_nft" | grep -Eq "$llmm_firewall_pattern"
}

llmm_l1b_assert_no_process_residue() {
  if llmm_l1b_process_residue; then
    llmm_inspection_status=0
  else
    llmm_inspection_status=$?
  fi
  case "$llmm_inspection_status" in
    0) llmm_l1b_lifecycle_fail "runner-owned process residue is present" ;;
    1) return 0 ;;
    *) llmm_l1b_lifecycle_fail "runner process state could not be inspected" ;;
  esac
}

llmm_l1b_find_first_child() {
  llmm_find_result=$(find "$1" -mindepth 1 -maxdepth 1 -print -quit) ||
    return 2
  [ -n "$llmm_find_result" ]
}

llmm_l1b_assert_find_root_empty() {
  if llmm_l1b_find_first_child "$1"; then
    llmm_find_status=0
  else
    llmm_find_status=$?
  fi
  case "$llmm_find_status" in
    0) llmm_l1b_lifecycle_fail "global Docker runtime root is not empty" ;;
    1) return 0 ;;
    *) llmm_l1b_lifecycle_fail "global Docker runtime root could not be inspected" ;;
  esac
}

llmm_l1b_assert_global_runtime_roots_clean() {
  for llmm_global_root in /var/lib/docker /var/lib/containerd; do
    if [ -L "$llmm_global_root" ] ||
      { [ -e "$llmm_global_root" ] && [ ! -d "$llmm_global_root" ]; }; then
      llmm_l1b_lifecycle_fail "global Docker runtime root is not a regular directory"
      return 1
    fi
    [ ! -d "$llmm_global_root" ] ||
      llmm_l1b_assert_find_root_empty "$llmm_global_root" || return 1
  done
}

llmm_l1b_assert_no_namespace_residue() {
  if llmm_l1b_namespace_residue; then
    llmm_inspection_status=0
  else
    llmm_inspection_status=$?
  fi
  case "$llmm_inspection_status" in
    0) llmm_l1b_lifecycle_fail "pre-existing Docker network namespace residue is present" ;;
    1) return 0 ;;
    *) llmm_l1b_lifecycle_fail "Docker network namespace state could not be inspected" ;;
  esac
}

llmm_l1b_assert_no_network_residue() {
  if llmm_l1b_network_residue; then
    llmm_inspection_status=0
  else
    llmm_inspection_status=$?
  fi
  case "$llmm_inspection_status" in
    0) llmm_l1b_lifecycle_fail "runner-owned bridge, address, route, or namespace residue is present" ;;
    1) return 0 ;;
    *) llmm_l1b_lifecycle_fail "runner network state could not be inspected" ;;
  esac
}

llmm_l1b_mount_state_from_file() {
  llmm_mountinfo_path=$1
  llmm_mount_target=$2
  case "$llmm_mount_target" in
    /*) ;;
    *) return 2 ;;
  esac
  case "$llmm_mount_target" in
    *[!A-Za-z0-9_./-]*) return 2 ;;
  esac
  [ -r "$llmm_mountinfo_path" ] || return 2
  llmm_mount_inventory=$(cat "$llmm_mountinfo_path") || return 2
  printf '%s\n' "$llmm_mount_inventory" | awk -v target="$llmm_mount_target" '
    function valid_path(value, reduced) {
      if (substr(value, 1, 1) != "/") return 0
      reduced = value
      gsub(/\\040|\\011|\\012|\\134/, "", reduced)
      return reduced !~ /\\/
    }
    {
      seen = 1
      separator = NF - 3
      line_invalid = 0
      if (NF < 10) line_invalid = 1
      if (separator < 7) line_invalid = 1
      if (!line_invalid && $(separator) != "-") line_invalid = 1
      if ($1 !~ /^[0-9]+$/) line_invalid = 1
      if ($2 !~ /^[0-9]+$/) line_invalid = 1
      if ($3 !~ /^[0-9]+:[0-9]+$/) line_invalid = 1
      if (!valid_path($4)) line_invalid = 1
      if (!valid_path($5)) line_invalid = 1
      if ($6 !~ /^[^,[:space:]]+(,[^,[:space:]]+)*$/) line_invalid = 1
      if (!line_invalid && $(separator + 1) !~ /^[^[:space:]-][^[:space:]]*$/) line_invalid = 1
      if (!line_invalid && $(separator + 2) !~ /^[^[:space:]]+$/) line_invalid = 1
      if (!line_invalid && $(separator + 3) !~ /^[^,[:space:]]+(,[^,[:space:]]+)*$/) line_invalid = 1
      if ($1 in ids) line_invalid = 1
      ids[$1] = 1
      if (!line_invalid) {
        for (field = 7; field < separator; field += 1) {
          if ($field !~ /^[^[:space:]-][^[:space:]]*$/) line_invalid = 1
        }
      }
      if (line_invalid) invalid = 1
      if (!line_invalid && ($5 == target || index($5, target "/") == 1)) mounted = 1
    }
    END {
      if (!seen || invalid) exit 2
      exit mounted ? 0 : 1
    }
  '
}

llmm_l1b_mount_state() {
  llmm_l1b_mount_state_from_file /proc/self/mountinfo "$1"
}

llmm_l1b_assert_path_unmounted() {
  if llmm_l1b_mount_state "$1"; then
    llmm_mount_status=0
  else
    llmm_mount_status=$?
  fi
  case "$llmm_mount_status" in
    0) llmm_l1b_lifecycle_fail "runner runtime path remains mounted: $1" ;;
    1) return 0 ;;
    *) llmm_l1b_lifecycle_fail "runner runtime mount state could not be inspected: $1" ;;
  esac
}

llmm_l1b_assert_no_firewall_residue() {
  if llmm_l1b_firewall_residue; then
    llmm_firewall_status=0
  else
    llmm_firewall_status=$?
  fi
  case "$llmm_firewall_status" in
    0) llmm_l1b_lifecycle_fail "runner-owned firewall residue is present" ;;
    1) return 0 ;;
    *) llmm_l1b_lifecycle_fail "runner-owned firewall state could not be inspected" ;;
  esac
}

llmm_l1b_preflight() {
  LLMM_L1B_RUNTIME_ROOT=$1
  LLMM_L1B_DOCKER_ROOT=$2
  LLMM_L1B_DOCKER_EXEC=$3
  LLMM_L1B_DOCKER_SOCKET=$4
  LLMM_L1B_DOCKER_PID=$5
  LLMM_L1B_DOCKER_LOG=$6
  LLMM_L1B_DNSMASQ_CONFIG=$7
  LLMM_L1B_DNSMASQ_LOG=$8
  LLMM_L1B_FIREWALL_EVIDENCE=$9

  llmm_l1b_require_root || return 1
  llmm_l1b_require_commands || return 1
  [ -d "$LLMM_L1B_RUNTIME_ROOT" ] ||
    llmm_l1b_lifecycle_fail "assembly runtime root is missing" || return 1
  for llmm_path in \
    "$LLMM_L1B_DOCKER_ROOT" \
    "$LLMM_L1B_DOCKER_EXEC" \
    "$LLMM_L1B_DOCKER_SOCKET" \
    "$LLMM_L1B_DOCKER_PID" \
    "$LLMM_L1B_DOCKER_LOG" \
    "$LLMM_L1B_DNSMASQ_CONFIG" \
    "$LLMM_L1B_DNSMASQ_LOG" \
    "$LLMM_L1B_FIREWALL_EVIDENCE"; do
    llmm_l1b_path_absent "$llmm_path" || return 1
  done
  llmm_l1b_assert_no_process_residue || return 1
  llmm_l1b_assert_global_runtime_roots_clean || return 1
  llmm_l1b_assert_no_namespace_residue || return 1
  llmm_l1b_assert_no_network_residue || return 1
  llmm_l1b_assert_no_firewall_residue || return 1
  [ -x "$LLMM_L1B_FIREWALL_TOOL" ] ||
    llmm_l1b_lifecycle_fail "firewall lifecycle tool is missing" || return 1
  install -d -m 0700 "$LLMM_L1B_FIREWALL_EVIDENCE"
  LLMM_L1B_FIREWALL_INITIAL=$LLMM_L1B_FIREWALL_EVIDENCE/pre-existing
  node "$LLMM_L1B_FIREWALL_TOOL" \
    --action capture \
    --output "$LLMM_L1B_FIREWALL_INITIAL" || return 1
  node "$LLMM_L1B_FIREWALL_TOOL" \
    --action assert-clean \
    --snapshot "$LLMM_L1B_FIREWALL_INITIAL" \
    --bridge "$LLMM_L1B_BRIDGE" \
    --cidr "$LLMM_L1B_NETWORK_CIDR" \
    --gateway "$LLMM_L1B_GATEWAY_ADDRESS" || return 1
  LLMM_L1B_BRIDGE_CREATED=false
  LLMM_L1B_BRIDGE_ALIAS_SET=false
  LLMM_L1B_BRIDGE_IFINDEX=
  LLMM_L1B_FIREWALL_BASELINE_CAPTURED=false
  LLMM_L1B_FIREWALL_ACTIVE_CAPTURED=false
  LLMM_L1B_FIREWALL_CLEANUP_ACTIVE_CAPTURED=false
  LLMM_L1B_DOCKER_LAUNCH_ATTEMPTED=false
}

llmm_l1b_create_bridge() {
  LLMM_L1B_SYS_CLASS_NET=${LLMM_L1B_SYS_CLASS_NET:-/sys/class/net}
  LLMM_L1B_BRIDGE_OWNER="llmm-l1b-$LLMM_L1B_ASSEMBLY-$$"
  ip link add name "$LLMM_L1B_BRIDGE" type bridge
  LLMM_L1B_BRIDGE_CREATED=true
  LLMM_L1B_BRIDGE_IFINDEX=$(cat "$LLMM_L1B_SYS_CLASS_NET/$LLMM_L1B_BRIDGE/ifindex")
  [ -n "$LLMM_L1B_BRIDGE_IFINDEX" ] ||
    llmm_l1b_lifecycle_fail "runner-owned bridge ifindex is missing" || return 1
  ip link set dev "$LLMM_L1B_BRIDGE" alias "$LLMM_L1B_BRIDGE_OWNER"
  LLMM_L1B_BRIDGE_ALIAS_SET=true
  ip address add "$LLMM_L1B_GATEWAY_CIDR" dev "$LLMM_L1B_BRIDGE"
  ip link set dev "$LLMM_L1B_BRIDGE" up
}

llmm_l1b_capture_pre_start_firewall() {
  LLMM_L1B_FIREWALL_BASELINE=$LLMM_L1B_FIREWALL_EVIDENCE/pre-start
  node "$LLMM_L1B_FIREWALL_TOOL" \
    --action capture \
    --output "$LLMM_L1B_FIREWALL_BASELINE"
  LLMM_L1B_FIREWALL_BASELINE_CAPTURED=true
}

llmm_l1b_capture_active_firewall() {
  LLMM_L1B_FIREWALL_ACTIVE=$LLMM_L1B_FIREWALL_EVIDENCE/active
  LLMM_L1B_FIREWALL_ACTIVE_PLAN=$LLMM_L1B_FIREWALL_EVIDENCE/active-delta.json
  node "$LLMM_L1B_FIREWALL_TOOL" \
    --action capture \
    --output "$LLMM_L1B_FIREWALL_ACTIVE" || return 1
  node "$LLMM_L1B_FIREWALL_TOOL" \
    --action plan \
    --baseline "$LLMM_L1B_FIREWALL_BASELINE" \
    --current "$LLMM_L1B_FIREWALL_ACTIVE" \
    --plan "$LLMM_L1B_FIREWALL_ACTIVE_PLAN" \
    --bridge "$LLMM_L1B_BRIDGE" \
    --cidr "$LLMM_L1B_NETWORK_CIDR" \
    --gateway "$LLMM_L1B_GATEWAY_ADDRESS" || return 1
  LLMM_L1B_FIREWALL_ACTIVE_CAPTURED=true
}

llmm_l1b_capture_cleanup_firewall_ceiling() {
  LLMM_L1B_FIREWALL_CLEANUP_ACTIVE=$LLMM_L1B_FIREWALL_EVIDENCE/cleanup-active
  node "$LLMM_L1B_FIREWALL_TOOL" \
    --action capture \
    --output "$LLMM_L1B_FIREWALL_CLEANUP_ACTIVE" || return 1
  node "$LLMM_L1B_FIREWALL_TOOL" \
    --action plan \
    --baseline "$LLMM_L1B_FIREWALL_BASELINE" \
    --current "$LLMM_L1B_FIREWALL_CLEANUP_ACTIVE" \
    --plan "$LLMM_L1B_FIREWALL_EVIDENCE/cleanup-active-delta.json" \
    --bridge "$LLMM_L1B_BRIDGE" \
    --cidr "$LLMM_L1B_NETWORK_CIDR" \
    --gateway "$LLMM_L1B_GATEWAY_ADDRESS" || return 1
  LLMM_L1B_FIREWALL_CLEANUP_ACTIVE_CAPTURED=true
}

llmm_l1b_emit_bounded_docker_log() {
  [ -f "$LLMM_L1B_DOCKER_LOG" ] || return 0
  echo "bounded credential-free Docker log follows" >&2
  tail -n 80 "$LLMM_L1B_DOCKER_LOG" | tail -c 16384 | awk '
    BEGIN { IGNORECASE = 1 }
    !/(authorization|bearer|cookie|credential|password|secret|token)/ { print }
  ' >&2
  echo "complete Docker log preserved at $LLMM_L1B_DOCKER_LOG" >&2
}

llmm_l1b_start_docker() {
  install -d -m 0700 "$LLMM_L1B_DOCKER_ROOT" "$LLMM_L1B_DOCKER_EXEC"
  umask 077
  : > "$LLMM_L1B_DOCKER_LOG"
  chmod 0600 "$LLMM_L1B_DOCKER_LOG"
  dockerd \
    --host "unix://$LLMM_L1B_DOCKER_SOCKET" \
    --data-root "$LLMM_L1B_DOCKER_ROOT" \
    --exec-root "$LLMM_L1B_DOCKER_EXEC" \
    --pidfile "$LLMM_L1B_DOCKER_PID" \
    --bridge "$LLMM_L1B_BRIDGE" \
    --iptables=true \
    --ip-forward=true \
    --storage-driver overlay2 \
    --dns "$LLMM_L1B_GATEWAY_ADDRESS" \
    --log-driver local \
    >"$LLMM_L1B_DOCKER_LOG" 2>&1 &
  LLMM_L1B_DOCKER_LAUNCHER_PID=$!
  LLMM_L1B_DOCKER_LAUNCH_ATTEMPTED=true
}

llmm_l1b_wait_for_docker() {
  llmm_attempt=0
  while [ "$llmm_attempt" -lt 60 ]; do
    if ! kill -0 "$LLMM_L1B_DOCKER_LAUNCHER_PID" 2>/dev/null; then
      set +e
      wait "$LLMM_L1B_DOCKER_LAUNCHER_PID"
      LLMM_L1B_DOCKER_EXIT_STATUS=$?
      set -e
      LLMM_L1B_DOCKER_LAUNCHER_PID=
      llmm_l1b_emit_bounded_docker_log
      llmm_l1b_lifecycle_fail "assembly Docker daemon exited before readiness"
      return 1
    fi
    if DOCKER_HOST="unix://$LLMM_L1B_DOCKER_SOCKET" docker info >/dev/null 2>&1; then
      return 0
    fi
    llmm_attempt=$((llmm_attempt + 1))
    sleep 1
  done
  llmm_l1b_emit_bounded_docker_log
  llmm_l1b_lifecycle_fail "assembly Docker daemon did not become ready"
}

llmm_l1b_verify_docker() {
  llmm_versions=$(DOCKER_HOST="unix://$LLMM_L1B_DOCKER_SOCKET" \
    docker version --format '{{.Client.Version}}|{{.Server.Version}}')
  [ "$llmm_versions" = "29.5.3|29.5.3" ] ||
    llmm_l1b_lifecycle_fail "Docker version differs" || return 1
  [ -S "$LLMM_L1B_DOCKER_SOCKET" ] ||
    llmm_l1b_lifecycle_fail "assembly Docker socket is missing" || return 1
  llmm_observed_root=$(DOCKER_HOST="unix://$LLMM_L1B_DOCKER_SOCKET" \
    docker info --format '{{.DockerRootDir}}')
  [ "$llmm_observed_root" = "$LLMM_L1B_DOCKER_ROOT" ] ||
    llmm_l1b_lifecycle_fail "Docker data root differs" || return 1
  llmm_pid=$(cat "$LLMM_L1B_DOCKER_PID")
  [ "$llmm_pid" = "$LLMM_L1B_DOCKER_LAUNCHER_PID" ] ||
    llmm_l1b_lifecycle_fail "Docker PID differs" || return 1
  llmm_cmdline=$(tr '\000' ' ' < "/proc/$llmm_pid/cmdline")
  printf '%s\n' "$llmm_cmdline" | grep -Fq -- "--data-root $LLMM_L1B_DOCKER_ROOT" ||
    llmm_l1b_lifecycle_fail "Docker data-root argument differs" || return 1
  printf '%s\n' "$llmm_cmdline" | grep -Fq -- "--exec-root $LLMM_L1B_DOCKER_EXEC" ||
    llmm_l1b_lifecycle_fail "Docker exec-root argument differs" || return 1
  printf '%s\n' "$llmm_cmdline" | grep -Fq -- "--bridge $LLMM_L1B_BRIDGE" ||
    llmm_l1b_lifecycle_fail "Docker bridge argument differs" || return 1
  if printf '%s\n' "$llmm_cmdline" | grep -Fq -- "--bip"; then
    llmm_l1b_lifecycle_fail "simultaneous Docker --bridge and --bip is denied"
    return 1
  fi
  [ "$(cat "$LLMM_L1B_SYS_CLASS_NET/$LLMM_L1B_BRIDGE/ifindex")" = "$LLMM_L1B_BRIDGE_IFINDEX" ] ||
    llmm_l1b_lifecycle_fail "runner-owned bridge identity differs" || return 1
  [ "$(cat "$LLMM_L1B_SYS_CLASS_NET/$LLMM_L1B_BRIDGE/ifalias")" = "$LLMM_L1B_BRIDGE_OWNER" ] ||
    llmm_l1b_lifecycle_fail "runner-owned bridge ownership differs" || return 1
  ip -o -4 address show dev "$LLMM_L1B_BRIDGE" | grep -Fq "$LLMM_L1B_GATEWAY_CIDR" ||
    llmm_l1b_lifecycle_fail "runner-owned bridge gateway differs" || return 1
  ip -o -4 route show table all | grep -Eq \
    "^$LLMM_L1B_NETWORK_CIDR dev $LLMM_L1B_BRIDGE([[:space:]]|$)" ||
    llmm_l1b_lifecycle_fail "runner-owned bridge route differs" || return 1
}

llmm_l1b_run_with_docker_watch() {
  "$@" &
  LLMM_L1B_WORK_PID=$!
  (
    while kill -0 "$LLMM_L1B_WORK_PID" 2>/dev/null; do
      if ! kill -0 "$LLMM_L1B_DOCKER_LAUNCHER_PID" 2>/dev/null; then
        kill -TERM "$LLMM_L1B_WORK_PID" 2>/dev/null || true
        exit 99
      fi
      sleep 1
    done
  ) &
  LLMM_L1B_MONITOR_PID=$!
  set +e
  wait "$LLMM_L1B_WORK_PID"
  llmm_work_status=$?
  wait "$LLMM_L1B_MONITOR_PID"
  llmm_monitor_status=$?
  set -e
  LLMM_L1B_WORK_PID=
  LLMM_L1B_MONITOR_PID=
  if [ "$llmm_monitor_status" -eq 99 ]; then
    llmm_l1b_emit_bounded_docker_log
    llmm_l1b_lifecycle_fail "assembly Docker daemon exited while the workload was active"
    return 99
  fi
  return "$llmm_work_status"
}

llmm_l1b_stop_pid() {
  llmm_stop_pid=$1
  [ -n "$llmm_stop_pid" ] || return 0
  kill -TERM "$llmm_stop_pid" 2>/dev/null || true
  llmm_wait=0
  while kill -0 "$llmm_stop_pid" 2>/dev/null && [ "$llmm_wait" -lt 30 ]; do
    llmm_process_state="$(ps -o stat= -p "$llmm_stop_pid" 2>/dev/null | tr -d '[:space:]')"
    case "$llmm_process_state" in
      ""|Z*) break ;;
    esac
    llmm_wait=$((llmm_wait + 1))
    sleep 1
  done
  if kill -0 "$llmm_stop_pid" 2>/dev/null; then
    kill -KILL "$llmm_stop_pid" 2>/dev/null || true
  fi
  wait "$llmm_stop_pid" 2>/dev/null || true
}

llmm_l1b_remove_runtime_paths() {
  for llmm_runtime_path in "$@"; do
    [ -n "$llmm_runtime_path" ] || return 1
    llmm_l1b_assert_path_unmounted "$llmm_runtime_path" || return 1
  done
  for llmm_runtime_path in "$@"; do
    if [ -e "$llmm_runtime_path" ] || [ -L "$llmm_runtime_path" ]; then
      rm -rf -- "$llmm_runtime_path" || return 1
    fi
  done
}

llmm_l1b_cleanup() {
  llmm_cleanup_status=0
  if [ "${LLMM_L1B_FIREWALL_BASELINE_CAPTURED:-false}" = true ] &&
    [ "${LLMM_L1B_DOCKER_LAUNCH_ATTEMPTED:-false}" = true ]; then
    if ! llmm_l1b_capture_cleanup_firewall_ceiling; then
      LLMM_L1B_FIREWALL_CLEANUP_ACTIVE_CAPTURED=false
      llmm_cleanup_status=1
    fi
  fi
  llmm_l1b_stop_pid "${LLMM_L1B_MONITOR_PID:-}" || llmm_cleanup_status=1
  llmm_l1b_stop_pid "${LLMM_L1B_WORK_PID:-}" || llmm_cleanup_status=1
  llmm_l1b_stop_pid "${LLMM_L1B_DNSMASQ_PID:-}" || llmm_cleanup_status=1
  llmm_l1b_stop_pid "${LLMM_L1B_DOCKER_LAUNCHER_PID:-}" || llmm_cleanup_status=1

  if [ -e "$LLMM_L1B_DOCKER_SOCKET" ] || [ -L "$LLMM_L1B_DOCKER_SOCKET" ]; then
    rm -f -- "$LLMM_L1B_DOCKER_SOCKET" || llmm_cleanup_status=1
  fi
  if [ -e "$LLMM_L1B_DOCKER_PID" ] || [ -L "$LLMM_L1B_DOCKER_PID" ]; then
    rm -f -- "$LLMM_L1B_DOCKER_PID" || llmm_cleanup_status=1
  fi

  if [ "${LLMM_L1B_FIREWALL_BASELINE_CAPTURED:-false}" = true ] &&
    [ "${LLMM_L1B_DOCKER_LAUNCH_ATTEMPTED:-false}" = true ] &&
    [ "${LLMM_L1B_FIREWALL_CLEANUP_ACTIVE_CAPTURED:-false}" = true ]; then
    LLMM_L1B_FIREWALL_POST_GRACEFUL=$LLMM_L1B_FIREWALL_EVIDENCE/post-graceful
    LLMM_L1B_FIREWALL_PLAN=$LLMM_L1B_FIREWALL_EVIDENCE/cleanup-plan.json
    if node "$LLMM_L1B_FIREWALL_TOOL" \
      --action capture \
      --output "$LLMM_L1B_FIREWALL_POST_GRACEFUL" &&
      node "$LLMM_L1B_FIREWALL_TOOL" \
        --action cleanup \
        --baseline "$LLMM_L1B_FIREWALL_BASELINE" \
        --active "$LLMM_L1B_FIREWALL_CLEANUP_ACTIVE" \
        --current "$LLMM_L1B_FIREWALL_POST_GRACEFUL" \
        --plan "$LLMM_L1B_FIREWALL_PLAN" \
        --bridge "$LLMM_L1B_BRIDGE" \
        --cidr "$LLMM_L1B_NETWORK_CIDR" \
        --gateway "$LLMM_L1B_GATEWAY_ADDRESS"; then
      LLMM_L1B_FIREWALL_EXACT_CLEANUP=true
    else
      LLMM_L1B_FIREWALL_EXACT_CLEANUP=false
      llmm_cleanup_status=1
    fi
  fi
  if [ "${LLMM_L1B_BRIDGE_CREATED:-false}" = true ]; then
    llmm_current_ifindex=$(cat "$LLMM_L1B_SYS_CLASS_NET/$LLMM_L1B_BRIDGE/ifindex" 2>/dev/null || true)
    llmm_current_alias=$(cat "$LLMM_L1B_SYS_CLASS_NET/$LLMM_L1B_BRIDGE/ifalias" 2>/dev/null || true)
    llmm_expected_alias=
    if [ "${LLMM_L1B_BRIDGE_ALIAS_SET:-false}" = true ]; then
      llmm_expected_alias=$LLMM_L1B_BRIDGE_OWNER
    fi
    if [ "$llmm_current_ifindex" = "$LLMM_L1B_BRIDGE_IFINDEX" ] &&
      [ "$llmm_current_alias" = "$llmm_expected_alias" ]; then
      ip link delete dev "$LLMM_L1B_BRIDGE" type bridge || llmm_cleanup_status=1
    else
      echo "runner-owned bridge identity changed; foreign state was not removed" >&2
      llmm_cleanup_status=1
    fi
  fi

  if [ "${LLMM_L1B_FIREWALL_EXACT_CLEANUP:-false}" = true ]; then
    LLMM_L1B_FIREWALL_FINAL=$LLMM_L1B_FIREWALL_EVIDENCE/final
    if ! node "$LLMM_L1B_FIREWALL_TOOL" \
      --action capture \
      --output "$LLMM_L1B_FIREWALL_FINAL" ||
      ! node "$LLMM_L1B_FIREWALL_TOOL" \
        --action verify-equivalent \
        --baseline "$LLMM_L1B_FIREWALL_BASELINE" \
        --current "$LLMM_L1B_FIREWALL_FINAL"; then
      llmm_cleanup_status=1
    fi
  fi

  LLMM_L1B_BRIDGE_CREATED=false
  LLMM_L1B_BRIDGE_ALIAS_SET=false
  LLMM_L1B_DOCKER_LAUNCHER_PID=
  LLMM_L1B_DNSMASQ_PID=
  LLMM_L1B_WORK_PID=
  LLMM_L1B_MONITOR_PID=
  LLMM_L1B_DOCKER_LAUNCH_ATTEMPTED=false
  llmm_l1b_assert_no_process_residue || llmm_cleanup_status=1
  llmm_l1b_assert_global_runtime_roots_clean || llmm_cleanup_status=1
  llmm_l1b_assert_no_namespace_residue || llmm_cleanup_status=1
  llmm_l1b_assert_no_network_residue || llmm_cleanup_status=1
  llmm_l1b_assert_no_firewall_residue || llmm_cleanup_status=1
  [ ! -e "$LLMM_L1B_DOCKER_SOCKET" ] && [ ! -L "$LLMM_L1B_DOCKER_SOCKET" ] ||
    llmm_cleanup_status=1
  [ ! -e "$LLMM_L1B_DOCKER_PID" ] && [ ! -L "$LLMM_L1B_DOCKER_PID" ] ||
    llmm_cleanup_status=1
  return "$llmm_cleanup_status"
}
