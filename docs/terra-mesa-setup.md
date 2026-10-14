# terra-mesa 硬件解码部署记录

- **日期**:2026-07-07
- **硬件**:AMD Ryzen 5 5500U(Radeon Vega 集显,radeonsi / Renoir,VCN 2.0)
- **系统**:Fedora 44 Kinoite(immutable,rpm-ostree)
- **目标**:为 AMD 5500U 启用 H.264 / HEVC / VC-1 硬件解码

## 背景

Fedora 官方 mesa 因 MPEG-LA 专利限制,在编译时用 `-Dvideo-codecs=` 剥离了受专利保护的 codec。实测 `vainfo` 仅暴露 VP9 / JPEG / MPEG-2 解码,H.264/HEVC/VC-1 缺失。这并非硬件限制(5500U 的 VCN 原生支持),而是发行版法律策略。

本次采用 **terra 的 mesa subrepo**(codec-complete)替换官方 mesa,而非 rpmfusion 的并行 freeworld 方案。

## 当前状态总览

| Deployment | 版本 | mesa | 状态 |
|---|---|---|---|
| ● booted | 44.20260707.0 | terra-mesa `1:26.1.3-1.fc44` | **已生效**,mesa override 已应用 |
| rollback | 44.20260704.0 | 官方 `26.1.3-1.fc44`(受限)| 旧版,可回退 |

- booted `LocalOverrides`:`mesa-libGL mesa-libgbm mesa-libEGL mesa-dri-drivers mesa-filesystem mesa-vulkan-drivers 26.1.3-1.fc44 -> 1:26.1.3-1.fc44`
- 内核 `7.1.3-200.fc44.x86_64`,重启后验证通过(见「验证结果」)

## 对系统的修改

### 1. 宿主 booted deployment(已生效)

**mesa 全套 override**(`LocalOverrides`):

| 包 | 官方版本 | → terra-mesa 版本 |
|---|---|---|
| mesa-dri-drivers | 26.1.3-1.fc44 | 1:26.1.3-1.fc44 |
| mesa-vulkan-drivers | 26.1.3-1.fc44 | 1:26.1.3-1.fc44 |
| mesa-filesystem | 26.1.3-1.fc44 | 1:26.1.3-1.fc44 |
| mesa-libEGL | 26.1.3-1.fc44 | 1:26.1.3-1.fc44 |
| mesa-libGL | 26.1.3-1.fc44 | 1:26.1.3-1.fc44 |
| mesa-libgbm | 26.1.3-1.fc44 | 1:26.1.3-1.fc44 |

> `1:` 即 terra-mesa 的 epoch,标志 codec-complete 版本(含 H.264/HEVC/VC-1/VP9/AV1 解码 + Open Gaming Collective 补丁)。

**新增 layered 包**:

- `terra-release-mesa`——启用 terra-mesa subrepo
- `libva-utils`——验证工具 `vainfo`

### 2. 宿主 live 层(历史:apply-live 中间态)

> 重启前 apply-live 的过渡状态,重启后已被正式 deployment 取代,此处仅留作记录。

- `terra-release-mesa` 曾 apply-live 到当时 booted(`Unlocked: transient`)
- terra-mesa 仓库已启用并拉取过元数据

### 3. 仓库配置

- 新增 `/etc/yum.repos.d/terra-mesa.repo`(`enabled=1`,`priority=80`,`gpgcheck=1`,`repo_gpgcheck=1`)

### 4. toolbox `default` 容器

- `libva-utils`(本轮诊断时装的,用于跑 `vainfo` 查入口点)

### 5. 失败 / 无持久影响的尝试

| 尝试 | 结果 |
|---|---|
| rpmfusion 加源(×2) | 下载 EOF / 与 terra 包 16 处冲突 → `cleanup -p` 清理,**无残留** |
| override replace 超时(×2) | ROCm 海量文件致 prepare / relabel 极慢,daemon 中止 → **无残留 pending** |
| setsid 后台运行 override | 客户端 D-Bus 卡死 → kill 清理 |

> prepare 慢的根因:`rocm-llvm-static`(2 GB)、`migraphx`(1.1 GB)、`rocblas`(1 GB)等 GB 级 layered 包,使每次 deployment 的 SELinux relabel 耗时约 10+ 分钟。需给足超时(>1000 s)前台运行,避免 daemon 在客户端断开时中止 transaction。

## 验证结果(重启后实测)

重启进入新 deployment 后,`vainfo` 与 `vulkaninfo` 实测确认 terra-mesa 已生效。Driver 版本:`Mesa Gallium driver 26.1.3 for AMD Radeon Graphics (radeonsi, renoir, ACO, DRM 3.64, 7.1.3-200.fc44.x86_64)`。

### VA-API 入口点对比

| Codec | 改动前 | 改动后 |
|---|---|---|
| MPEG-2 | ✅ VLD | ✅ VLD |
| VC-1(Simple/Main/Advanced)| ❌ | ✅ **VLD** |
| H.264(ConstrainedBaseline/Main/High)| ❌ | ✅ **VLD + EncSlice**(解码 + 编码)|
| HEVC Main(8-bit)| ❌ | ✅ **VLD + EncSlice** |
| HEVC Main10(10-bit)| ❌ | ✅ **VLD + EncSlice** |
| JPEG | ✅ VLD | ✅ VLD |
| VP9(Profile 0 / 2)| ✅ VLD | ✅ VLD |

> 附带收益:除解码外,还获得了 **H.264 / HEVC 硬件编码**(`VAEntrypointEncSlice`),改动前完全没有——录屏、转码、推流均可受益。

### Vulkan video decode

| Codec | 改动前 | 改动后 |
|---|---|---|
| H.264 | ❌ | ✅ `VK_KHR_video_decode_h264` rev 9 |
| H.265 | ❌ | ✅ `VK_KHR_video_decode_h265` rev 8 |
| VP9 | ✅ | ✅ rev 1 |

### 复现命令

```bash
vainfo --display drm --device /dev/dri/renderD128
vulkaninfo | grep -E "VK_KHR_video_decode|VIDEO_CODEC_OPERATION_DECODE"
```

## 回退方法

```bash
# 方式一:仅撤销 mesa override(保留 terra-mesa subrepo)
rpm-ostree override reset mesa-dri-drivers mesa-vulkan-drivers \
  mesa-filesystem mesa-libEGL mesa-libGL mesa-libgbm

# 方式二:整体回退到上一个 deployment(含旧 mesa)
rpm-ostree rollback

# 方式三:移除 terra-mesa subrepo
rpm-ostree uninstall terra-release-mesa
```

## 关键决策记录

1. **选 terra-mesa 而非 rpmfusion**:本机已在 terra 生态;rpmfusion 与 terra 包大面积重叠(16 处冲突),两套第三方仓库混用是长期维护地狱。terra-mesa 是 terra 官方为 codec-complete 提供的方案。
2. **override replace 而非并行 freeworld**:terra-mesa 用 epoch=1 + priority=80 **直接替换**官方 mesa;rpmfusion freeworld 是并行放入 `/usr/lib64/dri-freeworld/`。两套机制互斥。
3. **前置 upgrade 必要**:系统曾因 layered 包与仓库版本不同步,任何 `install` 都报 `packages would be changed: 16`;`rpm-ostree upgrade` 同步后才解锁。
4. **绕过 metalink 慢镜像**:rpm-ostree 经 metalink 选到的镜像慢,改用从主站 `repos.fyralabs.com` 手动下载 rpm,再 `override replace` 本地文件。
