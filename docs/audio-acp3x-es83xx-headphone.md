# acp3x-es83xx 耳机无声问题调查报告

> 调查日期：2026-06-30
> 机器：HUAWEI MateBook（BOM-WXX9 / M1010）
> 系统：Fedora Kinoite 44，内核 7.0.13-200.fc44.x86_64

## 结论先行

这是 **AMD ACP3X + ES8316 codec 机器驱动的已知上游 bug**：耳机功放使能 GPIO 的物理电平在 DAPM 事件回调中无法被正确驱动。截至 2026-02 上游仍未解决，**用户态任何配置都无法修复**。

曾尝试的“禁用 UCM”方案会让扬声器也彻底无声，**已撤销**。当前状态：恢复系统默认 UCM，扬声器正常，耳机不可用。

## 硬件与软件环境

| 项 | 值 |
|----|----|
| DMI Product | `BOM-WXX9` / `M1010` |
| 音频控制器 | AMD Audio Coprocessor（`pci-0000:03:00.5`） |
| Codec | Everest ES8316（I²C `ESSX8336:00`） |
| 机器驱动 | `snd_acp_legacy_mach`（`acp3x-es83xx`） |
| UCM 配置 | `/usr/share/alsa/ucm2/AMD/acp3x-es83xx/` |
| PipeWire | 1.6.7 |
| WirePlumber | 0.5.14 |
| PulseAudio 兼容 | pipewire-pulse |

内核启动关键日志：

```
acp_mach acp3x-es83xx: matched DMI table with this system, trying to register sound card
acp_mach acp3x-es83xx: successfully probed the sound card
es8316 i2c-ESSX8336:00: assuming static mclk
es8316 i2c-ESSX8336:00: speaker gpio 0 active high, headphone gpio 1 active high
```

## 问题现象

| 耳机状态 | 扬声器 | 耳机 |
|---------|--------|------|
| 未插入 | 正常发声 | — |
| 插入 | 被 UCM `JackHWMute` 静音 | **完全无声** |

用 `aplay -D hw:1,0` 绕过 PipeWire 直接播放验证：

- 耳机插入、`Headphone Switch`/`Headphone Playback Volume`/`DAC` 链路全开 → 耳机**无声**
- `Speaker Switch = on` → 扬声器发声（无论耳机是否插入）

证明硬件扬声器路径正常，耳机输出路径在硬件/驱动层不工作。

## 根因

### 信号链结构

机器驱动 `sound/soc/amd/acp/acp3x-es83xx/acp3x-es83xx.c` 定义了两个 DAPM SUPPLY widget，分别在各自的 power event 回调里拉高/拉低外置功放 GPIO：

```c
static const struct snd_soc_dapm_widget acp3x_es83xx_widgets[] = {
    SND_SOC_DAPM_SPK("Speaker", NULL),
    SND_SOC_DAPM_HP("Headphone", NULL),
    SND_SOC_DAPM_SUPPLY("Headphone Power", SND_SOC_NOPM, 0, 0,
        acp3x_es83xx_headphone_power_event,
        SND_SOC_DAPM_PRE_PMD | SND_SOC_DAPM_POST_PMU),
    SND_SOC_DAPM_SUPPLY("Speaker Power", SND_SOC_NOPM, 0, 0,
        acp3x_es83xx_speaker_power_event,
        SND_SOC_DAPM_PRE_PMD | SND_SOC_DAPM_POST_PMU),
};

static const struct snd_soc_dapm_route acp3x_es83xx_audio_map[] = {
    {"Headphone", NULL, "HPOL"},
    {"Headphone", NULL, "HPOR"},
    {"Headphone", NULL, "Headphone Power"},   // 触发 headphone GPIO
    {"Speaker",   NULL, "HPOL"},
    {"Speaker",   NULL, "HPOR"},
    {"Speaker",   NULL, "Speaker Power"},     // 触发 speaker GPIO
};
```

事件回调：

```c
static int acp3x_es83xx_headphone_power_event(...) {
    priv->headphone_on = SND_SOC_DAPM_EVENT_ON(event);
    gpiod_set_value_cansleep(priv->gpio_speakers, priv->speaker_on);
    gpiod_set_value_cansleep(priv->gpio_headphone, priv->headphone_on);  // 关键
    return 0;
}
```

外置耳机功放（华为主板上一颗独立芯片）由 `gpio_headphone`（ACPI index 1）使能。**只有该 GPIO 被物理拉高，耳机功放才工作**。

### Bug 本质

