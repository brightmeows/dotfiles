#!/bin/bash
# battery-boost.sh — 电池时关 CPU boost，插电恢复（由 udev 触发，root 运行）
set -u
case "${1:-}" in
  on)  v=1 ;;
  off) v=0 ;;
  *) echo "usage: $0 on|off" >&2; exit 2 ;;
esac
echo "$v" > /sys/devices/system/cpu/cpufreq/boost 2>/dev/null || exit 1
logger -t battery-boost "set boost=$v (trigger=$1)"
