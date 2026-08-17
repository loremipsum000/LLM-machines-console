#!/bin/sh
set -eu

usage() {
  echo "usage: manage-vm118-installer-disks.sh isolate|restore" >&2
  exit 2
}

[ "$#" -eq 1 ] || usage
action=$1
case "$action" in isolate|restore) ;; *) usage ;; esac
[ "$(id -u)" -eq 0 ] || {
  echo "VM118 disk transition must run as root on the Proxmox host" >&2
  exit 1
}

qm=/usr/sbin/qm
zfs=/usr/sbin/zfs
blkdiscard=/usr/sbin/blkdiscard
vmid=118
system_volume=local-zfs:vm-118-disk-0
assembly_a_volume=local-zfs:vm-118-disk-1
assembly_b_volume=local-zfs:vm-118-disk-2
assembly_a_dataset=rpool/data/vm-118-disk-1
assembly_b_dataset=rpool/data/vm-118-disk-2
evidence_snapshot=pre-single-disk-install-dde4e36

for executable in "$qm" "$zfs" "$blkdiscard"; do
  [ -x "$executable" ] || {
    echo "required Proxmox host executable is missing: $executable" >&2
    exit 1
  }
done
[ "$($qm status "$vmid")" = "status: stopped" ] || {
  echo "VM118 must be stopped for the disk transition" >&2
  exit 1
}

config=$($qm config "$vmid")
require_line() {
  printf '%s\n' "$config" | grep -F -q "$1" || {
    echo "VM118 disk identity differs: $1" >&2
    exit 1
  }
}
require_once() {
  count=$(printf '%s\n' "$config" | grep -F -c "$1" || true)
  [ "$count" -eq 1 ] || {
    echo "VM118 volume identity is missing or duplicated: $1" >&2
    exit 1
  }
}
require_line "scsi0: $system_volume,discard=on,iothread=1,size=40G,ssd=1"
require_once "$system_volume"

snapshot_once() {
  dataset=$1
  snapshot=$dataset@$evidence_snapshot
  if ! "$zfs" list -H -t snapshot -o name "$snapshot" >/dev/null 2>&1; then
    "$zfs" snapshot "$snapshot"
  fi
}

case "$action" in
  isolate)
    require_line "scsi1: $assembly_a_volume,discard=on,iothread=1,size=80G,ssd=1"
    require_line "scsi2: $assembly_b_volume,discard=on,iothread=1,size=80G,ssd=1"
    require_once "$assembly_a_volume"
    require_once "$assembly_b_volume"
    snapshot_once "$assembly_a_dataset"
    snapshot_once "$assembly_b_dataset"
    "$qm" set "$vmid" --delete scsi1
    if ! "$qm" set "$vmid" --delete scsi2; then
      "$qm" set "$vmid" --scsi1 "$assembly_a_volume,discard=on,iothread=1,ssd=1"
      exit 1
    fi
    config=$($qm config "$vmid")
    ! printf '%s\n' "$config" | grep -E -q '^scsi[12]:' || {
      echo "an assembly disk remained attached during installation" >&2
      exit 1
    }
    require_once "$assembly_a_volume"
    require_once "$assembly_b_volume"
    ;;
  restore)
    ! printf '%s\n' "$config" | grep -E -q '^scsi[12]:' || {
      echo "assembly disks must remain detached before restore" >&2
      exit 1
    }
    require_once "$assembly_a_volume"
    require_once "$assembly_b_volume"
    "$zfs" list -H -t snapshot -o name "$assembly_a_dataset@$evidence_snapshot" >/dev/null
    "$zfs" list -H -t snapshot -o name "$assembly_b_dataset@$evidence_snapshot" >/dev/null
    "$blkdiscard" -f "/dev/zvol/$assembly_a_dataset"
    "$blkdiscard" -f "/dev/zvol/$assembly_b_dataset"
    "$qm" set "$vmid" --scsi1 "$assembly_a_volume,discard=on,iothread=1,ssd=1"
    "$qm" set "$vmid" --scsi2 "$assembly_b_volume,discard=on,iothread=1,ssd=1"
    config=$($qm config "$vmid")
    require_line "scsi1: $assembly_a_volume,discard=on,iothread=1,size=80G,ssd=1"
    require_line "scsi2: $assembly_b_volume,discard=on,iothread=1,size=80G,ssd=1"
    require_once "$assembly_a_volume"
    require_once "$assembly_b_volume"
    ;;
esac

echo "VM118 installer disk transition completed: $action"
