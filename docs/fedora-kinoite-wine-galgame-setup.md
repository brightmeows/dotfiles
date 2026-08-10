# Fedora Kinoite Wine 玩日文 Galgame 配置记录

> 配置日期：2026-08-10
> 系统：Fedora Kinoite 44（rpm-ostree）
> 场景：互联网来源的日文 galgame，资源形式为压缩包解压后直接运行 exe，无生肉翻译需求

## 结论先行

采用**路径 C：rpm-ostree overlay 系统 wine + winetricks，umu-launcher + GE-Proton 作为视频播放增强层**。

选择理由（对照路径 A：flatpak Lutris）：

| 考量 | 说明 |
|------|------|
| 无生肉需求 | flatpak 方案最大卖点（沙箱内打包翻译工具链）不适用 |
| 绿色版直跑 | 终端 `wine game.exe` 最直接，Lutris 的安装器流程是负担 |
| Fedora wine 元包 | 自动拉全 i686 依赖，一次 overlay 解决 32 位问题 |
| 老 galgame 多为 d3d9 2D | wined3d 即可（vnwiki 建议老 VN 禁用 DXVK），无需 lutris 的 DXVK 集成 |
| 视频播放 | wine 11 自带 FFmpeg 媒体后端；增强层用 umu + GE-Proton11（winedmo 重写视频管线，2026-06 发布，免 wmp11/lavfilters 等组件） |

## 安装步骤

### 1. overlay 系统 wine（需 sudo）

```bash
sudo rpm-ostree install --apply-live wine winetricks
wine --version   # 验证，应为 wine-11.0
```

### 2. umu-launcher（用户级，uv 安装）

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

- [x] 前缀目录 `~/.local/share/wineprefixes/{proton_ge,vanilla}` 已建
- [x] umu-launcher 1.4.4 已装（`~/.local/bin/umu-run`，uv tool）
- [x] overlay wine 11.0 (Staging) + winetricks（2026-08-10，`--apply-live` 免重启）
- [x] vanilla 前缀初始化（wineboot，含 mono）
- [x] 冒烟测试通过（`wine cmd /c ver` 返回 Windows 10.0.19045）
- [x] cjkfonts 字体兜底（sourcehansans.ttc 已装入 Fonts，注册表步骤有已知 bug 可忽略）
- [x] GE-Proton 预热下载完成（~/.local/share/umu 661M + proton_ge 前缀 698M）

## 使用速查

```bash
# 绿色版直跑
cd ~/Games/<游戏目录>
WINEPREFIX=~/.local/share/wineprefixes/vanilla LANG=ja_JP.UTF-8 wine game.exe

# 视频播放有问题时换 GE-Proton
WINEPREFIX=~/.local/share/wineprefixes/proton_ge PROTONPATH=GE-Proton umu-run ~/Games/<游戏目录>/game.exe
```
