# zellij / tmux / herdr 键位统一速查

三应用（zellij、tmux 3.8、herdr 0.9.1）的键位统一体系：基准、对照表、已知差异与操作安全。

herdr 本机为 0.9.1（pacman 包），上游已发布 0.9.5：`confirm_close` 关闭保护 0.9.2+ 才生效，#5255 中文输入法场景 prefix 失灵的修复在 0.9.5。
升级时机与路径未拍板，暂维持 0.9.1。

## 设计决策

- **基准**：zellij 字母系（2026-10 拍板）。高频层是全局 Alt 直接键，herdr / tmux 双绑对齐。
- **角色分工**：zellij 是基准本体（零改动）；tmux 是 Omarchy 上游配置 + chezmoi 模板拼接的字母系追加段（覆盖恢复见 [omarchy-tmux-chezmoi拼接与refresh覆盖恢复](omarchy-tmux-chezmoi拼接与refresh覆盖恢复.md)）；herdr 直接改 `[keys]`。
- **prefix**：`Alt+i`，对齐 zellij 模式入口；`Ctrl+Space` 让给 fcitx5 中英文切换（输入法层拦截，TUI 收不到）。tmux 备用 prefix 为上游 `prefix2 C-b`。
- **prefix 层动词统一（2026-11-07 拍板，k 系）**：新建 `n`/`Shift+N`、关闭 `k`/`Shift+K`、重命名 `r`/`Shift+R`、detach `d`，回归 tmux 上游 kill 系惯例位（d=detach / k=kill-window / K=kill-session）。
  退役 c 双绑与 Shift+C/Shift+D 破例，窗格重命名从 Shift+O 归位 Shift+P。窗格层关闭保持 `x`（“x=关闭当前对象”层级语义）与 Alt+Esc 直键。
- **zellij 补分屏直键（2026-11-07）**：`Alt+Enter` 向下分屏、`Alt+Shift+Enter` 向右分屏，三边一拍通；zellij pane 模式 `d`/`r` 保留双路径。t 模式关 tab 保持 `x`——模式内 `k` 已被 hjkl 切标签占用，且模式内单键域与 prefix 层字母本就不同构。
- **两层结构**：字母系层（`Alt+字母` 系直键，三应用全通）+ 增强层（zellij 无对应的便利键：分屏 Enter 系、数字直达、resize 方向键、workspace 上下——zellij 里这些在模式内，直接键是无损加餐）。
- **`Alt+Up/Down` 在 herdr 留空**（2026-10-27）：让给 pane 内的 pi（`Alt+Up` 取回排队消息、模型循环顺序上移，`Alt+Down` 下移），herdr 的 workspace 切换改用 `Alt+Shift+Up/Down`。tmux 侧仍绑 `Alt+Up/Down`，未随动。
- tmux 上游自带的方向键系（`C-M-方向键` 焦点等）保留并存，与字母系物理正交；用户主用字母系。

## 键位对照表

### 控制层

| 操作 | zellij | tmux | herdr |
|---|---|---|---|
| 进控制层 | `Alt+i` 进 normal（持续） | `Alt+i`（一键等待） | `Alt+i`（一键等待） |
| 退出控制层 | `i` / `Esc` / `Enter` | 组合完成自动回 | 组合完成自动回 |
| 备用 prefix | — | `Ctrl+B` | — |
| 发送字面量 Alt+i | — | `Alt+i` `Alt+i` | `Alt+i` `Alt+i` |

### 窗格

| 操作 | zellij | tmux | herdr |
|---|---|---|---|
| 焦点移动 | `Alt+h/j/k/l` | `Alt+h/j/k/l` | `Alt+h/j/k/l` |
| 移动窗格 | `Alt+Shift+H/J/K/L` | `Alt+Shift+H/J/K/L` | `Alt+Shift+H/J/K/L` |
| 上下分屏 | `Alt+Enter` 或 pane 模式 `d` | `Alt+Enter` 或 `Alt+i h` | `Alt+Enter` 或 `Alt+i h` |
| 左右分屏 | `Alt+Shift+Enter` 或 pane 模式 `r` | `Alt+Shift+Enter` 或 `Alt+i v` | `Alt+Shift+Enter` 或 `Alt+i v` |
| 关窗格 | pane 模式 `x` | `Alt+Esc` 或 `Alt+i x` | `Alt+Esc` 或 `Alt+i x` |
| zoom | pane 模式 `f` | `Alt+i z` | `Alt+i z` |
| 最近窗格 | — | `Alt+i ;`（默认残留） | `Alt+i ;` |
| 循环窗格 | — | — | `Alt+i Tab` / `Shift+Tab` |
| 重命名窗格 | pane 模式 `c` | — | `Alt+i Shift+p` |
| 调大小 | resize 模式（`r` 入，hjkl） | `Ctrl+Alt+Shift+方向键` | `Ctrl+Alt+Shift+方向键`；`Alt+i r` 进模式 |

### 标签（tmux 叫 window）

