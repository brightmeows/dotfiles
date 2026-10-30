# Omarchy tmux 配置的 chezmoi 拼接与 refresh 覆盖恢复

## 背景

三应用键位统一决策（2026-10）：zellij、tmux、herdr 的多路复用键位以 **zellij 字母系为基准**
（Alt+hjkl 焦点、Alt+Shift+hjkl 移窗格、Alt+u/o 切标签、Alt+Shift+u/o 移标签）。

- zellij：基准本体，零改动（`dot_config/zellij/config.kdl`）。
- tmux：上游 Omarchy 配置 + 字母系追加段，见下文拼接方案。
- herdr：直接改 `[keys]`，方向键系只保留 zellij 无对应的增强层
  （分屏 Alt+Enter 系、数字直达 Alt+1..9、resize Ctrl+Alt+Shift+方向键、workspace 切换 Alt+Up/Down）。

## 覆盖机制

`~/.config/tmux/tmux.conf` 是 Omarchy 上游文件（`/usr/share/omarchy/config/tmux/tmux.conf`）。
`omarchy-refresh-tmux`（`omarchy update` 或手动触发）会**覆盖式刷写**该文件，
旧版备份为 `.bak.<时间戳>`。无用户 override 约定，无 hook 点。
`omarchy-launch-terminal-tmux` 走裸 `tmux` 命令（`bash -c` 非交互，shell alias 拦不到），
所以“alias 启动后 source 追加文件”方案覆盖不了 omarchy 官方启动路径。

与 monitors.lua 的主权冲突（见 `omarchy-monitors-lua-除管记录.md`）同类但烈度低一档：
monitors.lua 被 omarchy 运行时持续就地改写，被判除管；tmux.conf 只在低频显式 refresh 时覆盖，
且上游内容本身就是要保留的基底，因此选择**模板拼接对抗覆盖**而非除管。

## 拼接方案

`dot_config/tmux/tmux.conf.tmpl` 用 chezmoi 模板的 `output` 函数实时拉取上游全文，
后接字母系追加段：

```tmpl
{{ output "cat" "/usr/share/omarchy/config/tmux/tmux.conf" }}
# ===== 字母系追加段 =====
...
```

每次 `chezmoi apply` 都重新渲染，上游更新自动纳入，无内容漂移。

模板依赖 `/usr/share/omarchy` 下的上游文件，仅 Omarchy 机器可渲染；非 Omarchy 平台
（如 WSL2 Arch）模板会因读不到上游文件而报错，在 `.chezmoiignore` 按
`osRelease.id` 忽略 `.config/tmux`，apply 不部署。

## refresh 后恢复

omarchy refresh 覆盖 `~/.config/tmux/tmux.conf` 后，字母系失效（上游版生效）。
恢复方法：

```bash
chezmoi apply ~/.config/tmux/tmux.conf
tmux source-file ~/.config/tmux/tmux.conf   # 活 server 即时重载
```

冲突窗口 = refresh 到下次 apply 之间。`omarchy-restart-tmux` 已用上游配置重启的
tmux server 在 source-file 后补齐绑定，无需重启会话。

## 字母系追加段与上游增强层

追加段（`-n` root 表，与 zellij 同名同义）：

| 操作 | 键位 | tmux 实现 |
|---|---|---|
| 焦点 | Alt+hjkl | `select-pane -L/D/U/R` |
| 移动窗格 | Alt+Shift+hjkl | `swap-pane -s '{left-of}'` 等（marker 相对聚焦 pane 与邻格互换，已实测） |
| 切标签 | Alt+u / Alt+o | `previous-window` / `next-window` |
| 移动标签 | Alt+Shift+u / Alt+Shift+o | `swap-window -t ∓1 \; select-window`（焦点跟切，与上游 M-S-Left/Right 同语义） |

上游自带、三应用共有的增强层（保留，不与字母系冲突）：Alt+Enter 系分屏、
Alt+Esc 关窗格、Alt+1..9 数字直达、Ctrl+Alt+Shift+方向键 resize、Alt+Up/Down 切 session。

## 已知限制

- tmux 上游方向键系（C-M-方向键焦点等）保留在配置里，与字母系并存；用户主用字母系。
- resize 无字母直接键（zellij 手感中 resize 在模式内），沿用上游 Ctrl+Alt+Shift+方向键。
- Alt 字母全局拦截与 zellij 现役行为对称：TUI 应用申请 kitty keyboard protocol 时优先收到按键。
