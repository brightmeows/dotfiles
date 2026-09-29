# brightmeows.workspaces（工作区组件克隆）

从 Omarchy 内置 `omarchy.workspaces` 克隆而来的用户组件，保留原有工作区切换功能，另加两个圆点标记。

- **新窗口圆点**：新窗口落在所有显示器都不可见的工作区时，该工作区数字下方出现一个小圆点；访问该工作区（在任一显示器上激活）后清除。
- **响铃圆点**：Alacritty 终端响铃时（如 pi 问卷等待输入），本插件的 `bell-flag.sh` 被该终端的 `[bell] command` 调用，记录响铃窗口所在的工作区；状态栏圆点改用 urgent 色，访问该工作区后清除，超过 10 分钟的事件过期作废。

## 历史注记

本插件曾有“新窗口跟随进程”的事后搬迁逻辑（同进程在其他工作区已有窗口时，把新窗口静默搬过去）。2026-09 起窗口落位由菜单与绑定侧的
`meow-launch`（`~/.local/bin/meow-launch`）接管：经 Hyprland exec 规则在窗口 map 前静默落位到发起操作的工作区，
无闪动、不抢焦点、对 GTK/Qt/Electron 一致有效。搬迁逻辑因闪动、抢焦点、覆盖面不足而移除，
`openwindow` 事件仅保留圆点标记职责。随之失效的 `excludeClasses` 配置项一并删除。

## 圆点边界

- 特殊工作区与命名工作区照常点亮圆点，但状态栏只显示并标记 1 到 10 号数字工作区。
- 圆点标记不跨 shell 重启保留（响铃事件文件在 cache 里，重启后仅消费 10 分钟内的新鲜事件）。

## 响铃链路

```
终端 BEL（pi 问卷等）→ Alacritty [bell] command → bell-flag.sh
                                                    ↓ 写 ~/.cache/omarchy/bell-flags/ 事件文件
状态栏组件每秒轮询 → 工作区不可见则亮 urgent 色圆点 → 可见或过期后删除事件文件并熄灭
```

- `bell-flag.sh` 从自身进程向上找到 alacritty 进程，按 pid 查 `hyprctl clients` 得到工作区；窗口已可见时静默退出。
- 只有 Alacritty 接了响铃钩子（`dot_config/alacritty/alacritty.toml` 的 `[bell]`）；foot、kitty、ghostty 若要同样效果需各自接同款命令。
- Hyprland 侧配套 `o.window("Alacritty", { focus_on_activate = false })`（`~/.config/hypr/hyprland.lua`），禁止响铃经 xdg-activation 抢焦点。
- 同文件配套 `o.window("chromium", { no_initial_focus = true, focus_on_activate = false, no_follow_mouse = true })`：agent-browser（chromium 实例）
  操作页面或弹新窗口时不抢焦点，三路全堵（初始焦点、激活请求、悬停聚焦），手动点击聚焦不受影响；弹窗跟随浏览器工作区
  （`initial_workspace_tracking = 1` 下实测落浏览器所在工作区），落不可见工作区时由本插件新窗口圆点提示，
  窗口内操作（导航、点击）不触发提示。接管非 chromium 浏览器（Edge 等）为非目标，届时补同构规则。

## 运维

- 修改本目录的 QML 后若行为没有更新，执行 `omarchy restart shell` 让组件实例重建。
- `omarchy refresh shell` 会把 shell.json 重置为默认（先备份原文件）；之后手动执行 `omarchy plugin enable brightmeows.workspaces` 恢复克隆启用（本插件的 onchange 脚本在模板 hash 未变时不会重跑，`chezmoi -S . apply` 不恢复条目）。
- 回退：`omarchy plugin remove brightmeows.workspaces --yes`，会恢复内置组件。
