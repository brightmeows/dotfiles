# Omarchy shell.json 定制恢复清单

## 背景

`~/.config/omarchy/shell.json` 不入 chezmoi 管理：Omarchy CLI（`omarchy bar`）、bar 自身的拖拽手势、版本升级 migration 三个写手都会就地改写它，入仓托管会与它们永久打架。代价是 `omarchy refresh shell` 把文件重置为默认后，不在脚本调和范围内的定制会丢，需要按本清单手工恢复。

## 自动恢复项（chezmoi apply 即回）

`bar.layout` 里的 `brightmeows.workspaces` 与 `brightmeows.active-window` 条目由
`.chezmoiscripts/run_after_omarchy-*.sh` 每次 apply 调和，插件本体文件由 chezmoi 托管，
这两部分不需要手工恢复。4.5 起 active-window 由脚本插入 `centerBegin`，不是旧的 `center`。

`brightmeows.menu` 曾以零改动克隆的形式留在布局里，2026-10-24 已换回官方 `omarchy.menu` 并删除克隆目录，不再存在恢复项。

## 4.5 布局基线

截至 omarchy 4.5.0，当前布局与默认的差异：

- 时钟：`center` 区 `omarchy.clock` 的 `format` 为 `ddd d MMM HH:mm`（默认 `dddd HH:mm`；`formatAlt` 与 `verticalFormat` 与默认一致，不是定制项）。
- 托盘：`right` 区 `omarchy.tray` 带 `pinned` 五项（chrome、lark、wechat、open-orpheus、Fcitx）与空 `hidden`（默认无这两个字段）。
- 中心左缘：`centerBegin` 是 `brightmeows.active-window`、`omarchy.indicators`；默认只有 `omarchy.indicators`，active-window 由脚本补在最左。
- 中心右缘：`centerEnd` 是 `omarchy.elsewhen`、`omarchy.system-update`、`omarchy.weather`；默认顺序是 `omarchy.elsewhen`、`omarchy.weather`、`omarchy.system-update`。
- 右区：`omarchy.tray`、`omarchy.keyboard-layout`、`omarchy.agents`、`omarchy.bluetooth`、`omarchy.network`、`omarchy.audio`、`omarchy.monitor`、`omarchy.power`；默认相同，tray 在第一项。
- 背景：当前是 `transparent: false`，4.5 的 `Bar.qml` 会把它回退成 opaque；默认用 `background: "opaque"`。两者渲染一致，不列为恢复项。
- Dock：4.5 默认 `shell.json` 含 `dock` 段；当前文件没有。不补不影响顶栏；要配置浮动工作区的 dock 时再参考默认补上。

## 手工恢复项

刷新后只需要补三处：时钟格式、托盘 pinned、centerEnd 顺序。右区顺序与 keyboard-layout 位置跟 4.5 默认一致，不再需要旧版那一步“把 agents 提到 tray 前”。

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

# centerEnd 顺序：elsewhen、system-update、weather
tmp=$(mktemp)
jq '.bar.layout.centerEnd |= (
  ([.[] | select(.id=="omarchy.elsewhen")] +
   [.[] | select(.id=="omarchy.system-update")] +
   [.[] | select(.id=="omarchy.weather")] +
   [.[] | select(.id!="omarchy.elsewhen" and .id!="omarchy.system-update" and .id!="omarchy.weather")])
)' "$config" > "$tmp" && mv "$tmp" "$config"
```

如果 `brightmeows.workspaces` 在刷新后没有回到 `left`，执行 `omarchy plugin enable brightmeows.workspaces`；active-window 由 `chezmoi apply` 的脚本补回。

## 恢复后验证

```bash
jq -r '
  [.bar.layout.center[] | select(.id=="omarchy.clock") | .format],
  [.bar.layout.right[] | select(.id=="omarchy.tray") | .pinned[]],
  [.bar.layout.centerBegin[].id],
  [.bar.layout.centerEnd[].id],
  [.bar.layout.right[].id]
' ~/.config/omarchy/shell.json
```

期望输出依次为 `ddd d MMM HH:mm`、五个 pinned id、`brightmeows.active-window` 与 `omarchy.indicators`、`omarchy.elsewhen` 与 `omarchy.system-update` 与 `omarchy.weather`、以 `omarchy.tray` 开头的右区列表。

## 升级核对提示

omarchy 大版本升级时 migration 会按需改写 `shell.json`。4.5 已落地：center 拆成 `centerBegin`/`center`/`centerEnd`，keyboard-layout 移到右区，tray 移到右区第一项。下次升级后重跑本文档验证命令，并与新版默认 `shell.json`（`$OMARCHY_PATH/config/omarchy/shell.json`）对比新增组件，判断清单是否需要增删。
