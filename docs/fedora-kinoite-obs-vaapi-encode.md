# Fedora Kinoite OBS VAAPI 硬件编码配置记录

> 系统: Fedora Linux 44.20260809.0 (Kinoite), AMD Ryzen 5 5500U (Lucienne/Renoir APU)
> 记录日期: 2026-08-11
> 关联: [fedora-kinoite-multimedia-repo-config.md](fedora-kinoite-multimedia-repo-config.md) — 仓库布局与编解码能力基础

## 硬件能力确认

### 平台

| 项 | 值 |
|---|---|
| CPU | AMD Ryzen 5 5500U（Lucienne，Zen 2，6C12T） |
| iGPU | AMD Radeon RX Vega 7（7 CU @ 1800 MHz，Vega 架构） |
| 媒体引擎 | VCN 2.2（内核 `amd-hardware-list` 确认 Renoir = VCN 2.2） |
| PCI ID | 0x164c（Renoir Vega iGPU） |

### 硬件编码矩阵

依据 VCN 2.2 规格：所有 VCN 版本支持 H.264/HEVC 编解码，VP9 仅解码；AV1 编码需 VCN 4.0（RDNA 3 / Phoenix）。

| 编码器 | 硬件编码 | 备注 |
|---|---|---|
| H.264 / AVC（High Profile） | 支持 | 直播首选，Twitch/B 站/YouTube 通用 |
| HEVC / H.265（含 Main10） | 支持 | YouTube 等支持 |
| VP9 | 不支持 | VCN 全系不支持 VP9 编码 |
| AV1 | 不支持 | 需 VCN 4.0，5500U 是 VCN 2.2 |

`vainfo` 实测与规格一致：H.264/HEVC 的 `VAEntrypointEncSlice` 入口点为真实 VCN 硬件能力，非软件回退（freeworld 与 base 的 `mesa-va-drivers` 代码相同，仅专利打包差异，均调用同一 VCN 硬件）。

## 软件链路

| 层 | 组件 | 版本 | 来源 |
|---|---|---|---|
| 内核驱动 | amdgpu | 7.1.7-200.fc44 | base |
| 用户态驱动 | Mesa radeonsi (ACO) | 26.1.6 | base |
| VA-API 驱动 | mesa-va-drivers-freeworld | 26.1.6 | rpm-ostree layer |
| VA-API 运行时 | libva / libva-utils | 2.23.0 | rpm-ostree layer |
| ffmpeg | full（替换 -free） | 8.1.2 | rpm-ostree layer |
| OBS Studio | — | 32.1.1 | rpm-ostree layer |

## VCN 单元监控

### sysfs 文本接口（零依赖）

`/sys/class/drm/card1/device/` 下：

| 文件 | 含义 |
|---|---|
| `gpu_busy_percent` | GFX 图形引擎占用（渲染/3D） |
| `vcn_busy_percent` | VCN 视频编解码单元占用 |
| `mem_busy_percent` | 显存带宽占用 |

一行监控（OBS 推流时 `vcn_busy_percent` 应从 0 跳变）：

```bash
watch -n0.5 'cat /sys/class/drm/card1/device/{gpu_busy_percent,vcn_busy_percent,mem_busy_percent}'
```

### 进程级 fdinfo

amdgpu 在 `/proc/<pid>/fdinfo/*` 暴露各引擎累计纳秒，采样两次求差值得进程实时占用。nvtop / amdgpu_top 底层用的就是这套机制。

```bash
grep -h drm-engine /proc/$(pgrep -x obs)/fdinfo/* 2>/dev/null | sort -u
```

### TUI 工具

`amdgpu_top`（Rust）展示 GFX/DEC/ENC/SDMA 各 IP block 占用，是最现代的 AMD GPU 监控工具。本机经 `cargo install amdgpu_top` 装在 `~/.cargo/bin/amdgpu_top`——Kinoite 下用 cargo install 避免污染 base 镜像，升级随 `cargo install-update` 走。

## OBS 配置（本机实际值）

> 配置目录：`~/.config/obs-studio/basic/profiles/未命名/`（未纳入 chezmoi，机器相关参数留本机）
> 输出模式：Advanced（`basic.ini [Output] Mode=Advanced`）

### 推流编码器

`basic.ini [AdvOut] Encoder=ffmpeg_vaapi_tex`，详细参数对应 `streamEncoder.json`：

| 参数 | 值 | 说明 |
|---|---|---|
| 编码器 | `ffmpeg_vaapi_tex` | FFmpeg VAAPI 纹理模式，GPU 纹理直送 VCN，省 CPU↔GPU 拷贝 |
| VAAPI 设备 | `/dev/dri/by-path/pci-0000:03:00.0-render` | 按 PCI 路径稳定寻址，比 `card0/renderD128` 抗重排 |
| H.264 Profile | High（100） | vainfo 确认 H264High 有 EncSlice |
| 码率控制 | VBR | 可变码率 |
| 码率 | 5000 kbps | 1080p60 直播，VCN 2.x 画质需给足 |

### 录制编码器

`basic.ini [AdvOut] RecType=Standard` + `RecEncoder=none`：Standard 模式下 `none` 表示录制复用推流编码器（即 `ffmpeg_vaapi_tex`），输出 mkv。

### 视频与音频

| 项 | 值 |
|---|---|
| 基础/输出分辨率 | 1920×1080 |
| 帧率 | 60 |
| 色彩格式 | NV12 |
| 色彩空间 | BT.709（Partial） |
| 音频编码器 | ffmpeg_aac |

## 验证 OBS 走 VCN 硬件编码

1. 终端运行 `vcn_busy_percent` 的 watch（见上节）
2. OBS 选定 `ffmpeg_vaapi` / `ffmpeg_vaapi_tex` 编码器，开始推流或录制
3. `vcn_busy_percent` 从 0 跳变到大于 0（稳定推流时通常 10%–60%）→ 硬件编码生效
4. 若恒为 0，编码器选错（回退到 x264）或 VAAPI 设备路径失效

## 注意事项

- **APU 共享 TDP 与内存带宽**：直播 + 3D 游戏同跑会吃力，纯桌面/录屏负载无虞。
- **VCN 2.x H.264 画质弱于同代 Intel QSV / NVENC**，也弱于软压 x264 medium；码率建议给足，1080p60 不低于 5000 kbps。
- **OBS 配置未纳入 chezmoi**：VAAPI 设备路径（PCI 地址）、码率等随环境变化，留存在 `~/.config/obs-studio/` 本机；重建时参考本文档配置。
- **amdgpu_top 不进 base 镜像**：经 `cargo install` 装在用户目录，`rpm-ostree upgrade` 不影响。
