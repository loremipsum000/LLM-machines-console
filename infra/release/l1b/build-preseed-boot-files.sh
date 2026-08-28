#!/bin/sh
set -eu

usage() {
  echo "usage: build-preseed-boot-files.sh OFFICIAL.iso PRESEED.cfg OUTPUT_DIRECTORY" >&2
  exit 2
}

[ "$#" -eq 3 ] || usage
official_iso=$1
preseed=$2
output_root=$3
[ -f "$official_iso" ] && [ -f "$preseed" ] || {
  echo "ISO or preseed input is missing" >&2
  exit 1
}
[ ! -e "$output_root" ] || {
  echo "output directory already exists" >&2
  exit 1
}
expected=0b813535dd76f2ea96eff908c65e8521512c92a0631fd41c95756ffd7d4896dc
actual=$(sha256sum "$official_iso" | awk '{print $1}')
[ "$actual" = "$expected" ] || {
  echo "official Debian ISO SHA-256 differs" >&2
  exit 1
}
for command_name in cpio gzip isoinfo; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "$command_name is required" >&2
    exit 1
  }
done

umask 077
mkdir "$output_root"
work_root=$(mktemp -d)
cleanup() {
  rm -rf "$work_root"
}
trap cleanup EXIT INT TERM

isoinfo -R -i "$official_iso" -x /install.amd/vmlinuz > "$output_root/vmlinuz"
isoinfo -R -i "$official_iso" -x /install.amd/initrd.gz > "$work_root/initrd.gz"
[ -s "$output_root/vmlinuz" ] && [ -s "$work_root/initrd.gz" ] || {
  echo "verified Debian installer boot files are missing" >&2
  exit 1
}
gzip -dc "$work_root/initrd.gz" > "$work_root/initrd"
install -m 0600 "$preseed" "$work_root/preseed.cfg"
(
  cd "$work_root"
  printf '%s\n' preseed.cfg | cpio --quiet -H newc -o -A -F initrd
)
gzip -n -9 < "$work_root/initrd" > "$output_root/initrd.gz"
chmod 0600 "$output_root/vmlinuz" "$output_root/initrd.gz"
sha256sum "$output_root/vmlinuz" "$output_root/initrd.gz" > "$output_root/SHA256SUMS"
chmod 0600 "$output_root/SHA256SUMS"
