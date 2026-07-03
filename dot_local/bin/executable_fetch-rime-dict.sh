#!/usr/bin/env bash
# 下载/更新 rime 第三方词库（rime 格式 .dict.yaml）
# 数据文件不入版本控制；多机部署后各自运行本脚本拉取
# 用法: fetch-rime-dict.sh [zhwiki|moegirl|rime_ice|all]   默认 all
# 完成后重启 fcitx5 触发重新编译
set -euo pipefail

RIME_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/fcitx5/rime"

# ---- 下载函数 ----
# 方式1: release asset（取最新 release 中匹配 glob 的 asset）
fetch_release() {
  local repo=$1 asset_glob=$2 target_rel=$3
  local url
  url=$(curl -fsSL "https://api.github.com/repos/$repo/releases/latest" | python3 -c "
import json, sys, fnmatch
d = json.load(sys.stdin)
pat = sys.argv[1]
cands = [a for a in d['assets'] if fnmatch.fnmatch(a['name'], pat)]
cands.sort(key=lambda a: a['name'], reverse=True)
if not cands:
    sys.exit(f'no asset matching {pat} in {d.get(\"tag_name\",\"?\")}')
print(cands[0]['browser_download_url'])
" "$asset_glob")
  echo "      $url"
  local tmp; tmp=$(mktemp)
  curl -fL --progress-bar -o "$tmp" "$url"
  mv "$tmp" "$RIME_DIR/$target_rel"
  echo "      -> $RIME_DIR/$target_rel"
}

# 方式2: git raw 文件（直接从仓库 main/master 拉指定路径文件）
fetch_git() {
  local repo=$1 src_path=$2 target_rel=$3
  # 优先 main，回退 master
  local url
  url=$(curl -fsSIL -o /dev/null -w '%{http_code}' \
    "https://raw.githubusercontent.com/$repo/main/$src_path")
  local branch=main
  [ "$url" = "404" ] && branch=master
  local full="https://raw.githubusercontent.com/$repo/$branch/$src_path"
  echo "      $full"
  local tmp; tmp=$(mktemp)
  curl -fL --progress-bar -o "$tmp" "$full"
  mkdir -p "$(dirname "$RIME_DIR/$target_rel")"
  mv "$tmp" "$RIME_DIR/$target_rel"
  echo "      -> $RIME_DIR/$target_rel"
}

# ---- 调度：每个词库用 fetch_<name> 函数 ----
fetch_zhwiki()  { echo "==> zhwiki";  fetch_release "felixonmars/fcitx5-pinyin-zhwiki" "zhwiki-*.dict.yaml" "zhwiki.dict.yaml"; }
fetch_moegirl() { echo "==> moegirl"; fetch_release "outloudvi/mw2fcitx"              "moegirl.dict.yaml"  "moegirl.dict.yaml"; }
fetch_rime_ice() {
  echo "==> rime_ice (cn_dicts/*)"
  local repo="iDvel/rime-ice"
  for f in 8105 base ext tencent; do
    fetch_git "$repo" "cn_dicts/${f}.dict.yaml" "cn_dicts/${f}.dict.yaml"
  done
}

# ---- 命令行 ----
all_dicts=(zhwiki moegirl rime_ice)
target="${1:-all}"

if [ "$target" = all ]; then
  for d in "${all_dicts[@]}"; do "fetch_$d"; done
elif printf '%s\n' "${all_dicts[@]}" | grep -qx "$target"; then
  "fetch_$target"
else
  echo "未知词库: $target" >&2
  echo "可选: ${all_dicts[*]}" >&2
  exit 1
fi

echo
echo "完成。重启 fcitx5 以重新编译："
echo "  pkill -x fcitx5 && sleep 1 && setsid fcitx5 </dev/null >/dev/null 2>&1 &"
