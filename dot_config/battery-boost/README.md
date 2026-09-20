# battery-boost：电池时关 CPU boost

笔记本拔电时由 udev 规则自动关闭 CPU boost（`/sys/devices/system/cpu/cpufreq/boost`），插电恢复。
amd_pstate 下关闭 boost 可抑制突发频率冲顶，是电池续航最直接的省电项之一；代价是电池时峰值性能
下降（突发响应、游戏帧率）。

## 物料

| 文件 | 部署目标 |
|----|----|
| `battery-boost.sh` | `/usr/local/bin/battery-boost.sh` |
| `99-battery-boost.rules` | `/etc/udev/rules.d/99-battery-boost.rules` |

规则监听 `power_supply` 子系统 Mains 类型的 `online` 属性变化（0/1），经 `systemd-run --no-block`
异步执行，不在 udev 事件上下文里阻塞。

## 部署

```bash
chezmoi -S . apply
sudo bash ~/.config/battery-boost/deploy.sh
```

deploy.sh 幂等：重放 ACAD change 事件后校验 boost 状态与电源状态一致。

## 验证与回退

- 拔电后 `cat /sys/devices/system/cpu/cpufreq/boost` 应为 0，插电回 1
- 触发日志：`journalctl -t battery-boost`
- 回退：删除两个系统文件后 `sudo udevadm control --reload`
