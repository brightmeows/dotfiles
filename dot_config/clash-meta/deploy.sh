#!/usr/bin/env bash
# 将 chezmoi 渲染的 mihomo 配置部署到系统位置并重载服务。
#
# 这是“配置归仓库、服务归系统”分层中的系统侧桥梁：
#   - 仓库（chezmoi）：渲染 config.yaml 到 ~/.config/clash-meta/
#   - 本脚本（手动 sudo）：搬运到系统配置目录 + 重载服务 + firewalld
#   - systemd：发行版对应的 mihomo 服务运行
#
# 支持两种发行版布局（自动探测）：
#   - Arch (mihomo-bin/mihomo AUR 包)：/etc/mihomo + mihomo.service（-d /etc/mihomo）
#   - Fedora (clash-meta COPR)：/etc/clash-meta + clash-meta.service（数据在 /var/lib/clash-meta）
#
# 用法：sudo bash ~/.config/clash-meta/deploy.sh
set -euo pipefail

TUN_IF="mihomo"

# 按发行版探测服务与路径布局
if systemctl list-unit-files mihomo.service &>/dev/null && [ -d /etc/mihomo ]; then
  SERVICE="mihomo"
  DST="/etc/mihomo/config.yaml"
  DATA_DIR="/etc/mihomo"        # Arch 上游 unit 用 -d /etc/mihomo，数据与配置同目录
elif systemctl list-unit-files clash-meta.service &>/dev/null && [ -d /etc/clash-meta ]; then
  SERVICE="clash-meta"
  DST="/etc/clash-meta/config.yaml"
  DATA_DIR="/var/lib/clash-meta"
else
  echo "✗ 未找到 mihomo/clash-meta 服务（需先安装对应包）"
  exit 1
fi

# 推断真实用户家目录（避开 sudo 下 $HOME=/root）
REAL_USER="${SUDO_USER:-}"
if [ -z "$REAL_USER" ]; then
  echo "✗ 请用普通用户 sudo 执行（依赖 SUDO_USER），不要直接以 root 身份运行"
  exit 1
fi
REAL_HOME="$(getent passwd "$REAL_USER" | cut -d: -f6)"
SRC="${REAL_HOME}/.config/clash-meta/config.yaml"

# 前置检查
[ "$(id -u)" -eq 0 ] || { echo "✗ 需 root，请用 sudo 执行"; exit 1; }
[ -f "$SRC" ] || { echo "✗ 配置源 $SRC 不存在，先运行 chezmoi -S . apply"; exit 1; }
command -v mihomo >/dev/null 2>&1 || { echo "✗ mihomo 未安装"; exit 1; }

# 配置语法校验（mihomo 自带 -t 检查）
echo "▶ 校验配置语法（mihomo -t）"
if ! mihomo -t -d "$DATA_DIR" -f "$SRC" >/dev/null 2>&1; then
  echo "✗ 配置校验失败，尾部输出："
  mihomo -t -d "$DATA_DIR" -f "$SRC" 2>&1 | tail -30 || true
  exit 1
fi
echo "✓ 配置语法通过"

# 部署配置到系统位置
echo "▶ 安装配置到 $DST"
mkdir -p "$DATA_DIR/proxy_provider" "$DATA_DIR/rule_set"
install -Dm644 "$SRC" "$DST"
echo "✓ 已安装"

# 启动 / 重启服务（首次启动时创建 tun 接口 mihomo）
echo "▶ 启用并重启 $SERVICE"
systemctl enable "$SERVICE" >/dev/null
systemctl restart "$SERVICE"
sleep 1
echo "✓ $SERVICE 已 enable + restart"

# firewalld 放行 tun 接口（与 auto-redirect 共存，best-effort）
if systemctl is-active --quiet firewalld; then
  echo "▶ 配置 firewalld（将 $TUN_IF 接口置入 trusted zone）"
  firewall-cmd --zone=trusted --change-interface="$TUN_IF" --permanent 2>/dev/null \
    || firewall-cmd --zone=trusted --add-interface="$TUN_IF" --permanent 2>/dev/null || true
  firewall-cmd --reload >/dev/null 2>&1 || true
  echo "✓ firewalld 已配置（best-effort，失败不影响主流程）"
fi

echo
echo "完成。"
echo "  查看状态：systemctl status $SERVICE"
echo "  实时日志：journalctl -u $SERVICE -f"
echo "  管理面板：external-controller 监听 127.0.0.1:9090（可用 yacd / metacubexd 连接）"
