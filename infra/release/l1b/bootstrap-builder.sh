#!/bin/sh
set -eu

usage() {
  echo "usage: bootstrap-builder.sh --assembly-a-device DEVICE --assembly-b-device DEVICE --ssh-public-key FILE --egress-transaction DIRECTORY --firewall-receipt FILE" >&2
  exit 2
}

assembly_a_device=
assembly_b_device=
ssh_public_key=
egress_transaction=
firewall_receipt=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --assembly-a-device) assembly_a_device=$2; shift 2 ;;
    --assembly-b-device) assembly_b_device=$2; shift 2 ;;
    --ssh-public-key) ssh_public_key=$2; shift 2 ;;
    --egress-transaction) egress_transaction=$2; shift 2 ;;
    --firewall-receipt) firewall_receipt=$2; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$assembly_a_device" ] && [ -n "$assembly_b_device" ] && [ -n "$ssh_public_key" ] && [ -n "$egress_transaction" ] && [ -n "$firewall_receipt" ] || usage
[ "$(id -u)" -eq 0 ] || { echo "bootstrap must run as root" >&2; exit 1; }
[ "$(dpkg --print-architecture)" = amd64 ] || { echo "builder is not amd64" >&2; exit 1; }
. /etc/os-release
[ "$ID" = debian ] && [ "$VERSION_ID" = 13 ] || { echo "builder is not Debian 13" >&2; exit 1; }
[ -f "$ssh_public_key" ] || { echo "SSH public key file is missing" >&2; exit 1; }
[ -d "$egress_transaction" ] || { echo "egress transaction directory is missing" >&2; exit 1; }
[ -f "$firewall_receipt" ] || { echo "installed firewall receipt is missing" >&2; exit 1; }
grep -Eq '^ssh-(ed25519|rsa) ' "$ssh_public_key" || { echo "SSH public key format is unsupported" >&2; exit 1; }

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
toolchain_lock=$script_dir/toolchain-lock.json
binding_renderer=$script_dir/render-egress-bindings.py
command -v jq >/dev/null 2>&1 || { echo "jq is required before locked bootstrap" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "python3 is required before locked bootstrap" >&2; exit 1; }

assert_global_runtime_storage_clean() {
  storage_path=$1
  storage_label=$2
  if [ -L "$storage_path" ] || { [ -e "$storage_path" ] && [ ! -d "$storage_path" ]; }; then
    echo "$storage_label global storage path is not a regular directory" >&2
    exit 1
  fi
  storage_entry=
  if [ -d "$storage_path" ]; then
    if ! storage_entry=$(find "$storage_path" -mindepth 1 -maxdepth 1 -print -quit); then
      echo "$storage_label global storage inspection failed" >&2
      exit 1
    fi
  fi
  if [ -n "$storage_entry" ]; then
    echo "$storage_label state appeared on the system disk" >&2
    exit 1
  fi
}

assert_global_runtime_storage_clean /var/lib/docker Docker
assert_global_runtime_storage_clean /var/lib/containerd containerd

binding_root=/var/lib/llmm-l1b/network
install -d -m 0700 "$binding_root"
python3 "$binding_renderer" \
  --format verify-transaction \
  --transaction-directory "$egress_transaction" \
  --firewall-receipt "$firewall_receipt"
bound_transaction=$binding_root/transaction
install -d -m 0700 "$bound_transaction"
for transaction_file in egress-resolution.json transaction.json vm118.firewall; do
  install -m 0600 "$egress_transaction/$transaction_file" "$bound_transaction/$transaction_file"
done
bound_receipt=$binding_root/firewall-receipt.json
install -m 0600 "$firewall_receipt" "$bound_receipt"
python3 "$binding_renderer" \
  --format verify-transaction \
  --transaction-directory "$bound_transaction" \
  --firewall-receipt "$bound_receipt"
bound_resolution=$bound_transaction/egress-resolution.json
hosts_binding=$binding_root/hosts.binding
python3 "$binding_renderer" \
  --resolution "$bound_resolution" \
  --format hosts \
  --output "$hosts_binding"
if grep -q '^# BEGIN LLM MACHINES VM103-L1B EGRESS BINDING$' /etc/hosts; then
  echo "L1B egress binding already exists in /etc/hosts" >&2
  exit 1
