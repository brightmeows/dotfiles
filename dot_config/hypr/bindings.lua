-- Keep only your personal keybinding overrides here. Add new bindings or
-- unbind defaults before replacing them.

-- See current bindings and descriptions:
--   omarchy menu keybindings --print

-- To disable every Omarchy default binding, set this in
-- ~/.config/hypr/hyprland.lua before require("default.hypr.omarchy"), then add
-- only the bindings you want below:
--   omarchy_default_bindings = false

-- To disable all preinstalled app/webapp bindings, set:
--   omarchy_preinstalled_bindings = false

-- Add a new binding.
-- o.bind("SUPER + SHIFT + R", "SSH", "alacritty -e ssh your-server")

-- Change an existing binding by unbinding it first, then binding the key again.
-- This example changes SUPER+SPACE from the launcher to the Omarchy root menu.
-- hl.unbind("SUPER + SPACE")
-- o.bind("SUPER + SPACE", "Omarchy menu", "omarchy-menu toggle root")

-- Disable a default binding without replacing it.
-- hl.unbind("SUPER + SHIFT + B")

-- Logitech MX Keys examples:
-- o.bind("SUPER + SHIFT + S", nil, "omarchy-capture-screenshot")
-- o.bind("SUPER + H", nil, "voxtype record toggle")
-- o.bind("SUPER + PERIOD", nil, "omarchy-shell shell toggle omarchy.emojis")

-- 盖盖：锁屏（Omarchy 原逻辑）后熄屏；不再挂起（logind drop-in 已设为 ignore）。
hl.unbind("switch:on:Lid Switch")
o.bind("switch:on:Lid Switch", nil, "~/.local/bin/meow-lid-close", { locked = true })

-- 开盖：恢复 clamshell/显示器状态并点亮屏幕。
hl.unbind("switch:off:Lid Switch")
o.bind("switch:off:Lid Switch", nil, "~/.local/bin/meow-lid-open", { locked = true })

-- Omarchy 4.5 默认把 Ctrl+Space 绑成终端前缀直通（default/hypr/bindings/input-method.lua），
-- 拦截了 fcitx5 的中英切换键；本机决策：Ctrl+Space 归 fcitx5，tmux/herdr 前缀用 Alt+i。
 hl.unbind("CTRL + SPACE")

-- Omarchy 4.5 默认把 R-Alt 绑成听写按住说话（default/hypr/bindings/dictation.lua，ignore_mods），
-- 按下事件被 compositor 消费，lr2oraja 收不到 key press；本机决策：R-Alt 归游戏，听写挪到 R-Ctrl。
hl.unbind("ALT + Alt_R")
o.bind_hold("CTRL + Control_R", "Start dictation (push-to-talk)", "omarchy-dictation start", "Stop dictation (push-to-talk)", "omarchy-dictation stop", { ignore_mods = true })
