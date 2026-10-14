-- See https://wiki.hypr.land/Configuring/Basics/Monitors/
-- List current monitors and supported resolutions with: hyprctl monitors all

-- 本机两块屏均远低于 omarchy 的 retina 假设门槛（PPI 218+）：
-- eDP-1 约 144 PPI（1.25x 有效密度 115），外接 24 寸 1080p 约 92 PPI（1.0x）。
-- GDK 只认整数且无法每屏取值，故全局取 1，与“X11 应用统一 1.0”政策对齐；
-- Super + / 切档时会按“最近整数”自动联写本值。
local omarchy_gdk_scale = 1
local omarchy_monitor_scale = "auto"

hl.env("GDK_SCALE", tostring(omarchy_gdk_scale))
hl.monitor({ output = "", mode = "preferred", position = "auto", scale = omarchy_monitor_scale })

-- Configure a specific monitor.
-- hl.monitor({ output = "DP-2", mode = "2560x1440@144", position = "0x0", scale = 1 })

-- Laptop panel pinned to the origin (explicit rules disable auto-placement,
-- which would otherwise stack monitors to the right of the last explicit one).
hl.monitor({ output = "eDP-1", mode = "preferred", position = "0x0", scale = 1.25 })

-- Huawei SSNB-24: EDID preferred is 60Hz, force its 74.97Hz mode.
-- Matched by description (model + serial), so this applies to this physical
-- unit regardless of which port it is plugged into; any other monitor falls
-- back to the wildcard rule above.
hl.monitor({ output = "desc:Huawei Technologies Co. Inc. SSNB-24 YK22809000039", mode = "1920x1080@74.97", position = "1536x-216", scale = 1 })

-- Portrait/rotated secondary monitor (transform: 1 = 90°, 3 = 270°).
-- hl.monitor({ output = "DP-2", mode = "preferred", position = "auto", scale = 1, transform = 1 })
