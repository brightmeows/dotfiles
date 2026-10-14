-- Change the default Omarchy look'n'feel.

-- https://wiki.hypr.land/Configuring/Basics/Variables/#general
-- hl.config({
--   general = {
--     -- No gaps between windows or borders.
--     gaps_in = 0,
--     gaps_out = 0,
--     border_size = 0,
--
--     -- Change to niri-like side-scrolling layout.
--     layout = "scrolling",
--   },
-- })

-- https://wiki.hypr.land/Configuring/Basics/Variables/#decoration
-- hl.config({
--   decoration = {
--     -- Use round window corners.
--     rounding = 8,
--
--     -- Dim unfocused windows (0.0 = no dim, 1.0 = fully dimmed).
--     dim_inactive = true,
--     dim_strength = 0.15,
--   },
-- })

-- https://wiki.hypr.land/Configuring/Basics/Variables/#animations
-- hl.config({
--   animations = {
--     -- Disable all animations.
--     enabled = false,
--   },
-- })

-- https://wiki.hypr.land/Configuring/Basics/Variables/#layout
-- hl.config({
--   layout = {
--     -- Avoid overly wide single-window layouts on wide screens.
--     single_window_aspect_ratio = { 1, 1 },
--   },
-- })

-- https://wiki.hypr.land/Configuring/Layouts/Scrolling-Layout/
-- hl.config({
--   scrolling = {
--     -- See only one column per screen instead of two.
--     column_width = 0.97,
--   },
-- })

-- 唤醒兑底：屏幕熄灭（dpms off）后任意按键/鼠标移动即点亮显示。
-- 不再依赖开盖 ACPI 事件——BIOS 2.11 上该事件有丢失史
-- （2026-09-14 排查：合盖后 logind 未收到 Lid opened）。
-- 若未来合盖语义变化，此兑底仍有效。
hl.config({
  misc = {
    key_press_enables_dpms = true,
    mouse_move_enables_dpms = true,
    -- 窗口落在发起启动的工作区（xdg-activation token 跟随，single-shot）。
    -- 覆盖 Omarchy 默认 0 的实测依据与菜单启动的第二轨道见 hypr/WORKSPACES.md。
    initial_workspace_tracking = 1,
  },
})

-- 工作区切换动画（fade，200ms）。曲线按数值筛选：在透出不超过上次水平（≤0.37%）的约束下，
-- 最小化“视觉变化速率”（闪烁代理量，取两种叠放顺序的最坏值）。
-- 新曲线峰值斜率 2.78、旧曲线 2.79（原组合 4.35 / 5.33），端点也更快收敛；
-- 模拟指标：透出峰值 0.37% → 0.09%，变化速率峰值 53/s → 28/s。
hl.curve("wsIn",  { type = "bezier", points = { { 0.49, 1.0 }, { 0.16, 1.0 } } })
hl.curve("wsOut", { type = "bezier", points = { { 0.83, 0.0 }, { 0.54, 0.0 } } })
hl.animation({ leaf = "workspacesIn",  enabled = true, speed = 2, bezier = "wsIn",  style = "fade" })
hl.animation({ leaf = "workspacesOut", enabled = true, speed = 2, bezier = "wsOut", style = "fade" })

-- 窗口圆角。Omarchy 默认 rounding = 0（直角）；本文件在 Omarchy 默认与主题之后加载，此值对全部窗口生效。
-- 数值为圆角半径（像素），改大更圆。提示：Omarchy shell 的通知圆角会镜像该值。
-- 注意：若启用 window no gaps 开关（加载在用户文件之后），gaps 与圆角会被它一起清零。
hl.config({
  decoration = {
    rounding = 8,
  },
})
