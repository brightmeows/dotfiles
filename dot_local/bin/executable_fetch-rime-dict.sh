#!/usr/bin/env bash
# 下载/更新 rime 第三方词库（rime 格式 .dict.yaml）
# 数据文件不入版本控制；多机部署后各自运行本脚本拉取
# 用法: fetch-rime-dict.sh [zhwiki|moegirl|all]   默认 all
# 完成后重启 fcitx5 触发重新编译
set -euo pipefail

RIME_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/fcitx5/rime"

# 词库注册表：每行  name  repo  asset_glob  target_filename
# 加新词库只需在此追加一行
REGISTRY=(
  "zhwiki  felixonmars/fcitx5-pinyin-zhwiki  zhwiki-*.dict.yaml  zhwiki.dict.yaml"
  "moegirl outloudvi/mw2fcitx               moegirl.dict.yaml   moegirl.dict.yaml"
)

fetch_one() {
  local name repo asset target
  read -r name repo asset target <<< "$1"
  echo "==> $name"
  local url
  url=$(curl -fsSL "https://api.github.com/repos/$repo/releases/latest" | python3 -c "
import json, sys, fnmatch
d = json.load(sys.stdin)
pat = sys.argv[1]
cands = [a for a in d['assets'] if fnmatch.fnmatch(a['name'], pat)]
cands.sort(key=lambda a: a['name'], reverse=True)
if not cands:
    sys.exit(f'no asset matching {pat}')
print(cands[0]['browser_download_url'])
" "$asset")
  echo "    $url"
  local tmp
  tmp=$(mktemp)
  curl -fL --progress-bar -o "$tmp" "$url"
  mkdir -p "$RIME_DIR"
  mv "$tmp" "$RIME_DIR/$target"
  echo "    -> $RIME_DIR/$target"
}

target="${1:-all}"
found=0
for entry in "${REGISTRY[@]}"; do
  name=${entry%% *}
  if [ "$target" = all ] || [ "$target" = "$name" ]; then
    fetch_one "$entry"
    found=1
  fi
done

if [ "$found" = 0 ]; then
  echo "未知词库: $target" >&2
  echo "可选: ${REGISTRY[*]%% *}" >&2
  exit 1
fi

echo
echo "完成。重启 fcitx5 以重新编译："
echo "  pkill -x fcitx5 && sleep 1 && setsid fcitx5 </dev/null >/dev/null 2>&1 &"
