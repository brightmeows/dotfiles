# enter-archive.yazi

回车 = 进压缩包浏览（解压到 `~/.cache/yazi/archive/` 缓存并进入），`o` = 整包解压到包旁；
目录与普通文件保持默认 `open` 行为。

设计决策（后端分工、缓存键、分卷族识别、加密包行为）全部记录在 `main.lua` 头部注释，
以注释为唯一文档，改动请同步更新。

绑定见 `~/.config/yazi/keymap.toml` 的 `enter-archive` 两段 `prepend_keymap`。
