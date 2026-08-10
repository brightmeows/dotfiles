# Fedora Kinoite Wine 玩日文 Galgame：SELinux execmod 问题排查记录

> 排查日期：2026-08-10
> 游戏：ラブピカルポッピー！（SMEE，LoveHp.exe，32 位 PE32 GUI）
> 系统：Fedora Kinoite 44（内核 7.1.7-200.fc44），SELinux Enforcing
> 环境：wine 11.0 (Staging)（Fedora 包，wow64-only 构建）

## 结论先行

系统 wine 11.0 的 wow64 模式加载 32 位内置模块（位于 composefs 底层 ostree object 文件）时采用 `mmap(RW) + mprotect(RX)` 两步路径，
在 SELinux Enforcing 下触发 `execmod` 检查并被拒绝（EACCES），表现为 `map_image_into_view failed to set protection, noexec filesystem?`，32 位进程无法启动。

**解法**：改用 [Kron4ek wine-tkg 11.13](https://github.com/Kron4ek/Wine-Builds)（staging-tkg amd64-wow64 构建，用户级 tarball，解压即用）。
其加载路径 mmap 直接带 PROT_EXEC，不经过"无 exec 的 vma 添加 exec"检查，SELinux Enforcing 下直接可运行，无需修改 SELinux。ラブピカルポッピー！已实测运行成功。

## 问题现象

```text
0120:err:virtual:map_image_into_view failed to set 60000020 protection on L"\\??\\C:\\windows\\syswow64\\ntdll.dll" section .text, noexec filesystem?
0120:err:virtual:virtual_setup_exception stack overflow 384 bytes addr 0x7bcbe0cc stack 0x5e0e80 (0x5e0000-0x5e1000-0x6e0000)
```

- 32 位程序（LoveHp.exe）必现失败；64 位程序（`wine cmd /c ver`、wineboot）完全正常
- SELinux 临时 permissive（`setenforce 0`）后错误消失，ntdll 加载成功，但进一步暴露 `could not load kernel32.dll, status c0000135`（见下文"阶段 2"）

## 根因

### 机制链

1. Fedora 44 的 wine 11.0 是 **wow64-only 构建**：所有包均为 x86_64/noarch，`/usr/bin/wine` 指向 `wine64`，32 位内置模块在 `/usr/lib64/wine-wow64/wine/i386-windows/`（819 个 PE 文件）。前缀内 `syswow64` 目录为空属正常设计（虚拟路径）。
2. wine 11.0 的 `map_image_into_view`（dlls/ntdll/unix/virtual.c）加载 PE 模块时先 `mmap(RW)`（为重定位预留写权限），再对 `.text` 段 `mprotect(RX)`。
3. SELinux 的 `selinux_file_mprotect`（security/selinux/hooks.c）对文件映射 vma 执行检查：`default_noexec && (prot & PROT_EXEC) && !(vma->vm_flags & VM_EXEC)` 时要求 `FILE__EXECMOD` 权限，无则返回 EACCES。
4. wine 映射的文件实际位于 composefs 的 ostree object 存储（`/sysroot/ostree/repo/objects/`，AVC 中 path 显示为 `/d8/<hash>.file`），SELinux 类型 `lib_t`。32 位模块的 `mmap(RW) + mprotect(RX)` 组合触发 execmod 检查并被拒。
5. 64 位模块同样触发该 mprotect 失败（拦截器实测确认），但 wine 对该路径容错（页面保持 RW 继续运行）；32 位 ntdll 的失败导致 wow64 异常处理栈初始化崩溃（`virtual_setup_exception stack overflow`），进程必现死亡。

### wine-tkg 为何可行

wine 11.13（tkg 构建）的加载路径 mmap 直接带 PROT_EXEC（vma 初始即有 VM_EXEC），后续 mprotect 不再经过"无 exec vma 添加 exec"的 SELinux 检查分支，因此 Enforcing 下不受影响。

### 未完全解释的细节

- 同域（unconfined_t）同文件（lib_t）下，python ctypes 完整复刻 wine 的映射序列（低地址保留区 + MAP_FIXED + mprotect(RX)）**成功**，未复现拒绝。推测与 wine 的 MAP_FIXED 覆盖序列（先整块映射再逐 section 覆盖）或 composefs 底层对象映射的 LSM 处理细节相关，未进一步定位。
- AVC 记录的 scontext 为 `system_u:system_r:kernel_t`（非用户进程的 unconfined_t），原因未明，疑似 composefs 内核态映射路径的记录行为。
- 这两点不影响结论：setenforce 0 验证、AVC 记录、wine-tkg 绕过三条证据链闭合。

## 排查过程（时间线）

### 阶段 1：确认 32 位子系统失败

| 步骤 | 做法 | 结论 |
|------|------|------|
| 1a | `findmnt -T` 检查挂载 | btrfs/tmpfs 均无 noexec，排除文件系统挂载问题 |
| 1b | `systemd-detect-virt`、`/proc/self/status` 的 Seccomp 字段 | 非容器、无 seccomp，排除沙箱限制 |
| 1c | `rpm -qa`、`readlink -f /usr/bin/wine`、`rpm -ql wine-core` | 确认 wow64-only 构建；前缀 syswow64 空是正常设计 |
| 1d | `WINEARCH=win32` 建 32 位前缀 | 被拒：`not supported in wow64 mode`，此路不通 |
| 1e | ctypes 测试 mprotect exec（初版有 bug，见"踩过的坑"） | 修正后环境层面 mprotect(RX) 全部正常，排除内核/文件系统问题 |
| 1f | python 复刻 wine 加载序列（保留区 + MAP_FIXED + mprotect） | 成功，指向 wine 进程内部而非环境 |

### 阶段 2：定位到 SELinux（LD_PRELOAD 拦截器）

| 步骤 | 做法 | 结论 |
|------|------|------|
| 2a | rust 编译 cdylib 拦截 `mprotect`（dlsym RTLD_NEXT），LD_PRELOAD 注入 wine | 拿到失败调用参数：`addr=0x7bcb1000 len=0x75000 prot=0x5(RX) errno=13(EACCES)` |
| 2b | 失败时重试不同 prot | `RW/R` 成功，`RX/RWX` 失败：exec 被拒 |
| 2c | 失败时 dump `/proc/self/smaps` VmFlags | `rd wr mr mw me ac sd`：**me（VM_MAYEXEC）存在**，排除内核 VMA 层检查，指向 LSM |
| 2d | backtrace + debuginfod 拉 debuginfo + addr2line 解析符号 | 失败点：`set_vprot`/`virtual_map_image`（内置模块加载）、`virtual_set_force_exec`（NtSetInformationProcess 的 DEP 处理） |
| 2e | `journalctl` 查 AVC | `denied { execmod } path="/d8/<hash>.file" tcontext=system_u:object_r:lib_t tclass=file permissive=0`，时间与 wine/winetricks 运行吻合（comm 含 rundll32.exe），实锤 |
| 2f | `sudo setenforce 0` 验证 | mprotect 错误消失，ntdll 加载成功；确认 execmod 是直接原因 |

### 阶段 3：permissive 下的次生问题

`setenforce 0` 后新错误 `wine: could not load kernel32.dll, status c0000135`（STATUS_DLL_NOT_FOUND）：

- `WINEDEBUG=+module` 日志：wow64 链（wow64.dll / wow64cpu.dll / win32u.dll / wow64win.dll）全部加载成功，kernel32 无任何 trace 直接 Failed
- 联网检索：Arch/Manjaro/Void 用户报告过相同组合（wow64 + c0000135），其中 Arch 用户更换 wine-tkg 构建后解决，提示 wine 11.0 的 wow64 加载器在 32 位 kernel32 路径上存在问题，后续版本（11.13）已修复
- 该问题因 wine-tkg 方案而无需单独深挖

### 阶段 4：旁路尝试 GE-Proton（失败）

umu-launcher + GE-Proton11-3（multilib wine + steamrt4 容器）：

- 容器内 `pressure-vessel` 报 `Cannot determine ld.so for i386-linux-gnu`：host 未装 glibc.i686，无 32 位 ld-linux.so.2，i386 库收集工具无法运行
- 游戏进程启动后即退出，日志 `wine client error: write: Bad file descriptor`
- permissive 下复测依旧失败：与 SELinux 无关，是容器 i386 组件缺失问题
- **结论：该路线挂起**。后续若需启用，可先 `rpm-ostree install glibc.i686` 再试，未验证

### 阶段 5：wine-tkg 方案成功

```bash
mkdir -p ~/.local/share/wine-tkg
curl -sL -o /tmp/wine-tkg.tar.xz "https://github.com/Kron4ek/Wine-Builds/releases/download/11.13/wine-11.13-staging-tkg-amd64-wow64.tar.xz"
tar -xJf /tmp/wine-tkg.tar.xz -C ~/.local/share/wine-tkg/ --strip-components=1
WINEPREFIX=~/.local/share/wineprefixes/tkg ~/.local/share/wine-tkg/bin/wine wineboot -u
```

- `amd64-wow64` 构建不需要系统 i686 库，SELinux Enforcing 下直接运行成功
- 首个游戏启动约 20 秒完成 dll 初始化（有主进程堆临界区等待超时告警，随后正常），此后游戏常驻

## 踩过的坑

1. **ctypes 测试两次假象**：未开 `use_errno=True` 导致 errno 全为残留值；未声明 `argtypes` 导致地址参数截断为 32 位（mprotect 打到错误地址返回假 ENOMEM）。一度误导到"内核 W^X 限制"方向，浪费多轮。修正后用 `/tmp/nxtest`（rust 原生测试）验证环境完全正常。
2. **wine 的 `noexec filesystem?` 是统一报错**：wine 源码中 mprotect 失败一律打这个字样，不看 errno，字面上极具误导性。
3. **搜索案例不可直接类比**：box64（RPi5）与 Gentoo 的类似报错分别来自模拟器环境和 PAX/加固内核，与本机无关。
4. **cjkfonts 的状态码 53 与本次问题同源**：winetricks 尝试运行 `syswow64\regedit.exe` 失败（32 位子系统不可用），早期被误判为 winetricks 路径转义 bug，实为 32 位加载失败的先兆。
5. **复制 32 位 dll 到前缀 syswow64 无效**：wow64 模式下 syswow64 是虚拟路径，wine 从 `/usr/lib64/wine-wow64/wine/i386-windows/` 内置加载。

## 排除过的方案

| 方案 | 结果 | 说明 |
|------|------|------|
| flatpak Lutris（路径 A） | 未采用 | 无生肉翻译需求，绿色版直跑场景下 GUI 流程是负担 |
| 系统 wine + 全新前缀 | 失败 | 32 位内置模块加载被 execmod 拒绝 |
| WINEARCH=win32 前缀 | 不可行 | wow64 模式明确不支持 |
| 复制 dll 至前缀 syswow64 | 无效 | 虚拟路径，内置加载不受前缀文件影响 |
| GE-Proton + umu 容器 | 失败 | pressure-vessel 缺 i386 组件（host 无 glibc.i686），与 SELinux 无关 |
| SELinux 布尔（execmem/execstack） | 无效 | 被拒的是 file 类 execmod 权限，布尔不覆盖；且 unconfined 域不受这两布尔限制 |
| setenforce 0 / permissive | 验证有效，未采用 | 作为根因验证手段，不作为长期方案 |
| **Kron4ek wine-tkg 11.13** | **成功** | mmap 带 exec 绕过检查，Enforcing 下直接运行 |

## 参考链接

- [wine dlls/ntdll/unix/virtual.c（master）](https://fossies.org/linux/wine/dlls/ntdll/unix/virtual.c) —— set_vprot、map_image_into_view、virtual_set_force_exec 实现
- [wine 11.0 Phoronix 报道](https://www.phoronix.com/news/Wine-11.0-January-2026) —— wow64 新架构背景
- [Kron4ek/Wine-Builds](https://github.com/Kron4ek/Wine-Builds) —— amd64-wow64 构建说明
- [Fedora Discussion：F43 与 wine wow64 转型](https://discussion.fedoraproject.org/t/f43-upgrade-and-wine-or-not-yet/171413) —— Fedora wine 打包从 multilib 转 wow64 的背景
- [r/archlinux：wine c0000135 案例](https://www.reddit.com/r/archlinux/comments/1leronq/wine_kernel32dll_status_c0000135_is_not_working/) —— 换 tkg 构建解决的同类案例
- [Red Hat Bugzilla 2401666](https://bugzilla.redhat.com/show_bug.cgi?id=2401666) —— Fedora wine multilib 冲突历史

## 当前状态

- 主运行路径：wine-tkg 11.13 + `~/.local/share/wineprefixes/tkg`，SELinux Enforcing 保持默认
- 系统 wine 11.0 保留（64 位程序、winetricks 组件管理），32 位游戏不用
- 使用方式与排错速查见 [fedora-kinoite-wine-galgame-setup.md](fedora-kinoite-wine-galgame-setup.md)
