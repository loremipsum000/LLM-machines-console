#!/bin/sh
set -eu

usage() {
  echo "usage: bootstrap-builder.sh --assembly-a-device DEVICE --assembly-b-device DEVICE --ssh-public-key FILE" >&2
  exit 2
}

assembly_a_device=
assembly_b_device=
ssh_public_key=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --assembly-a-device) assembly_a_device=$2; shift 2 ;;
    --assembly-b-device) assembly_b_device=$2; shift 2 ;;
    --ssh-public-key) ssh_public_key=$2; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$assembly_a_device" ] && [ -n "$assembly_b_device" ] && [ -n "$ssh_public_key" ] || usage
[ "$(id -u)" -eq 0 ] || { echo "bootstrap must run as root" >&2; exit 1; }
[ "$(dpkg --print-architecture)" = amd64 ] || { echo "builder is not amd64" >&2; exit 1; }
. /etc/os-release
[ "$ID" = debian ] && [ "$VERSION_ID" = 13 ] || { echo "builder is not Debian 13" >&2; exit 1; }
[ -f "$ssh_public_key" ] || { echo "SSH public key file is missing" >&2; exit 1; }
grep -Eq '^ssh-(ed25519|rsa) ' "$ssh_public_key" || { echo "SSH public key format is unsupported" >&2; exit 1; }

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
toolchain_lock=$script_dir/toolchain-lock.json
command -v jq >/dev/null 2>&1 || { echo "jq is required before locked bootstrap" >&2; exit 1; }

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl git gnupg jq nftables openssh-server tar xz-utils zstd

input_root=/var/lib/llmm-l1b/bootstrap-inputs
install -d -m 0700 "$input_root"
jq -c '.hostTools[] | select(.url != null), .dockerPackages[]' "$toolchain_lock" |
while IFS= read -r entry; do
  url=$(printf '%s' "$entry" | jq -r .url)
  expected=$(printf '%s' "$entry" | jq -r .sha256)
  output=$input_root/$(basename "${url%%\?*}")
  if [ ! -f "$output" ]; then
    curl --fail --show-error --location --proto '=https' --tlsv1.2 "$url" --output "$output"
  fi
  actual=$(sha256sum "$output" | awk '{print $1}')
  [ "$actual" = "$expected" ] || { echo "locked bootstrap input differs: $(basename "$output")" >&2; exit 1; }
done

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
# Exact downloaded package bytes are verified above. Debian resolves only their
# declared base-library dependencies.
apt-get install -y --no-install-recommends $docker_debs
systemctl disable --now docker.service docker.socket containerd.service || true

install -d -m 0755 /home/dberisha/.ssh
install -m 0600 "$ssh_public_key" /home/dberisha/.ssh/authorized_keys
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
}

prepare_volume "$assembly_a_device" llmm-l1b-a /srv/llmm-l1b/assembly-a A
prepare_volume "$assembly_b_device" llmm-l1b-b /srv/llmm-l1b/assembly-b B

install -d -m 0700 -o dberisha -g dberisha /srv/llmm-l1b
if [ -e /var/lib/docker ] && [ -n "$(ls -A /var/lib/docker 2>/dev/null)" ]; then
  echo "Docker state appeared on the system disk" >&2
  exit 1
fi

echo "VM103-L1B builder bootstrap completed; outbound policy and assembly execution remain separate."
