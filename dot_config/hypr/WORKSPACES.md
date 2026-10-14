# 工作区管理决策表

本文件是工作区管理的唯一权威文档。窗口落位机制横跨多个文件，改动落位行为时先改这里，相关实现文件里的机制注释只留一行指针。

## 层次总览

| 层 | 职责 | 权威位置 |
|----|------|----------|
| 切换 | 键位、翻页、scratchpad、布局切换 | Omarchy 默认绑定，未自定义 |
| 落位 | 新窗口落在哪个工作区 | 双轨制，见下节 |
| 提示 | 不可见工作区有新窗口或响铃时亮圆点 | brightmeows.workspaces 插件 |
| 焦点保护 | 圆点提示的窗口不抢焦点 | hyprland.lua 窗口规则 |

## 键位速查

定义在 `/usr/share/omarchy/default/hypr/bindings/tiling.lua`，本机未覆盖：

- Super+数字：切换到工作区 1 到 10
- Super+Shift+数字：移动窗口过去，视图跟随
- Super+Shift+Alt+数字：移动窗口过去，视图不动
- Super+Tab、Super+Shift+Tab：下一个、上一个工作区
- Super+Ctrl+Tab：回到上次所在的工作区
- Super+滚轮：前后翻页
- Super+S、Super+Alt+S：显示 scratchpad、移入 scratchpad
- Super+L：切换平铺与滚动布局（omarchy-hyprland-workspace-layout-toggle）

## 窗口落位：双轨制

目标：窗口落在“发起它”的工作区，而不是“map 时刻恰好持有焦点”的工作区。

| 启动路径 | 落位机制 | 实现位置 |
|----------|----------|----------|
| 终端、绑定、脚本内启动 | `initial_workspace_tracking = 1`：xdg-activation token 跟随，窗口落回发起工作区（10 秒 single-shot） | looknfeel.lua |
| 菜单启动（uwsm 链） | meow-launch 捕获当前工作区，注入 exec 规则 `[workspace W silent]`，窗口 map 前由 compositor 静默落位 | ~/.local/bin/meow-launch，由 brightmeows.menu 插件统一调用 |

双轨原因：uwsm daemon 常驻后，启动链脱离 Hyprland fork 树，activation token 断掉，第一轨失效；meow-launch 的 exec 规则在 map 前决定工作区，对 GTK、Qt、Electron 一致有效，不依赖 token。

补充语义：

- `initial_workspace_tracking` 取 1 而非 2（persistent）：值 2 会让 portal 对话框也被跟踪，不符合预期；single-shot 的 10 秒窗口覆盖全部实测场景。
- 落位正确性是异步的，不做同步判定。meow-launch 在 hyprctl 不可用或 eval 失败时直接执行原命令，窗口退化为跟随 map 时刻的焦点工作区，保住“能启动”。
- chromium 弹窗跟随浏览器所在工作区（第一轨实测），落不可见工作区时由圆点提示。

## 可见性提示（brightmeows.workspaces 插件）

- 新窗口圆点：新窗口落在所有显示器都不可见的工作区时点亮，任一显示器激活该工作区后清除。
- 响铃圆点：Alacritty 收到 BEL（如 pi 问卷等待输入）时，alacritty.toml 的 `[bell] command` 调用插件的 bell-flag.sh，记录响铃窗口所在工作区；插件轮询点亮 urgent 色圆点，10 分钟过期。
- 圆点只标记 1 到 10 号数字工作区；事件不跨 shell 重启保留。

## 焦点保护（hyprland.lua 窗口规则）

- Alacritty `focus_on_activate = false`：响铃经 xdg-activation 的焦点请求被拦截。
- chromium `no_initial_focus`、`focus_on_activate = false`、`no_follow_mouse` 三路全堵：agent-browser 操作页面或弹新窗口不抢焦点，手动点击聚焦不受影响。

## 运维

- hypr 目录下的 lua 与本文件、~/.local/bin/meow-* 已纳入 chezmoi（仓库 ~/Codes/dotfiles，复制模式）：修改一律编辑仓库源文件后 `chezmoi apply`，直接改 ~/.config 下的部署文件会造出状态分叉。
- shell.json 不入 chezmoi：omarchy CLI（如 omarchy bar）会就地改写它；`omarchy refresh shell` 重置后跑一次 `chezmoi apply`，由 brightmeows 插件的合并脚本恢复 bar 条目。
- `omarchy refresh hyprland` 按固定清单覆盖 7 个 lua 与 json 文件，覆盖前自动备份为 `.bak.时间戳`；清单外文件（含本文件）不受影响。常规 omarchy update 不触碰 ~/.config；升级迁移若就地修补部署文件，用 `chezmoi re-add` 回填源。
- 修改插件 QML 后行为未更新时执行 `omarchy restart shell`。
- 修改 hypr 配置后用 `hyprctl configerrors` 验证。

## 修改规则

落位行为的变更先改本文件，再动实现；实现文件里的机制注释保持一行指针，不复制决策表内容。变更历史交给 git，不在注释里留时间线。