fi
cat "$hosts_binding" >> /etc/hosts
python3 "$binding_renderer" --resolution "$bound_resolution" --format verify-system

export DEBIAN_FRONTEND=noninteractive
find /etc/apt -type f \( -name '*.list' -o -name '*.sources' \) \
  -exec sed -i 's|http://security.debian.org/|https://security.debian.org/|g' {} +
if grep -Rqs 'http://security.debian.org/' /etc/apt; then
  echo "Debian security source still requires prohibited tcp/80 egress" >&2
  exit 1
fi
cat > /etc/apt/apt.conf.d/99-llmm-l1b-network <<'EOF'
Acquire::ForceIPv4 "true";
APT::Update::Error-Mode "any";
EOF
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl git gnupg jq nftables openssh-server tar xz-utils zstd

input_root=/var/lib/llmm-l1b/bootstrap-inputs
install -d -m 0700 "$input_root"
locked_inputs=$input_root/locked-inputs.jsonl
jq -ce '[(.hostTools[] | select(.url != null)), .dockerPackages[]] | .[]' \
  "$toolchain_lock" > "$locked_inputs"
while IFS= read -r entry; do
  url=$(printf '%s' "$entry" | jq -r .url)
  expected=$(printf '%s' "$entry" | jq -r .sha256)
  output=$input_root/$(basename "${url%%\?*}")
  if [ ! -f "$output" ]; then
    curl --fail --show-error --location --proto '=https' --tlsv1.2 "$url" --output "$output"
  fi
  actual=$(sha256sum "$output" | awk '{print $1}')
  [ "$actual" = "$expected" ] || { echo "locked bootstrap input differs: $(basename "$output")" >&2; exit 1; }
done < "$locked_inputs"

node_archive=$(jq -r '.hostTools[] | select(.id == "node") | .url' "$toolchain_lock")
node_archive=$input_root/$(basename "$node_archive")
node_root=/opt/llmm/node-v22.23.2
[ ! -e "$node_root" ] || { echo "Node target already exists" >&2; exit 1; }
install -d -m 0755 /opt/llmm
tar -xJf "$node_archive" -C /opt/llmm
mv /opt/llmm/node-v22.23.2-linux-x64 "$node_root"
ln -s "$node_root/bin/node" /usr/local/bin/node
ln -s "$node_root/bin/corepack" /usr/local/bin/corepack
ln -s "$node_root/bin/npm" /usr/local/bin/npm
ln -s "$node_root/bin/npx" /usr/local/bin/npx
pnpm_archive_url=$(jq -r '.hostTools[] | select(.id == "pnpm") | .url' "$toolchain_lock")
pnpm_archive=$input_root/$(basename "$pnpm_archive_url")
pnpm_root=/opt/llmm/pnpm-10.0.0
"$node_root/bin/npm" install \
  --global \
  --prefix "$pnpm_root" \
  --ignore-scripts \
  --no-audit \
  --no-fund \
  "$pnpm_archive"
ln -s "$pnpm_root/bin/pnpm" /usr/local/bin/pnpm
ln -s "$pnpm_root/bin/pnpx" /usr/local/bin/pnpx

docker_debs=
for package_id in containerd.io docker-ce-cli docker-ce docker-buildx-plugin; do
  package_url=$(jq -r --arg id "$package_id" '.dockerPackages[] | select(.id == $id) | .url' "$toolchain_lock")
  docker_debs="$docker_debs $input_root/$(basename "$package_url")"
done
dnsmasq_url=$(jq -r '.hostTools[] | select(.id == "dnsmasq") | .url' "$toolchain_lock")
dnsmasq_deb=$input_root/$(basename "$dnsmasq_url")
iproute2_url=$(jq -r '.hostTools[] | select(.id == "iproute2") | .url' "$toolchain_lock")
iproute2_deb=$input_root/$(basename "$iproute2_url")
runtime_units="docker.service docker.socket containerd.service"
# Exact downloaded package bytes are verified above. Debian resolves only their
# declared base-library dependencies.
service_start_guard=/usr/sbin/policy-rc.d
if [ -e "$service_start_guard" ] || [ -L "$service_start_guard" ]; then
  echo "pre-existing service-start policy blocks locked bootstrap" >&2
  exit 1
