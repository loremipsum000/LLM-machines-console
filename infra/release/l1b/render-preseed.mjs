#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

function fail(message) {
  throw new Error(message)
}

function parse(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2)
    values.set(argv[index], argv[index + 1])
  if (
    values.size !== 2 ||
    !values.get("--ssh-public-key") ||
    !values.get("--output")
  ) {
    fail("expected --ssh-public-key FILE --output FILE")
  }
  return values
}

const values = parse(process.argv.slice(2))
const key = readFileSync(resolve(values.get("--ssh-public-key")), "utf8").trim()
if (
  !/^ssh-(?:ed25519|rsa) [A-Za-z0-9+/=]+(?: .*)?$/.test(key) ||
  /[\r\n]/.test(key)
) {
  fail("SSH public key is invalid")
}
const quotedKey = key.replaceAll("'", "'\\''")
const document = `### LLM Machines VM103-L1B disposable builder preseed
d-i debian-installer/locale string en_US.UTF-8
d-i keyboard-configuration/xkb-keymap select us
d-i netcfg/choose_interface select auto
d-i netcfg/get_hostname string llmm-vm103-l1b-builder
d-i netcfg/get_domain string local
d-i mirror/country string manual
d-i mirror/protocol string https
d-i mirror/http/hostname string deb.debian.org
d-i mirror/http/directory string /debian
d-i mirror/http/proxy string
d-i passwd/root-login boolean false
d-i passwd/user-fullname string LLM Machines Builder Operator
d-i passwd/username string dberisha
d-i passwd/user-password-crypted password !
d-i clock-setup/utc boolean true
d-i time/zone string UTC
d-i partman-auto/disk string /dev/sda
d-i partman-auto/method string regular
d-i partman-lvm/device_remove_lvm boolean true
d-i partman-md/device_remove_md boolean true
d-i partman-auto/choose_recipe select atomic
d-i partman-partitioning/confirm_write_new_label boolean true
d-i partman/choose_partition select finish
d-i partman/confirm boolean true
d-i partman/confirm_nooverwrite boolean true
tasksel tasksel/first multiselect standard, ssh-server
d-i pkgsel/include string sudo qemu-guest-agent jq ca-certificates curl git gnupg nftables tar xz-utils zstd
d-i pkgsel/upgrade select none
popularity-contest popularity-contest/participate boolean false
d-i grub-installer/only_debian boolean true
d-i preseed/late_command string \\
  in-target install -d -m 0700 -o dberisha -g dberisha /home/dberisha/.ssh; \\
  in-target /bin/sh -c "printf '%s\\n' '${quotedKey}' > /home/dberisha/.ssh/authorized_keys"; \\
  in-target chown dberisha:dberisha /home/dberisha/.ssh/authorized_keys; \\
  in-target chmod 0600 /home/dberisha/.ssh/authorized_keys; \\
  in-target /bin/sh -c "printf '%s\\n' 'dberisha ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/90-dberisha"; \\
  in-target chmod 0440 /etc/sudoers.d/90-dberisha; \\
  in-target passwd -l dberisha; \\
  in-target systemctl enable qemu-guest-agent ssh
d-i finish-install/reboot_in_progress note
`
writeFileSync(resolve(values.get("--output")), document, {
  flag: "wx",
  mode: 0o600,
})
