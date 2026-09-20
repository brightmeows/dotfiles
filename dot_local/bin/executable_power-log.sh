#!/bin/bash
# power-log.sh — 自然测：拔电使用时后台采样电池功率与系统状态（只读，不改任何配置）
#
# 用法（拔电前启动，可一直挂着）：
#   bash /tmp/agent-cache/power-log.sh >/dev/null 2>&1 &
# 停止：
#   pkill -f power-log.sh
# 数据位置：
#   ~/.local/state/power-log/power-log-*.csv

LOGDIR="$HOME/.local/state/power-log"
mkdir -p "$LOGDIR"
LOG="$LOGDIR/power-log-$(date +%Y%m%d-%H%M%S).csv"

echo "ts,time,status,current_uA,voltage_uV,watts,capacity_pct,cpu_mhz_avg,load1,gpu_busy_pct" > "$LOG"

while true; do
  ts=$(date +%s)
  hhmm=$(date +%H:%M:%S)
  st=$(cat /sys/class/power_supply/BAT1/status 2>/dev/null)
  cu=$(cat /sys/class/power_supply/BAT1/current_now 2>/dev/null)
  vu=$(cat /sys/class/power_supply/BAT1/voltage_now 2>/dev/null)
  cap=$(cat /sys/class/power_supply/BAT1/capacity 2>/dev/null)
  w=$(awk -v c="$cu" -v v="$vu" 'BEGIN{ if (c=="" || v=="") { print ""; exit } if (c<0) c=-c; printf "%.2f", c*v/1e12 }')
  mhz=$(awk '{s+=$1;n++} END { if (n) printf "%d", s/n/1000 }' /sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq 2>/dev/null)
  ld=$(cut -d' ' -f1 /proc/loadavg 2>/dev/null)
  gb=$(cat /sys/class/drm/card1/device/gpu_busy_percent 2>/dev/null)
  echo "$ts,$hhmm,$st,$cu,$vu,$w,$cap,$mhz,$ld,$gb" >> "$LOG"
  sleep 5
done
