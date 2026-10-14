-- Extra autostart processes.
-- o.launch_on_start("my-service")

-- hypridle（空闲挂起：电池、开盖、空闲 20 分钟；插电或合盖不挂起）由 systemd
-- 用户服务托管，不从这里启动，状态查询用 systemctl --user status hypridle。
-- 规则见 ~/.config/hypr/hypridle.conf。
