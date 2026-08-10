# Fedora Kinoite Wine 玩日文 Galgame 配置记录

> 配置日期：2026-08-10
> 系统：Fedora Kinoite 44（rpm-ostree）
> 场景：互联网来源的日文 galgame，资源形式为压缩包解压后直接运行 exe，无生肉翻译需求

## 结论先行

采用**路径 C：rpm-ostree overlay 系统 wine + winetricks**，但实际运行 32 位游戏用 **Kron4ek wine-tkg 11.13（wow64 构建，用户级）**。

**核心坑**：系统 wine 11.0 的 wow64 模式加载 32 位模块时用 `mmap(RW) + mprotect(RX)`，在 SELinux enforcing 下触发 `execmod` 拒绝，
表现为 `map_image_into_view failed to set protection, noexec filesystem?` 或 `could not load kernel32.dll, status c0000135`。
拒绝对象为 composefs 底层 ostree object 文件（AVC: denied { execmod }，scontext 记录为 kernel_t）。wine-tkg 11.13 加载时 mmap 直接带 exec，不触发该检查，**无需修改 SELinux**。
完整排查过程见 [fedora-kinoite-wine-selinux-execmod.md](fedora-kinoite-wine-selinux-execmod.md)。

选择理由（对照路径 A：flatpak Lutris）：

| 考量 | 说明 |
|------|------|
| 无生肉需求 | flatpak 方案最大卖点（沙箱内打包翻译工具链）不适用 |
| 绿色版直跑 | 终端 `wine game.exe` 最直接，Lutris 的安装器流程是负担 |
| 老 galgame 多为 d3d9 2D | wined3d 即可（vnwiki 建议老 VN 禁用 DXVK），无需 lutris 的 DXVK 集成 |
| 视频播放 | wine 11 自带 FFmpeg 媒体后端；增强层可用 umu + GE-Proton11（winedmo 重写视频管线） |

## 安装步骤

### 1. overlay 系统 wine（需 sudo）

```bash
sudo rpm-ostree install --apply-live wine winetricks
wine --version   # 验证，应为 wine-11.0
```

系统 wine 仅用于 64 位程序与 winetricks 组件管理；32 位 galgame 走 wine-tkg（见下）。

### 2. Kron4ek wine-tkg 11.13（32 位游戏实际运行环境，用户级）

```bash
mkdir -p ~/.local/share/wine-tkg
curl -sL -o /tmp/wine-tkg.tar.xz "https://github.com/Kron4ek/Wine-Builds/releases/download/11.13/wine-11.13-staging-tkg-amd64-wow64.tar.xz"
tar -xJf /tmp/wine-tkg.tar.xz -C ~/.local/share/wine-tkg/ --strip-components=1
~/.local/share/wine-tkg/bin/wine --version   # wine-11.13.r0.gd1f772d1 ( TkG Staging NTsync )
```

`amd64-wow64` 构建无需系统 i686 库。升级 wine 版本后必须重建前缀。

### 3. umu-launcher（备用，用户级，uv 安装）

```bash
uv tool install git+https://github.com/Open-Wine-Components/umu-launcher
```

注意：`uv tool install git+...` 依赖 git fetch by SHA，本机曾出现 GitHub 端 `无法找到远程引用` 失败，绕法为 shallow clone 后本地安装：

```bash
git clone --depth 1 https://github.com/Open-Wine-Components/umu-launcher /tmp/umu-clone
uv tool install /tmp/umu-clone
```

### 3. 前缀体系（vnwiki 风格双前缀）

```bash
mkdir -p ~/.local/share/wineprefixes/{proton_ge,vanilla}
WINEARCH=win64 WINEPREFIX=~/.local/share/wineprefixes/vanilla wineboot -u
```

前缀铁律：wine 版本换一次，前缀必须重建；建好后勿再修改。

### 4. 运行工作流

绿色版直跑（系统 wine）：

```bash
cd ~/Games/<游戏目录>
WINEPREFIX=~/.local/share/wineprefixes/vanilla LANG=ja_JP.UTF-8 wine game.exe
```

视频播放有问题时用 GE-Proton（自动下载最新版）：

```bash
WINEPREFIX=~/.local/share/wineprefixes/proton_ge PROTONPATH=GE-Proton umu-run ~/Games/<游戏目录>/game.exe
```

Steam 上存在的游戏可加 `GAMEID=<steam appid> STORE=steam` 让 protonfixes 自动套社区修复。

### 5. 日文支持

