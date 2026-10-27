# Omarchy monitors.lua 除管记录：切档器与 chezmoi 的主权冲突

## 裁决

`~/.config/hypr/monitors.lua` 自 2026-10-18 起退出 chezmoi 管理，文件主权移交 omarchy 运行时（缩放切档器）。`.chezmoiignore` 已相应排除；原文件注释块承载的政策依据由本文承接，恢复入口见文末。

hypr 目录其余文件维持纳管，Omarchy 迁移就地修补仍走“chezmoi 回填”策略：chezmoi 2.73 起优先用 `push` 命令（把目标变更推回源文件），`re-add` 作为重建源条目的备选。monitors.lua 是唯一例外：切档器（`SUPER + SLASH`）每次按键都会 sed 联写通配值，属常态性带外写手，不是一次性迁移修补，回填会与用户运行时选择永久打架。

## 事件（2026-10-17 22:05:15）

按下 `SUPER + SLASH`（Monitor scaling up）触发 `omarchy-hyprland-monitor-scaling up`：runtime 从 1.25 改到 1.6（hyprctl eval），随后 sed 把文件里两行通配值从 `1`/`"auto"` 改写为 `2`/`1.6`。下次 `chezmoi apply` 因活文件哈希（`98185bb9`）偏离记账（`af4dd20d`）触发保护询问。

证据链：`~/.local/state/omarchy/monitor-scaling.log`（秒级时间戳、父进程为 Hyprland 键位派发）；脚本源码的 sed 行为与活文件指纹逐字节吻合（只动两行通配值、保留全部注释、gdk 取 1.6 的最近整数 2）；键位定义在 `/usr/share/omarchy/default/hypr/bindings/tiling.lua`。

## 运行时行为：通配值被显式规则遮蔽

文件后段的显式规则（eDP-1 scale 1.25、华为屏 desc 匹配 74.97Hz）按“后条覆盖前条”在运行时压过通配值。因此切档器写入的通配 scale 对这些屏不生效，实际受影响的是未来未单列的屏。切档器的“最近整数”逻辑（1.6 记为 GDK 2）与 GDK 全局取 1 政策冲突时，以运行时实际生效值为准排查；会话的 GDK 已由 `hyprland.lua` 固定，见下节。

## GDK 固定

`~/.config/hypr/hyprland.lua` 在 `require("hypr.monitors")` 之后固定 `hl.env("GDK_SCALE", "1")`。
monitors.lua 的通配 GDK 仍会被切档器改写，但配置每次重载都会在通配值之后重新写一次 1，
因此会话的 GDK 不再随切档器漂移。monitors.lua 的通配值同步清回 1/1，避免文件内容与实际行为不一致；
新增显示器若没有显式规则，按 1x 处理。

## 政策备案（原注释块承接）

本机两屏远低于 omarchy 的 retina 假设门槛（PPI 218+）：eDP-1 约 144 PPI（1.25 倍有效密度 115），外接 24 寸 1080p 约 92 PPI（1.0 倍）。GDK 只认整数且无法每屏取值，故全局取 1，与 X11 应用统一 1.0 的政策对齐。

## 恢复与验证

git 历史兜底：纳管版本见 `23815ec` 与 `e3bb0a8`，`git show <commit>:dot_config/hypr/monitors.lua` 取回后直接写入 `~/.config/hypr/monitors.lua`。除非推翻本裁决，不要把该文件重新纳入 chezmoi。

切档行为复核：`cat ~/.local/state/omarchy/monitor-scaling.log`；生效值：`hyprctl -j monitors | jq '.[].scale'`；除管生效验证：`chezmoi managed | rg monitors` 应无输出。

GDK 固定验证：`systemctl --user show-environment | rg '^GDK_SCALE='` 与 `tr '\0' '\n' < /proc/$(pgrep -f quickshell | head -1)/environ | rg '^GDK_SCALE='` 均应为 1；改完 hyprland.lua 后 `hyprctl reload` 让新值生效。
