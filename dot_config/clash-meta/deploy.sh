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

# 防火墙放行 tun 接口（best-effort）：system/mixed 栈的 TCP 由 sing-tun NAT 回注、本机内核 TCP 栈终结，
# 回注 SYN 以 iif=tun 接口、conntrack NEW 过 INPUT 链，默认拒绝会静默掐死全部 TCP（含境内直连）
if systemctl is-active --quiet firewalld; then
  echo "▶ 配置 firewalld（将 $TUN_IF 接口置入 trusted zone）"
  firewall-cmd --zone=trusted --change-interface="$TUN_IF" --permanent 2>/dev/null \
    || firewall-cmd --zone=trusted --add-interface="$TUN_IF" --permanent 2>/dev/null || true
  firewall-cmd --reload >/dev/null 2>&1 || true
  echo "✓ firewalld 已配置（best-effort，失败不影响主流程）"
elif command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q 'Status: active'; then
  echo "▶ 配置 ufw（放行 $TUN_IF 接口入站，幂等，持久化于 /etc/ufw/user.rules）"
  ufw allow in on "$TUN_IF" comment 'mihomo tun: sing-tun system stack TCP NAT 回注' >/dev/null
  echo "✓ ufw 已放行"
else
  echo "△ 未检测到 firewalld/ufw（inactive），跳过防火墙放行；若用 system/mixed 栈，请确认 tun 接口入站已放行"
fi

# 部署验证：静默失败（auto-redirect 冲突 / 防火墙掐死回注）的教训——数据路径必须在部署期验证，
# curl 成功即同时覆盖 TCP（回注+出境）与 UDP（DNS 劫持解析）两条路径
echo "▶ 验证 TUN 数据路径"
for _ in $(seq 1 10); do ip link show "$TUN_IF" >/dev/null 2>&1 && break; sleep 1; done
if ! ip link show "$TUN_IF" >/dev/null 2>&1; then
  echo "✗ $TUN_IF 接口未创建：journalctl -u $SERVICE -n 30 查 TUN listening error"
  exit 1
fi
HTTP_CODE=$(curl -m 10 -s -o /dev/null -w '%{http_code}' https://www.gstatic.com/generate_204 || true)
if [ "$HTTP_CODE" = "204" ]; then
  echo "✓ 境外出境正常（HTTP $HTTP_CODE，DNS 劫持 + TCP 回注 + 节点出站均经 tun 验证通过）"
else
  CN_CODE=$(curl -m 6 -s -o /dev/null -w '%{http_code}' https://www.baidu.com || true)
  echo "✗ 境外探测失败（HTTP ${HTTP_CODE:-000}，境内 ${CN_CODE:-000}）。数据路径未通，常见原因："
  if [ "${CN_CODE:-000}" = "200" ]; then
    echo "  境内通而境外不通 → 节点/策略组问题：面板 http://127.0.0.1:9090/ui 查节点延迟与选中状态"
  else
    echo "  境内也不通 → TCP NAT 回注被掐：ufw status 查 $TUN_IF 放行；ip route show table 2022 应非空"
    echo "  查证：nft list chain ip filter ufw-skip-to-policy-input  # 计数随探测增长即中招"
  fi
  echo "  服务日志：journalctl -u $SERVICE -n 30"
  exit 1
fi

echo
echo "完成。"
echo "  查看状态：systemctl status $SERVICE"
echo "  实时日志：journalctl -u $SERVICE -f"
echo "  管理面板：external-controller 监听 127.0.0.1:9090（可用 yacd / metacubexd 连接）"
