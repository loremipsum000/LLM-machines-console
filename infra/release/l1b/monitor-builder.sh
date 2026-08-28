#!/bin/sh
set -eu
[ "$#" -eq 2 ] || { echo "usage: monitor-builder.sh ASSEMBLY_ROOT OUTPUT.csv" >&2; exit 2; }
assembly_root=$1
output=$2
case "$assembly_root" in /srv/llmm-l1b/assembly-a|/srv/llmm-l1b/assembly-b) ;; *) echo "unexpected assembly root" >&2; exit 1 ;; esac
[ ! -e "$output" ] || { echo "monitor output already exists" >&2; exit 1; }
printf 'timestamp,used_bytes,available_bytes,mem_available_kib,swap_used_kib,cpu_pressure_avg10,memory_pressure_avg10,io_pressure_avg10\n' > "$output"
while :; do
  timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  used=$(df -B1 --output=used "$assembly_root" | tail -n 1 | tr -d ' ')
  available=$(df -B1 --output=avail "$assembly_root" | tail -n 1 | tr -d ' ')
  mem_available=$(awk '$1=="MemAvailable:" {print $2}' /proc/meminfo)
  swap_total=$(awk '$1=="SwapTotal:" {print $2}' /proc/meminfo)
  swap_free=$(awk '$1=="SwapFree:" {print $2}' /proc/meminfo)
  swap_used=$((swap_total - swap_free))
  cpu_pressure=$(awk -F'[ =]' '$1=="some" {print $3}' /proc/pressure/cpu)
  memory_pressure=$(awk -F'[ =]' '$1=="some" {print $3}' /proc/pressure/memory)
  io_pressure=$(awk -F'[ =]' '$1=="some" {print $3}' /proc/pressure/io)
  printf '%s,%s,%s,%s,%s,%s,%s,%s\n' "$timestamp" "$used" "$available" "$mem_available" "$swap_used" "$cpu_pressure" "$memory_pressure" "$io_pressure" >> "$output"
  sleep 5
done