- Fedora glibc 预编译全部 locale，`ja_JP.UTF-8` 开箱即用
- 游戏运行加 `LANG=ja_JP.UTF-8`（KEY 社等有 gaijin check，还需 `TZ=Asia/Tokyo`）
- 字体兜底：`WINEPREFIX=... winetricks cjkfonts`；点名 MS ゴシック/MS 明朝的乱码游戏，复制微软日文字体包进前缀 `drive_c/windows/Fonts`

> 实测坑：winetricks cjkfonts 在 64 位前缀的注册表导入步骤有 bug（`syswow64\regedit.exe` 路径转义导致状态码 53），但字体文件（sourcehansans.ttc）已正常装入 `drive_c/windows/Fonts`，wine 自动扫描即可用，注册步骤仅影响字体链接优化，可忽略。

## 排错速查

| 症状 | 处理 |
|------|------|
| 32 位游戏报 `map_image_into_view ... noexec filesystem?` / `could not load kernel32.dll` | SELinux execmod 拒绝系统 wine 的 mmap(RW)+mprotect(RX) 加载路径，改用 wine-tkg 前缀（其 mmap 带 exec 不受影响） |
| 动画 OP 黑屏/卡死 | 顺序试：wine 11 MF FFmpeg 后端（注册表 `DisableGstByteStreamHandler=1`）→ `winetricks wmp11 quartz` → 上 GE-Proton |
| 字体乱码/方框 | `winetricks cjkfonts` → MS 日文字体包复制进前缀 Fonts |
| Nitroplus 引擎（村正/沙耶/素晴日）巨慢 | Proton 通病，改用 vanilla 裸 wine + 关 esync/fsync + `winetricks xact` |
| 报"游戏未安装" | 绿色版注册表检查，重装到该前缀或换带注册表信息的版本 |
| 独占全屏拉伸/花屏 | `file game.exe` 确认架构，窗口化运行；不行再 gamescope |

## 参考链接

- [TheMoeWay: Visual novels on Linux](https://learnjapanese.moe/vn-linux/) —— Lutris + GE-Proton 流程、LC_ALL/TZ 环境变量、AlphaROMdiE、ReactOS cmd.exe 双启动
- [Visual Novel Wiki: Wineprefixes](https://www.vnwiki.xyz/linux/wineprefixes.html) —— 专业前缀体系（proton_ge/vanilla + 特殊 media 前缀）
- [umu-launcher](https://github.com/Open-Wine-Components/umu-launcher) —— 非 Steam 环境跑 Proton 的统一启动器
- [GE-Proton releases](https://github.com/GloriousEggroll/proton-ge-custom/releases) —— GE-Proton11 系列 winedmo 视频管线重写
- [Windows Japanese Fonts Pack](https://drive.google.com/file/d/1OiBgAmt3vPRu08gPpxFfzrtDgarBGszK/view)

## 当前状态

- [x] 前缀目录 `~/.local/share/wineprefixes/{proton_ge,vanilla,tkg}` 已建
- [x] wine-tkg 11.13（Kron4ek staging-tkg amd64-wow64）已装 `~/.local/share/wine-tkg/`，tkg 前缀已初始化
- [x] **ラブピカルポッピー！运行成功**（2026-08-10，wine-tkg + tkg 前缀，SELinux enforcing 下）
- [x] 默认前缀 `~/.wine` 已初始化（wineboot + cjkfonts 思源黑体），仅用于 64 位程序
- [x] umu-launcher 1.4.4 已装（备用，`~/.local/bin/umu-run`）
- [x] overlay wine 11.0 (Staging) + winetricks（2026-08-10，`--apply-live` 免重启）
- [x] GE-Proton 预热下载完成（~/.local/share/umu + proton_ge 前缀）

## 使用速查

```bash
# 32 位 galgame 直跑（主路径）
cd ~/Games/<游戏目录>
WINEPREFIX=~/.local/share/wineprefixes/tkg LANG=ja_JP.UTF-8 ~/.local/share/wine-tkg/bin/wine game.exe

# 64 位程序/winetricks 组件管理（系统 wine）
WINEPREFIX=~/.local/share/wineprefixes/vanilla LANG=ja_JP.UTF-8 wine game.exe

# 视频播放有问题时试 GE-Proton（proton_ge 前缀）
WINEPREFIX=~/.local/share/wineprefixes/proton_ge PROTONPATH=GE-Proton umu-run ~/Games/<游戏目录>/game.exe
```