fi
service_start_guard_active=true
cleanup_service_start_guard() {
  if [ "$service_start_guard_active" = true ]; then
    rm -f "$service_start_guard"
  fi
}
trap cleanup_service_start_guard EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
umask 022
printf '%s\n' '#!/bin/sh' 'exit 101' > "$service_start_guard"
chmod 0755 "$service_start_guard"
apt-get install -y --no-install-recommends $docker_debs "$dnsmasq_deb" "$iproute2_deb"
systemctl disable --now $runtime_units
for runtime_unit in $runtime_units; do
  runtime_state=$(systemctl is-active "$runtime_unit" 2>/dev/null || true)
  [ "$runtime_state" = inactive ] || { echo "$runtime_unit became active during bootstrap" >&2; exit 1; }
  runtime_enablement=$(systemctl is-enabled "$runtime_unit" 2>/dev/null || true)
  [ "$runtime_enablement" = disabled ] || { echo "$runtime_unit remains enabled after bootstrap" >&2; exit 1; }
done
assert_global_runtime_storage_clean /var/lib/docker Docker
assert_global_runtime_storage_clean /var/lib/containerd containerd
[ "$(dpkg-query -W -f='${Version}' iproute2)" = "6.15.0-1" ] || {
  echo "iproute2 package version differs" >&2
  exit 1
}
ip -Version | grep -Fq "ip utility, iproute2-6.15.0" || {
  echo "iproute2 binary version differs" >&2
  exit 1
}
rm -f "$service_start_guard"
service_start_guard_active=false
trap - EXIT HUP INT TERM

install -d -m 0755 /home/dberisha/.ssh
authorized_keys=/home/dberisha/.ssh/authorized_keys
if [ "$ssh_public_key" -ef "$authorized_keys" ]; then
  chmod 0600 "$authorized_keys"
else
  install -m 0600 "$ssh_public_key" "$authorized_keys"
fi
chown -R dberisha:dberisha /home/dberisha/.ssh
passwd -l dberisha >/dev/null
cat > /etc/ssh/sshd_config.d/90-llmm-l1b.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
AllowUsers dberisha
EOF
sshd -t
systemctl restart ssh

prepare_volume() {
  device=$1
  label=$2
  mountpoint=$3
  assembly=$4
  [ -b "$device" ] || { echo "assembly device is missing: $device" >&2; exit 1; }
  [ -z "$(wipefs -n "$device" 2>/dev/null)" ] || { echo "assembly device contains an existing signature: $device" >&2; exit 1; }
  mkfs.ext4 -F -L "$label" "$device"
  install -d -m 0700 "$mountpoint"
  uuid=$(blkid -s UUID -o value "$device")
  printf 'UUID=%s %s ext4 defaults,nodev,nosuid 0 2\n' "$uuid" "$mountpoint" >> /etc/fstab
  mount "$mountpoint"
  chown dberisha:dberisha "$mountpoint"
  chmod 0700 "$mountpoint"
  cat > "$mountpoint/.llmm-l1b-volume.json" <<EOF
{"schema":"llm-machines.vm103-l1b-volume.v1","assembly":"$assembly","capacityGiB":80,"filesystem":"ext4","uuid":"$uuid"}
EOF
  chown dberisha:dberisha "$mountpoint/.llmm-l1b-volume.json"
  chmod 0600 "$mountpoint/.llmm-l1b-volume.json"
  install -d -m 0700 -o dberisha -g dberisha \
    "$mountpoint/.llmm-l1b-egress-transaction"
  for transaction_file in egress-resolution.json transaction.json vm118.firewall; do
    install -m 0600 -o dberisha -g dberisha \
      "$bound_transaction/$transaction_file" \
      "$mountpoint/.llmm-l1b-egress-transaction/$transaction_file"
  done
  install -m 0600 -o dberisha -g dberisha \
    "$bound_receipt" "$mountpoint/.llmm-l1b-firewall-receipt.json"
}

prepare_volume "$assembly_a_device" llmm-l1b-a /srv/llmm-l1b/assembly-a A
prepare_volume "$assembly_b_device" llmm-l1b-b /srv/llmm-l1b/assembly-b B

install -d -m 0700 -o dberisha -g dberisha /srv/llmm-l1b

echo "VM103-L1B builder bootstrap completed; outbound policy and assembly execution remain separate."
