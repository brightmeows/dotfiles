# brightmeows.workspaces（工作区组件克隆）

从 Omarchy 内置 `omarchy.workspaces` 克隆而来的用户组件，保留原有工作区切换功能，另加两个圆点标记。

- **新窗口圆点**：新窗口落在所有显示器都不可见的工作区时，该工作区数字下方出现一个小圆点；访问该工作区（在任一显示器上激活）后清除。
- **响铃圆点**：Alacritty 终端响铃时（如 pi 问卷等待输入），本插件的 `bell-flag.sh` 被该终端的 `[bell] command` 调用，记录响铃窗口所在的工作区；状态栏圆点改用 urgent 色，访问该工作区后清除，超过 10 分钟的事件过期作废。

## 职责边界

本插件只做可见性提示（圆点标记）。窗口落位由 `meow-launch` 与 `initial_workspace_tracking` 双轨接管，
决策表见 `~/.config/hypr/WORKSPACES.md`。

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
- chromium 弹窗的焦点拦截规则在 `hyprland.lua`（三路全堵），决策见 `~/.config/hypr/WORKSPACES.md`；
  弹窗落不可见工作区时由本插件新窗口圆点提示，窗口内操作（导航、点击）不触发提示。

## 运维

- 修改本目录的 QML 后若行为没有更新，执行 `omarchy restart shell` 让组件实例重建。
- `omarchy refresh shell` 会把 shell.json 重置为默认（先备份原文件）；之后手动执行 `omarchy plugin enable brightmeows.workspaces` 恢复克隆启用（本插件的 onchange 脚本在模板 hash 未变时不会重跑，`chezmoi apply` 不恢复条目）。
- 回退：`omarchy plugin remove brightmeows.workspaces --yes`，会恢复内置组件。