| 操作 | zellij | tmux | herdr |
|---|---|---|---|
| 切前/后 | `Alt+u/o`；normal 模式 `H/L` | `Alt+u/o`；`Alt+i H/L` | `Alt+u/o`；`Alt+i Shift+H/L` |
| 最近标签 | `tab`（locked 直接） | `Alt+i Tab`；`Alt+i l`（默认残留） | **缺，等上游 [#5551](https://github.com/herdrdev/herdr/issues/5551)** |
| 移动标签 | `Alt+Shift+U/O`；t 模式 `,/.` | `Alt+Shift+U/O` | `Alt+Shift+U/O` |
| 数字直达 | t 模式 `1..9`（裸数字） | `Alt+1..9` | `Alt+1..9` |
| 新建 | t 模式 `n` | `Alt+i n` | `Alt+i n` |
| 重命名 | t 模式 `r` | `Alt+i r` | `Alt+i r` |
| 关闭 | t 模式 `x`（模式内 k 被 hjkl 切标签占） | `Alt+i k` | `Alt+i k` |
| 拆窗格到新标签 | t 模式 `b` | `Alt+i b` | **缺，等 #5551** |
| 拆窗格到相邻标签 | t 模式 `[` / `]` | `Alt+i j / J` | **缺，等 #5551** |
| 标签内同步输入 | t 模式 `s` | `Alt+i s`（toggle） | **缺，等 #5551** |

### workspace / session / agent

| 操作 | zellij | tmux | herdr |
|---|---|---|---|
| 切前/后 | o 模式（session 管理） | `Alt+Up/Down`（P/N 已 unbind） | `Alt+Shift+Up/Down`（`Alt+Up/Down` 留给 pi） |
| 新建 / 重命名 / 关闭 | o 模式 `d` 分离、`q` 退出 | `Alt+i N / R / K` | `Alt+i Shift+N / Shift+R / Shift+K` |
| 切上一个/下一个 agent | —（无 agent 概念） | — | `Alt+Left / Alt+Right` |
| agent 索引直达 | — | — | `Alt+i Alt+1..9` |
| goto 搜索 picker | — | — | `Alt+i g`（`j/k` 移动、`b/w/i/d` 状态过滤、`a` 全部终端） |
| workspace 侧栏 | — | — | `Alt+i b` / `Alt+i w` |

### 杂项

| 操作 | zellij | tmux | herdr |
|---|---|---|---|
| 重载配置 | — | `Alt+i q` | `Alt+i q` |
| detach | o 模式 `d` | `Alt+i d` | `Alt+i d` |
| 键位帮助 | — | `Alt+i ?` | `Alt+i ?` |
| 滚回 / 复制 | `s` / `f` 模式（vi 键位） | `Alt+i [`（v 选 y 复） | `Alt+i [`（v 选 y 复，`/` 搜索 n 跳） |
| 编辑回滚缓冲 | scroll 模式 `e` | — | `Alt+i e` |

## 已知差异与缺口

- **prefix+Tab 同键不同义**：tmux 是最近标签，herdr 是循环窗格——herdr 没有 `last_tab` 动作，键位表保留标注，等上游。
- **动词体系统一后的迁移注记（2026-11-07）**：关闭标签从 `Alt+i d` 迁至 `Alt+i k`，detach 从 `Shift+D` 回归 `d`（tmux 上游惯例位），新建 space 从 `Shift+C` 迁至 `Shift+N`，窗格重命名从 `Shift+O` 迁至 `Shift+P`；c 双绑退役。
  原“d 关标签 vs 上游 d=detach”的反转差异随之消除。zellij t 模式关 tab 保持 `x`，勿把 prefix 层的 k 按进模式里。
- **确认行为不对称**：herdr 关 workspace 唯一窗格有确认（`confirm_close = true`，0.9.4+ 保护）；tmux 的 `kill-window` 无确认，`Alt+i k` 在 tmux 是直接杀。
- **最近标签 / 拆窗格到标签 / 同步输入**三样在 herdr 是产品能力缺口（非配置问题），feature request 见 [herdr#5551](https://github.com/herdrdev/herdr/issues/5551)；上游落地后按本表补 `previous/next_tab` 之外的对应动作。
- zellij 的 `[` `]` `b` `s` `tab` 是 t 模式内单键；tmux/herdr 无模式制，统一为 prefix 层。tmux 的 `prefix+[` 是 copy-mode 入口（与 zellij 的 copy 入口 `s`/`f` 本就不同），拆窗格到相邻标签让位为 `j`/`J`。
- 数字直达在 zellij 是 t 模式内裸数字（两拍），tmux/herdr 是 `Alt+数字`（一拍带修饰）——无模式制下的增强，非差异缺陷。
- tmux `prefix+l`（last-window）、`prefix+;`（last-pane）是上游未清的默认残留，语义与统一体系相容，留作双路径。

## 操作安全

- **tmux 测试一律 `tmux -L <名字>` 专用 socket**。默认 socket 禁跑 `kill-server` 等破坏性命令；清理单个会话用 `kill-session`。此规则已写入仓库 AGENTS.md 的 Never Do。
- 背景：2026-10-25 配置验证时在默认 socket 误跑 `kill-server`，活会话（meowt3b、meowui）连同内部进程全部丢失，仅能重建空壳。`setw`/`join-pane` 等行为验证改在 `-L` socket 完成。

## 维护点

- 改键位的位置：`dot_config/zellij/config.kdl`、`dot_config/tmux/tmux.conf.tmpl`（字母系追加段）、`dot_config/herdr/config.toml`。
- 生效方式：zellij 重启会话；tmux `chezmoi apply` 后 `tmux source-file ~/.config/tmux/tmux.conf`；herdr `herdr server reload-config`。
- herdr 能力边界：键位动作全集见 `herdr --default-config` 注释与 <https://herdr.dev/docs/config-reference/>；活绑定用 `Alt+i ?` 查看。
- tmux 覆盖恢复：见 [omarchy-tmux-chezmoi拼接与refresh覆盖恢复](omarchy-tmux-chezmoi拼接与refresh覆盖恢复.md)。
