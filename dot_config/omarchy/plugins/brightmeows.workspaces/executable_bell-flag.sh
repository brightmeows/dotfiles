#!/bin/sh
# 终端 bell 钩子：记录响铃终端所在的工作区，供 brightmeows.workspaces
# 状态栏组件点亮"待处理"圆点（详见插件 README）。每次响铃写一个事件文件，
# 组件轮询消费：工作区可见即清除，超过 10 分钟视为过期。
# 调用方：alacritty bell.command 与 kitty command_on_bell 共用本脚本。
set -eu

CACHE="${XDG_CACHE_HOME:-$HOME/.cache}"
DIR="$CACHE/omarchy/bell-flags"

# 从本进程向上找到终端进程（alacritty 或 kitty）：bell 钩子的直接父进程就是它，
# 中间夹了包装 shell 也能沿 /proc 爬上去。
pid=$$
term_pid=""
while [ -n "$pid" ] && [ "$pid" -gt 1 ]; do
  case "$(cat "/proc/$pid/comm" 2>/dev/null)" in
    alacritty|kitty) term_pid=$pid; break ;;
  esac
  pid=$(awk '/^PPid:/{print $2}' "/proc/$pid/status" 2>/dev/null)
done
[ -n "$term_pid" ] || exit 0

ws=$(hyprctl -j clients | jq -r --argjson p "$term_pid" \
  '.[] | select(.pid == $p) | .workspace.id' | head -n 1)
case "$ws" in
  '' | *[!0-9]*) exit 0 ;;
esac

# 窗口就在某个显示器可见工作区上：用户看得见它响，无需标记。
if hyprctl -j monitors | jq -e --argjson w "$ws" \
  'any(.[]; .activeWorkspace.id == $w)' >/dev/null 2>&1; then
  exit 0
fi

mkdir -p "$DIR"
: > "$DIR/$(date +%s)-$$-$ws"
