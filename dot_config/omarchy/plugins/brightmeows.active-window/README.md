# brightmeows.active-window（按显示器显示活动窗口标题）

在状态栏显示**当前显示器上**最近聚焦的窗口标题。与内置 `omarchy.active-window` 的区别：内置组件取全局键盘焦点窗口，所有显示器的栏都会显示同一个标题；本组件按栏所在的屏幕各自取标题。

## 行为口径

- 显示器归属：每条栏只显示自己屏幕上的窗口，屏幕由 `QsWindow` 附加属性确定。
- 可见范围：只统计该屏幕当前显示的工作区——普通活动工作区，加上正在显示的特殊工作区（scratchpad）。切到空工作区时标题隐藏，不会显示同屏其它隐藏工作区里的旧窗口。
- 排序：在可见窗口里取 `focusHistoryID` 最小者，即最近聚焦的窗口。
- 标题：窗口 title 为空时回退显示 class（Wayland 的 appId 同样落在 class 字段），两者都为空才隐藏。
- 交互：左键激活该窗口，中键或右键关闭，悬停显示完整标题，超宽按 `maxWidth` 省略（默认 280）。

## 数据与更新

事件驱动：监听 Hyprland 原始事件（焦点切换、窗口开关与移动、标题变更、工作区与特殊工作区、全屏等），去抖约 100ms 后执行一次 `hyprctl -j monitors` 与 `hyprctl -j clients` 的组合查询，取该次快照。

未使用 Quickshell 的 Hyprland 类型，因为每窗口的 `focusHistoryID` 没有对应的 QML 属性，而 `lastIpcObject` 也不会随焦点自动刷新。

## 配置

在 `~/.config/omarchy/shell.json` 的布局条目里覆盖默认值，保存即热重载：

```json
{
  "id": "brightmeows.active-window",
  "maxWidth": 280
}
```

## 运维

- 布局由 `.chezmoiscripts/run_after_omarchy-active-window-enable.sh.tmpl` 调和：条目缺失时插入中区最左（`indicators` 之前），已存在则原地不动。`omarchy refresh shell` 重置 shell.json 后，运行一次 `chezmoi -S . apply` 恢复。
- 修改组件代码后若行为未更新，先试 `omarchy-shell -q shell rescanPlugins`，仍无效再 `omarchy restart shell`。
- 检查启用状态：`omarchy plugin list | rg active-window`；校验清单：`omarchy plugin validate <插件目录>`。
- 回退：`omarchy plugin disable brightmeows.active-window`（或从 shell.json 手动移除该条目）。

## 验收

按场景逐项人工核对；Omarchy 升级后建议复查一次：

1. 两块屏各聚焦一个窗口，确认每栏只显示本屏标题。
2. 跨屏切换焦点，确认两栏各自保持本屏最近聚焦的标题。
3. 把某屏切到空工作区，确认该栏标题隐藏。
4. 显示与隐藏 scratchpad，确认标题跟着出现与消失。
5. 同工作区切换窗口、浏览器切换标签页改变标题，确认栏内文字即时更新。
6. 关闭窗口后确认回退到同屏可见的另一个窗口，或者隐藏。
7. 悬停显示完整标题；长标题按 280 省略。
8. 左键点击标题跳到该窗口；中键或右键点击关闭窗口。
9. `omarchy restart shell` 后复查以上行为。

## 已知限制

- 调和脚本只处理内置栏（`omarchy.bar`）的 `bar.layout`；切换到自定义 bar 选项时脚本不介入。
- 调和脚本用 jq 直接改写 shell.json，与栏的拖拽或其它 CLI 写入存在理论竞态，已用临时文件加原子替换把窗口压到最小。
