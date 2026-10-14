-- Learn how to configure Hyprland: https://wiki.hypr.land/Configuring/Start/

-- Omarchy's bootstrap keeps path setup out of this user config.
dofile((os.getenv("OMARCHY_PATH") or "/usr/share/omarchy") .. "/default/hypr/bootstrap.lua")

-- Disable all Omarchy default bindings. Add your own in hypr/bindings.lua.
-- omarchy_default_bindings = false
--
-- Or disable only bindings for Omarchy's preinstalled apps/web apps while
-- keeping core window-manager bindings:
-- omarchy_preinstalled_bindings = false

-- Load Omarchy defaults.
require("default.hypr.omarchy")

-- Put your personal overrides in these files. They're loaded after Omarchy's
-- defaults so package updates can improve the defaults without rewriting your
-- ~/.config/hypr files.
require("hypr.monitors")
require("hypr.input")
require("hypr.bindings")
require("hypr.looknfeel")
require("hypr.autostart")

-- Toggle config flags dynamically.
require("default.hypr.toggles")

-- Add any other personal Hyprland configuration below.
-- o.window("qemu", { workspace = "5" })

-- 终端响铃（BEL）会触发 xdg-activation 请求焦点（如 pi 弹问卷时），禁止终端响应。
o.window("Alacritty", { focus_on_activate = false })

-- agent-browser（chromium 实例）操作页面或弹新窗口时不抢焦点，避免打扰前台。
-- 三路全堵：新窗口初始焦点、xdg-activation 激活请求、follow_mouse 悬停聚焦；
-- 手动点击聚焦不受影响。接管非 chromium 浏览器（Edge 等）为非目标，届时再补同构规则。
o.window("chromium", {
  no_initial_focus = true,
  focus_on_activate = false,
  no_follow_mouse = true,
})

-- beatoraja（lr2oraja-endlessdream）省电配置。
-- direct_scanout=auto(2) 只对 content_type=game 的窗口生效，故用窗口规则声明类型；
-- 匹配依据：GLFW 在 X11 下默认把 WM_CLASS 设为窗口标题，标题固定以 LR2oraja Endless Dream 开头。
hl.config({ render = { direct_scanout = 2 } })

o.window({ title = "(?i)lr2oraja" }, {
  content = "game",
  tag = "-default-opacity",
  opacity = "1 1",
  no_blur = true,
  no_shadow = true,
})
