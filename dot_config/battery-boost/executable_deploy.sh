#!/usr/bin/env bash
# 将 battery-boost 物料部署到系统位置（幂等），并用重放的电源事件做机制级验证。
#
#   - /usr/local/bin/battery-boost.sh（boost 开关脚本，udev 触发）
#   - /etc/udev/rules.d/99-battery-boost.rules（拔电关 boost，插电恢复）
#
# 用法：sudo bash ~/.config/battery-boost/deploy.sh
set -euo pipefail

REAL_USER="${SUDO_USER:-}"
if [ -z "$REAL_USER" ]; then
  echo "✗ 请用普通用户 sudo 执行（依赖 SUDO_USER），不要直接以 root 身份运行"
  exit 1
fi
REAL_HOME="$(getent passwd "$REAL_USER" | cut -d: -f6)"
SRC="$REAL_HOME/.config/battery-boost"

[ "$(id -u)" -eq 0 ] || { echo "✗ 需 root，请用 sudo 执行"; exit 1; }
[ -f "$SRC/battery-boost.sh" ] || { echo "✗ 物料 $SRC 不存在，先运行 chezmoi -S . apply"; exit 1; }
[ -f /sys/devices/system/cpu/cpufreq/boost ] || { echo "✗ 内核无 cpufreq boost 接口，本机不适用"; exit 1; }

echo "▶ 安装 boost 切换脚本与 udev 规则"
install -m 755 "$SRC/battery-boost.sh" /usr/local/bin/battery-boost.sh
install -m 644 "$SRC/99-battery-boost.rules" /etc/udev/rules.d/99-battery-boost.rules
udevadm control --reload
echo "✓ 已安装并 reload"

echo "▶ 重放 ACAD change 事件做机制级验证"
udevadm trigger --sysname-match=ACAD --action=change 2>/dev/null || true
sleep 1
STATE="$(cat /sys/devices/system/cpu/cpufreq/boost)"
ONLINE="$(cat /sys/class/power_supply/ACAD/online 2>/dev/null || echo 1)"
# boost 与 online 同值：插电（1）开，电池（0）关
EXPECTED="$ONLINE"
if [ "$STATE" = "$EXPECTED" ]; then
  echo "✓ boost=$STATE 与电源状态（AC online=$ONLINE）一致"
else
  echo "✗ boost=$STATE 与预期 $EXPECTED 不一致，查 journalctl -t battery-boost"
  exit 1
fi

echo
echo "完成。日常验证："
echo "  拔电后 cat /sys/devices/system/cpu/cpufreq/boost 应为 0，插电回 1"
echo "  触发日志：journalctl -t battery-boost"
echo "  回退：删除上述两个系统文件后 sudo udevadm control --reload"
