#!/usr/bin/env bash
# 渲染 Clash Party 覆写壳：party-override.yaml.tmpl -> party-override.yaml（生成物进仓库）。
# 分发：GitHub raw URL 供 Clash Party / Verge Rev 远程导入；改模板或 .fragments/ 片段后必须重新生成。
# --check：仅校验生成物与模板/片段一致（pre-commit 消费），不写回。
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
src="dot_config/clash-meta/party-override.yaml.tmpl"
dst="dot_config/clash-meta/party-override.yaml"

render() {
  # --source 指向仓库根：不依赖 ~/.local/share/chezmoi 建链，hook / 任意 clone 均可运行
  chezmoi execute-template --source "$root" < "$root/$src"
}

if [[ "${1:-}" == "--check" ]]; then
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' EXIT
  render >"$tmp"
  if ! diff -q "$root/$dst" "$tmp" >/dev/null; then
    echo "party-override.yaml 与模板/片段不一致：运行 dot_config/clash-meta/gen-party-override.sh 重新生成" >&2
    diff -u "$root/$dst" "$tmp" | head -40 >&2 || true
    exit 1
  fi
  echo "check: party-override.yaml 与模板/片段一致"
else
  render >"$root/$dst"
  echo "已生成 $dst"
fi
