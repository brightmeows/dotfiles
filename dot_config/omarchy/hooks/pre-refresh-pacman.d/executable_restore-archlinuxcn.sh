#!/usr/bin/env bash
# 自愈钩子：omarchy refresh pacman 重写 /etc/pacman.conf 后恢复 [archlinuxcn] 段
# 由 omarchy-refresh-pacman 在模板覆盖后、升级前调用（omarchy-hook pre-refresh-pacman）
# 幂等：仅当段缺失时追加；sudo -n 非交互提权，失败仅提示不阻断 refresh
set -u

if grep -q '^\[archlinuxcn\]' /etc/pacman.conf 2>/dev/null; then
  exit 0
fi

if [[ $EUID -eq 0 ]]; then
  SUDO=""
elif sudo -n true 2>/dev/null; then
  SUDO="sudo -n"
else
  echo "restore-archlinuxcn: 无免密 sudo，跳过恢复。可手动执行：sudo bash $0"
  exit 0
fi

$SUDO tee -a /etc/pacman.conf > /dev/null <<'REPO'

# Arch Linux CN 社区仓库（USTC 镜像，2026-08-29 配置）
[archlinuxcn]
Include = /etc/pacman.d/mirrorlist-cn
REPO
echo "restore-archlinuxcn: 已恢复 [archlinuxcn] 段至 /etc/pacman.conf"