上游补丁 [[PATCH AUTOSEL 6.18-6.1] ASoC: Intel: sof_es8336: Add DMI quirk for Huawei BOD-WXX9](https://www.spinics.net/lists/stable/msg911673.html)（针对同系列 BOD-WXX9，2026-02）的 RFC 部分明确记录了**完全相同**的现象：

> GPIO values change in driver (`gpiod_get_value()` shows logical value changes) but not physically (debugfs gpio shows no change).
> The same `gpiod_set_value_cansleep()` calls work correctly in probe context with `msleep()`, but fail when called from DAPM event callbacks.
>
> - GPIO 17 (speakers): changes in driver, no physical change
> - GPIO 16 (headphone): changes in driver, no physical change
>
> In Windows, audio switching works without visible GPIO changes, suggesting possible ACPI/firmware involvement.
>
> Any suggestions on how to properly control these GPIOs from DAPM events would be appreciated.

即：驱动里 `gpiod_set_value()` 逻辑值变了，但 GPIO **物理电平没变**。扬声器 GPIO 在 probe 阶段被偶然正确拉高（所以扬声器响），耳机 GPIO 在 DAPM 回调里设置失效（所以耳机无声）。

## 尝试过的方案及失败原因

### 方案 1：`device.profile.priority.rules` 强制 Speaker profile

**做法**：`~/.config/wireplumber/wireplumber.conf.d/52-prefer-speaker-profile.conf`

```
device.profile.priority.rules = [
  { matches = [ { device.name = "~alsa_card.*acp3x-es83xx" } ]
    actions = { update-props = { priorities = ["HiFi (Headset, Mic, Speaker)"] } } }
]
```

**结果**：失败。UCM 的 `JackHWMute "Speaker"` 在耳机插入时把 Speaker port 标记为 `not available`，profile 虽被强制选中但无可用输出路由，信宿打不开（`无此实体`）。

### 方案 2：UCM 覆盖（`ALSA_CONFIG_UCM2` 环境变量）

**做法**：设置 `ALSA_CONFIG_UCM2=~/.local/share/alsa-ucm-fix`，在自定义目录放修改过的 `HiFi.conf`（移除 `ConflictingDevice` 和 `JackHWMute`）。

**结果**：失败。PipeWire 的 ACP 使用**自己的 UCM 加载机制**（`spa/plugins/alsa/acp/alsa-ucm.c`），不走 alsa-lib 的 `ALSA_CONFIG_UCM2` 路径。实测环境变量确实传入 pipewire 进程（用 wrapper 脚本验证），但被忽略，配置文件从未被加载。

> 即使 UCM 覆盖生效也无济于事：ACP 仍会因 Speaker 与 Headphones 共享同一 PCM（`hw:${CardId}`）而把它们拆成两个 profile，且 GPIO bug 不受影响。

### 方案 3：禁用 UCM（`api.alsa.use-ucm = false`）

**做法**：`~/.config/wireplumber/wireplumber.conf.d/51-acp3x-es83xx-fix.conf`

```
monitor.alsa.rules = [
  { matches = [ { device.name = "~alsa_card.*acp3x-es83xx" } ]
    actions = { update-props = { api.alsa.use-ucm = false } } }
]
```

**结果**：产生单一 fallback profile，不再切换，但**扬声器也彻底无声**——因为禁用 UCM 后 BootSequence 不执行，codec 初始化序列（DAC 音量、HPMixer、Speaker Switch 等）丢失。此方案已撤销。

> 该方案在 Framework 13 AMD 等机器上是社区标准解法（[参考](https://www.shrey.com/blog/fixing-microphone-on-framework-13-amd-linux/)），但对本机不适用——本机问题是 GPIO 物理控制，非 UCM profile 切换。

### 方案 4：amixer 直接配置混音器

逐一测试所有 codec 混音器控件：`Headphone Switch`、`Headphone Playback Volume`、`Headphone Mixer Volume`、`DAC Playback Volume`、`Left/Right Headphone Mixer Left/Right DAC Switch`、`DAC Mono Mix Switch` 等。

**结果**：信号链控件全开，耳机仍无声。证明问题不在 codec 内部数字/模拟信号链，而在 codec 之后的**外置功放使能 GPIO**——该 GPIO 不在 ALSA mixer 控件里，由内核 DAPM 事件驱动。

### 方案 5：直接操作 GPIO

**结果**：不可行。GPIO 被内核机器驱动通过 `gpiod_get_optional()` 独占持有，用户态无法访问。系统也未安装 libgpiod 工具（`gpioget`/`gpioset`），且 GPIO 未导出到 `/sys/class/gpio/`。

## 诊断方法记录

### 关键验证步骤

1. **绕过 PipeWire 直接播放**：`aplay -D hw:1,0 -f S16_LE -c 2 -r 48000 test.wav` —— 成功打开设备证明 ALSA 层正常，问题在硬件输出。
2. **混音器全量扫描**：`amixer -c 1 contents` 列出所有控件，逐一开关测试。
3. **DAPM 源码分析**：阅读 `acp3x-es83xx.c` 与 `es8316.c` 的 DAPM widget/route 定义，确认 GPIO 由 `SND_SOC_DAPM_SUPPLY` 的 power event 控制。
4. **内核日志**：`journalctl -k | grep es8316` 确认 `speaker gpio 0 / headphone gpio 1`。

### 为什么 NixOS 下“调一个布尔开关偶尔有效”

上游补丁作者指出：`gpiod_set_value_cansleep()` 在 probe 上下文（带 `msleep()`）能正确驱动 GPIO，但在 DAPM 事件回调里失效。NixOS 下重新加载模块/重启时若碰巧在 probe 上下文触发了 headphone GPIO，会偶发使能耳机功放——这就是“不稳定”的来源。

## 参考链接

### 上游 bug 与补丁

- [[PATCH AUTOSEL 6.18-6.1] ASoC: Intel: sof_es8336: Add DMI quirk for Huawei BOD-WXX9](https://www.spinics.net/lists/stable/msg911673.html) —— 同系列机器，RFC 明确记录 GPIO 物理电平不变的 bug
- [AsahiLinux/linux commit c3b2e92](https://github.com/AsahiLinux/linux/commit/c3b2e922924bfbb9a2f4541bec2c7d2249399631) —— BOD-WXX9 DMI quirk 补丁
- [[PATCH v3 2/3] ASoC: Intel: sof_es8336: support a separate gpio to control headphone](https://lists.openwall.net/linux-kernel/2022/04/06/1575) —— 双 GPIO 支持（Intel 平台）
- [Re: ASoC: amd: acp: Add machine driver ... ES8336](https://www.spinics.net/lists/alsa-devel/msg156257.html) —— 机器驱动 GPIO 控制讨论

### 源码

- [acp3x-es83xx.c（机器驱动）](https://github.com/torvalds/linux/blob/master/sound/soc/amd/acp/acp3x-es83xx/acp3x-es83xx.c)
- [es8316.c（codec 驱动，含 DAPM 路由）](https://github.com/torvalds/linux/blob/master/sound/soc/codecs/es8316.c)
- [acp3x-es83xx UCM 配置](https://github.com/alsa-project/alsa-ucm-conf/blob/master/ucm2/AMD/acp3x-es83xx/HiFi.conf)

### 相关讨论

- [华为 MateBook 扬声器/耳机问题汇总（Fedora）](https://discussion.fedoraproject.org/t/has-anyone-successfully-fixed-the-issue-where-the-speaker-and-headphone-audio-are-mixed-up-on-huawei-laptops-running-fedora/185635)
- [sof-essx8336 扬声器耳机同时发声（Fedora）](https://discussion.fedoraproject.org/t/sounds-plays-out-of-headphones-and-speakers-at-the-same-time-on-laptop-huwawei-matebook-15-d-2021-with-sof-essx8336/110967)
- [codepayne/linux-sound-huawei](https://github.com/codepayne/linux-sound-huawei) —— 华为 MateBook AMD 声音支持内核 fork
- [Huawei MateBook 14s 耳机无声（Manjaro）](https://forum.manjaro.org/t/internal-speaker-does-not-play-audio-on-huawei-matebook-14s/151616)

### 文档

- [WirePlumber ALSA 配置](https://pipewire.pages.freedesktop.org/wireplumber/daemon/configuration/alsa.html)
- [ALSA DAPM 文档](https://docs.kernel.org/sound/soc/dapm.html)
- [WirePlumber 0.4→0.5 配置迁移](https://pipewire.pages.freedesktop.org/wireplumber/daemon/configuration/migration.html)

## 当前状态与后续

**当前**：已撤销所有自定义配置，恢复系统默认 UCM。扬声器正常，耳机不可用。

**可能的后续方向**（均需较高成本，暂未实施）：

1. **自编译内核补丁**：参考 BOD-WXX9 补丁，在 `acp3x_es83xx_dmi_table` 给 BOM-WXX9 加 `SOF_ES8336_HEADPHONE_GPIO` 类 quirk；但上游本身未解决 GPIO 物理驱动问题，补丁可能无效。
2. **跟踪上游进展**：关注 `sound/soc/amd/acp/acp3x-es83xx/` 与 `sound/soc/codecs/es8316.c` 的提交，等待 GPIO 控制问题修复。
3. **ACPI/固件层 workaround**：补丁作者怀疑 Windows 走 ACPI/firmware 路径，可研究是否可通过 ACPI 方法触发功放使能。
4. **实用兜底**：放弃耳机输出，配置系统在插拔耳机时让扬声器持续发声（禁用 jack 对扬声器的影响）。

## 撤销的提交

调查过程中产生过一个错误的修复提交（禁用 UCM，导致扬声器也无声），已通过 `git reset` 移除，本报告取而代之。
