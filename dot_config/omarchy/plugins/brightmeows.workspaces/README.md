# brightmeows.workspaces（工作区组件克隆）

从 Omarchy 内置 `omarchy.workspaces` 克隆而来的用户组件，保留原有工作区切换功能，另加两个行为。

- **新窗口跟随进程**：应用在当前聚焦工作区新建窗口、而同一进程在别的工作区已有窗口时，新窗口被静默移到该进程最近聚焦窗口所在的工作区，不抢焦点、不切工作区。
- **新窗口圆点**：新窗口落在所有显示器都不可见的工作区时，该工作区数字下方出现一个小圆点；访问该工作区（在任一显示器上激活）后清除。

## 规则边界

- 只纠正默认落位：窗口被窗口规则显式放到别处（例如 `o.window(..., { workspace = "8 silent" })`）时不搬迁。
- 同一进程的窗口分布在多个工作区时，目标取最近聚焦（focusHistoryID 最小）窗口所在的工作区。
- 特殊工作区与命名工作区照常跟随，但状态栏只显示并标记 1 到 10 号数字工作区。
- 圆点标记不跨 shell 重启保留。

## 配置

`excludeClasses`（字符串数组，默认空）按类名子串匹配，大小写不敏感；命中的应用不做搬迁，圆点标记不受影响。写在 `~/.config/omarchy/shell.json` 的布局条目里：

```json
{
  "id": "brightmeows.workspaces",
  "excludeClasses": ["microsoft-edge"]
}
```

保存后热重载。

## 运维

- 修改本目录的 QML 后若行为没有更新，执行 `omarchy restart shell` 让组件实例重建。
- `omarchy refresh shell` 会把 shell.json 重置为默认（先备份原文件）；之后运行一次 `chezmoi -S . apply`，或手动执行 `omarchy plugin enable brightmeows.workspaces` 恢复启用。
- 回退：`omarchy plugin remove brightmeows.workspaces --yes`，会恢复内置组件。
