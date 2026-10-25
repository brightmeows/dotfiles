# MateBook 续航优化盘问与实施记录

> 盘问日期：2026-09-19 夜至 2026-09-20
> 机器：HUAWEI MateBook（BOM-WXX9 / M1010），Ryzen 5 5500U，14 GiB
> 系统：Omarchy（Arch），内核 linux-omarchy 7.2.5-3（2026-09-18 起）
> 方法：grilling 逐轮盘问 + journal/upower 历史取证 + 逐项改动配验证与回退

## 结论先行

续航无单一元凶，是“电池老化 + 长期结构性耗电 + 若干可修项”的叠加。电池健康度 71.9%（39.74/55.24 Wh，271 循环）是不可逆底盘；本次修掉/接管的有：电池时 CPU boost 不关（已装自动规则）、mihomo 的 DoT 直连 IP 触发 TUN 探测警告风暴（已移除该 fallback）、文件索引器电池上照常索引（已关）、无功率观测手段（已建常驻采样）。内核切换（9-18）对放电率的影响在数据上高度可疑（见下表）但未定罪，对照实验待数据积累后决定。

## 放电数据（upower 历史，已过滤 0 值坏点）

| 日期 | 放电采样均值 | 内核 | 备注 |
|------|------------|------|------|
| 09-13 | 8.81 W | 7.2.3-arch1-3 | |
| 09-14 | 8.41 W | 7.2.3-arch1-3 | |
| 09-15 | 10.37 W | 7.2.3-arch1-3 | |
| 09-16 | 13.36 W | 7.2.3-arch1-3 | 晚间安装并反复测试动态壁纸（journal 佐证） |
| 09-17 | 9.39 W | 7.2.3-arch1-3 | |
| 09-18 | 15.58 W | 08:44 起切 7.2.5-3-omarchy | 白天仍为旧内核 |
| 09-19 | 14.78 W | 7.2.5-3-omarchy | 用户报告“续航不好（今天下午开始）” |
| 09-20 | 11.10 W | 7.2.5-3-omarchy | 改动于 19:53 后陆续落地，未覆盖全天 |

9-18/19 相比 9-13/14/17 平均高约六成，方向与内核切换吻合，但均值混淆使用强度（9-18/19 电池使用时长也更长），不能定罪。最干净的对照是挂起时段功率（负载无关），留待 power-log 积累后做旧内核对照实验（limine 可选旧内核或 snapper 快照启动）。

## 排除项（取证后否决）

| 嫌疑 | 证据 | 结论 |
|------|------|------|
| 充电阈值削减可用容量 | sysfs 报 40-70、upower 报 75-80，实测一路充到 100% 才停 | 两套接口均无实际约束力，排除 |
| mihomo 日志风暴是“这几天的变化” | 9-14 有 77 万行、9-17 有 63.5 万行，9-19 反而 2.8 万 | 长期现象，但仍是真实耗电项，已修（见下） |
| xkbcomp 键位重编译、DNS 降级 | 每天都有，量级稳定 | 长期现象，非变化点 |
| 动态壁纸、workbuddy 常驻 | 壁纸服务自 9-16 晚测试后未再运行；workbuddy 未常驻 | 排除 |
| 用户误设充电阈值 | 用户确认非其所设 | 与实测“不生效”互洽 |

## 已落地改动

| 项 | 内容 | 落点 | 验证 | 回退 |
|----|------|------|------|------|
| battery-boost | udev 规则：拔电关 CPU boost，插电恢复。**2026-09-27 已退役**，理由见下方“退役记录” | 系统侧 `/usr/local/bin/battery-boost.sh`、`/etc/udev/rules.d/99-battery-boost.rules`（源 `dot_config/battery-boost/` 已删除） | 退役后验证：电池上 `powerprofilesctl set` 不再报 `policyN/boost: Invalid argument` | 恢复 `git checkout` 源目录 + `deploy.sh`（需先确认上游 MR #235 状态） |
| mihomo DoT 移除 | fallback 去掉 `tls://8.8.4.4:853`，保留两个 DoH 域名源 | `/etc/mihomo/config.yaml`（源：[dot_config/clash-meta](../../dot_config/clash-meta/)） | 下次挂起恢复/换网后 `get empty name` 日志量 | 恢复 `config.yaml.bak-20260920` |
| localsearch 电池不索引 | `index-on-battery=false` | dconf（gsettings） | 电池时段索引日志消失 | 设回 true |
| power-log 常驻采样 | systemd user 服务，5 秒粒度记录功率/电量/频率/负载/GPU | `~/.local/bin/power-log.sh`、`~/.config/systemd/user/power-log.service`（源：[dot_local/bin](../../dot_local/bin/)、[dot_config/systemd](../../dot_config/systemd/)） | `~/.local/state/power-log/*.csv` 持续落盘 | `systemctl --user disable --now power-log` |

## 退役记录

**battery-boost 退役（2026-09-27）**：它与 power-profiles-daemon（PPD）双头控制 boost 冲突。
内核语义是全局 boost=0 时对任意 per-policy boost 属性的任何写入都返回 EINVAL，
而 PPD 0.30 把 boost 写失败当 fatal、直接中止整个档位应用——只要 battery-boost 在电池上把全局 boost 置 0，
PPD 切档就必然失败（插拔瞬间则是与 udev 异步的竞速），电池开机时 PPD 初始应用也失败。
上游已确认根因（issue #172/#188/#189，MR #235 “amd-pstate: don’t fail profile switch when boost is disabled globally”，
2026-08-13 提交时尚未合并发布），Kali bug #9784 独立复现。
退役决策：battery-boost 的目标（电池关 boost）已包含在 Omarchy 记忆的 `battery=power-saver` 档内
（PPD 对 power-saver 写 boost=0），由 Omarchy shell（`UPower.OnBattery` → `omarchy-powerprofiles-set` → PPD）作为唯一权威。
语义变化：boost 改为跟档位走，电池上手动切 balanced 会重新打开 boost；
若将来需要“电池强制关 boost”硬规则，须等 MR #235 发布后再评估。

## 待数据再定

- **待机耗电**：power-log 积累挂起时段数据后，若占比可观再做唤醒源与设备挂起配置。
- **内核对照**：确认 9-18 后耗电上升则重启旧内核/快照做同场景对比。
- **内存项**（swappiness/THP/beatoraja JVM）：逐项 A/B 实测，收益不明确即回退。
- **WiFi powersave**：Omarchy 注明收益仅零点几瓦且有空闲延迟尖峰代价，实测后再定。

## 观测口径

power-log 的 CSV 每行：`ts,time,status,current_uA,voltage_uV,watts,capacity_pct,cpu_mhz_avg,load1,gpu_busy_pct`。功率由电池端电流电压乘积计算（µA×µV），与 upower 的 energy-rate 同源不同采样，交叉验证用两者差值。
