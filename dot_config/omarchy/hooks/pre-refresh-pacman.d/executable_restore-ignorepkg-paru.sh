#!/usr/bin/env bash
# 自愈钩子：omarchy refresh pacman 重写 /etc/pacman.conf 后恢复 paru 的 IgnorePkg
# 背景：archlinuxcn 的 paru 针对 OpenSSL 4 构建，Omarchy stable 快照尚未跟进，
# 不忽略会让 omarchy update 在依赖解析阶段失败。stable 快照跟进后删除本钩子即解除。
# 幂等：仅当 IgnorePkg 缺失时插入；sudo -n 非交互提权，失败仅提示不阻断 refresh
set -u

CONF=/etc/pacman.conf

grep -q '^IgnorePkg' "$CONF" 2>/dev/null && exit 0

if [[ $EUID -eq 0 ]]; then
  SUDO=""
elif sudo -n true 2>/dev/null; then
  SUDO="sudo -n"
else
  echo "restore-ignorepkg-paru: 无免密 sudo，跳过恢复。可手动执行：sudo bash $0"
  exit 0
fi

$SUDO sed -i '/^\[options\]/a IgnorePkg = paru' "$CONF"
echo "restore-ignorepkg-paru: 已恢复 IgnorePkg 至 $CONF"
