# Fedora Kinoite 多媒体仓库配置记录

> 系统: Fedora Linux 44.20260707.0 (Kinoite), AMD Lucienne (Renoir) APU
> 记录日期: 2026-07-08

## 仓库布局

### 启用的第三方仓库

| 仓库 | 角色 | 必要性 |
|------|------|--------|
| `fedora-cisco-openh264` | H.264 Baseline Profile 编解码（noopenh264），浏览器 H.264 通话 | 标准 Fedora 仓库 |
| **`rpmfusion-free`** | **ffmpeg / ffmpeg-libs — 含专利风险的解码器及 x264/x265 编码库** | **必需（若需完整编解码）** |
| **`rpmfusion-nonfree`** | **x264-libs / x265-libs / vvenc-libs — 专有/专利编码库** | **ffmpeg-libs 的硬依赖，不可移除** |
| `rpmfusion-nonfree-nvidia-driver` | NVIDIA 专有驱动（本机为 AMD，未使用） | 可移除 |
| `rpmfusion-nonfree-steam` | Steam 客户端 | 可选 |
| ~~`terra-mesa`~~ | ~~Mesa VAAPI 驱动~~ | **已移除** — 见下文 |

### 移除的仓库

**terra-mesa**（2026-07-08）：

```
rpm-ostree override reset mesa-dri-drivers mesa-filesystem mesa-libEGL mesa-libgbm mesa-libGL mesa-vulkan-drivers
rpm-ostree uninstall terra-release-mesa
```

| 变更 | 前（terra） | 后（Fedora base） |
|------|------------|-------------------|
| 版本 | `1:26.1.3-1.fc44` | `26.1.3-1.fc44`（完全相同，仅去 epoch） |
| LocalOverrides | 6 包 override | 无 |

**移除理由**：Fedora 44 的 `mesa-dri-drivers` 已内置 `gallium-va`，`radeonsi_drv_video.so` 在 base 镜像中即可用。terra-mesa 仅加了 epoch 前缀，代码无差异。

### 仍在使用的 Terra（非 mesa）包

以下包来自 terra（general）仓库，与编解码无关，保留：

- `starship`, `yazi`, `zellij`, `deno`, `firacode-nerd-fonts`, `comicshannsmono-nerd-fonts`
- `deno-bash-completion`
- 仓库元数据包：`terra-release`, `terra-gpg-keys`

## 仓库优先级

所有启用的仓库均未设置 `priority=`（均使用 DNF 默认值 `99`），处于同一优先级。
`fedora-updates-archive` 设置了 `cost=10000`（默认 `1000`），仅作 OSTree 降级兜底。

### 同名同版本包时谁胜出？

```
EVR 比较 → 更高版本胜出
   ↓ 版本相同
repo 加载顺序 → 文件名字典序靠前的胜出
```

当前加载顺序（/etc/yum.repos.d/ 文件名字典序）：

| 顺序 | 仓库 | 备注 |
|------|------|------|
| 1 | `fedora` (base) | 最先加载，同名同版本时最先命中 |
| 2 | `fedora-cisco-openh264` | |
| 3 | `fedora-updates` | |
| 4 | `fedora-updates-archive` | cost=10000，高成本兜底 |
| 5 | `rpmfusion-free` | |
| 6 | `rpmfusion-free-updates` | |
| 7 | `rpmfusion-nonfree` | |
| 8 | `rpmfusion-nonfree-nvidia-driver` | 未使用（AMD GPU） |
| 9 | `rpmfusion-nonfree-steam` | |
| 10 | `rpmfusion-nonfree-updates` | |
| 11 | `terra` | 桌面工具/字体/开发工具 |
| — | ~~terra-mesa~~ | 已移除 |

### 与 rpm-ostree override 的关系

rpm-ostree 的 `override` 机制独立于 DNF 优先级：

- `override replace` / `override reset`：直接替换 base 层的指定包，不受优先级影响
- 之前的 terra-mesa 就是通过 `override` 覆盖了 Fedora 原生 mesa：

```
Fedora  mesa-dri-drivers: 26.1.3-1.fc44      (无 epoch)
terra   mesa-dri-drivers: 1:26.1.3-1.fc44     (epoch=1)
```

EVR 比较时带 epoch 的版本胜出（`1:26.1.3` > `26.1.3`），不需要设 `priority`。
移除 override 后恢复 Fedora base 版本。

## 编解码能力

### 硬件解码（VAAPI）— AMD Renoir VCN 2.x

| 编码 | 解码 | 编码 | 驱动 |
|------|------|------|------|
| H.264 | ✅ VLD + EncSlice | ✅ VLD + EncSlice | radeonsi |
| HEVC | ✅ VLD + EncSlice | ✅ VLD + EncSlice | radeonsi |
| HEVC 10-bit | ✅ VLD | ✅ VLD | radeonsi |
| VP9 | ✅ VLD | ❌ | radeonsi |
| JPEG | ✅ VLD | ❌ | radeonsi |

驱动路径：`radeonsi_drv_video.so` → `libgallium-26.1.3.so`（Fedora base 的 `mesa-dri-drivers` 提供）

### 软件解码 — 不同仓库方案对比

| 编码 | 仅 Fedora base | + rpmfusion-free |
|------|---------------|------------------|
| H.264 Baseline | ✅ noopenh264 | ✅ native + openh264 |
| H.264 High/Main | ❌ **不可解** | ✅ native |
| H.264 10-bit | ❌ | ✅ native |
| HEVC | ❌ | ✅ native |
| HEVC 10-bit | ❌ | ✅ native |

ffmpeg-free 编译配置中的关键开关：

```
--enable-libopenh264-dlopen     # OpenH264 动态加载
--disable-decoder='h264,hevc,vc1'  # 原生 H.264/HEVC 解码器禁用
```

### 实际影响

| 场景 | 仅 Fedora base | + rpmfusion |
|------|---------------|-------------|
| mpv --hwdec=vaapi | ✅ AVC/HEVC 正常 | ✅ |
| VLC 默认设置 | ✅ AVC/HEVC 正常 | ✅ |
| GNOME Videos (Totem) | ⚠️ 需 gstreamer1-vaapi | ✅ |
| Firefox 在线视频 | ⚠️ H.264 仅 Baseline | ✅ |
| ffmpeg CLI 转码 x264/x265 | ❌ | ✅ |
| OBS 软件编码 | ❌ | ✅ |

## VA-API 验证命令

```bash
# 检查 VA-API 驱动和功能
vainfo

# 检查 ffmpeg 硬件解码器
ffmpeg -decoders 2>/dev/null | grep vaapi

# 检查 ffmpeg 硬件编码器
ffmpeg -encoders 2>/dev/null | grep vaapi

# mpv 硬解测试
mpv --hwdec=vaapi --vo=gpu --no-audio test.mp4
```

## 其他编码器

- **AV1**: 软解通过 `libdav1d` / `libaom-av1`（Fedora base），硬解通过 VAAPI（若 GPU 支持）
- **VP8/VP9**: 软解通过 `libvpx`（Fedora base），硬解通过 VAAPI
- **MPEG-2 / VC-1**: 软解通过 ffmpeg-native（Fedora base）
