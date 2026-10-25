# Omarchy shell.json 定制恢复清单

## 背景

`~/.config/omarchy/shell.json` 不入 chezmoi 管理：Omarchy CLI（`omarchy bar`）、bar 自身的拖拽手势、版本升级 migration 三个写手都会就地改写它，入仓托管会与它们永久打架。代价是 `omarchy refresh shell` 把文件重置为默认后，不在脚本调和范围内的定制会丢，需要按本清单手工恢复。

## 自动恢复项（chezmoi apply 即回）

`bar.layout` 里的 `brightmeows.workspaces` 与 `brightmeows.active-window` 条目由 `.chezmoiscripts/run_after_omarchy-*.sh` 每次 apply 调和，插件本体文件由 chezmoi 托管，这两部分不需要手工恢复。

`brightmeows.menu` 曾以零改动克隆的形式留在布局里，2026-10-24 已换回官方 `omarchy.menu` 并删除克隆目录，不再存在恢复项。

## 手工恢复项（截至 omarchy 4.0.6）

与默认 `shell.json` 的差异共三处：时钟格式、托盘 pinned、右区组件顺序。

- 时钟：`center` 区 `omarchy.clock` 的 `format` 为 `ddd d MMM HH:mm`（默认 `dddd HH:mm`；`formatAlt` 与 `verticalFormat` 与默认一致，不是定制项）。
- 托盘：`right` 区 `omarchy.tray` 带 `pinned` 五项（chrome、lark、wechat、open-orpheus、Fcitx）与空 `hidden`（默认无这两个字段）。
- 顺序：`right` 区 `omarchy.agents` 排在 `omarchy.tray` 之前（默认 tray 在前）。

## 恢复步骤

`omarchy refresh shell` 之后先 `chezmoi apply` 恢复自动项，再逐条执行（shell 热重载，无需重启）：

```bash
config=~/.config/omarchy/shell.json

# 时钟格式
tmp=$(mktemp)
jq '.bar.layout.center |= map(if .id=="omarchy.clock" then .format="ddd d MMM HH:mm" else . end)' "$config" > "$tmp" && mv "$tmp" "$config"

# 托盘 pinned 与 hidden
tmp=$(mktemp)
jq '.bar.layout.right |= map(if .id=="omarchy.tray" then .pinned=["chrome_status_icon_1","lark_status_icon_1","wechat","open-orpheus_status_icon_1","Fcitx"] | .hidden=[] else . end)' "$config" > "$tmp" && mv "$tmp" "$config"

# 右区 agents 提到 tray 前
tmp=$(mktemp)
jq '.bar.layout.right |= ([.[] | select(.id=="omarchy.agents")] + [.[] | select(.id!="omarchy.agents")])' "$config" > "$tmp" && mv "$tmp" "$config"
```

## 恢复后验证

```bash
jq -r '[.bar.layout.center[] | select(.id=="omarchy.clock") | .format], [.bar.layout.right[] | select(.id=="omarchy.tray") | .pinned[]], [.bar.layout.right[0].id]' ~/.config/omarchy/shell.json
```

期望输出依次为 `ddd d MMM HH:mm`、五个 pinned id、`omarchy.agents`。

## 升级核对提示

omarchy 大版本升级时 migration 会按需改写 `shell.json`。quattro 分支已见通知面板移除、bar 组件拖拽移除等待发布变更，4.5 落地后重跑本文档验证命令，并与新版默认 `shell.json`（`$OMARCHY_PATH/config/omarchy/shell.json`）对比新增组件，判断清单是否需要增删。
