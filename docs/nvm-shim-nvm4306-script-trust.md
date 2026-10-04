# NVM shim 模式 NVM4306 拦截排查

> 2026-10-04 建立。记录 `pi update --extensions` 被 NVM for Windows 以 NVM4306 拦截的根因（脚本信任缓存 USN 漂移）、源码级机制与修复命令。

## 现象

`pi update --extensions` 失败，npm 被 NVM proxy 拒绝执行：

```text
NVM blocked package-manager execution because a delegated command could not be trusted.

Command: npm
File: D:\ScoopGlobal\persist\nvm\nodejs\v24.21.0\node_modules\npm\bin\npm-cli.js
Reason: delegated script identity changed since it was trusted
Action: Reinstall this Node.js version or run `nvm reshim` after a trusted install.
Event code: NVM4306
```

提示给出的两条官方修复路径均无效：`nvm reshim` 重跑后报错依旧；`nvm doctor --autofix` 只报出 `.verify` 目录 ACL 加固 Access denied 警告，未刷新信任条目。

## 关键机制（源码层面，nvm-windows 2.0.0 CE，2026-09-02 构建）

shim 模式下 `npm.exe` 是 `proxy.exe` 的硬链接，proxy 解析到活动 Node 版本后先验证入口脚本信任，通过才代为执行。
npm/npx 的 JS 入口（`npm-cli.js`、`npx-cli.js`）走“SHA-256 摘要 + TPM 签名”的脚本信任缓存，
条目存于注册表 `HKCU\Software\Author Software\Preferences\nvm\VerifyCache\scripts\<path-hash>`，
字段为 Path/Size/Mtime/Digest/VolumeSerial/FileID/USN/Sig/Version。

校验顺序（`shim/shared/verifycache.zig` 的 `ensureDelegatedScriptTrusted`）：路径 → 大小与 mtime → **VolumeSerial/FileID/USN 身份三元组** → 摘要 → 签名，任一不符即 NVM4306 拦截。

与 node.exe 的关键差异：node.exe 的 verify-cache 条目身份漂移会触发 Authenticode 全量校验并重写缓存（NVM4303 → NVM4304 自愈）；
脚本没有代码签名可回退，**身份漂移即永久卡死**，只能重签（`SignVersionScripts` / `--sign-script`）。
文档把 “reshim / 重装版本 / doctor --autofix” 列为 remedy 正源于此。

信任条目在版本安装、激活、reshim 时由 `signDelegatedScript` 写入；`nvm reshim` 由 zig 版 reshim 异步 spawn `nvm --sign-version-scripts <dir>` 完成重签。

## 根因

逐项比对注册表条目与磁盘实况：Size（56 字节）、Mtime、SHA-256、FileID、VolumeSerial 全部一致，**唯独 USN 不符**——缓存里是 10 月 1 日安装时的 `0x28017d8`，实测当前读值已变为 `0x0`（推断 D 盘 USN 日志在安装后被重置，NTFS 层面文件本身从未被改写）。

即文件与内容都没变，是 USN 日志这一旁证失效导致信任判定失败。node.exe 条目因有自愈回路不受影响，npm 入口被硬拦。

## 修复

先备份注册表信任缓存：

```text
reg export "HKCU\Software\Author Software\Preferences\nvm\VerifyCache" <备份路径> /y
```

再手动执行重签（直接调 CLI，绕开 reshim 的异步 spawn）：

```text
nvm --sign-version-scripts D:\ScoopGlobal\persist\nvm\nodejs\v24.21.0
```

执行后条目 Sig 更新、USN 刷为 `0x0`，`pi update --extensions` 恢复正常。

注意：`nvm reshim` 在本机实测**不会**刷新已有条目（spawn 的签名子进程未生效，具体原因未定位）。GitHub main 已有 `nvm --sign-script <path>` 单脚本强制重签子命令，本机 2026-09-02 构建没有（`strings nvm.exe` 验证）。

## 复发与处置

只要 USN 日志再变动（日志重置、卷操作等）即会复现，且本机构建的 proxy 没有自动恢复（prompt/allow 重签）路径，不会自愈。复发时执行：

```text
nvm --sign-version-scripts D:\ScoopGlobal\persist\nvm\nodejs\v24.21.0
```

可选固化：给 `pi update` 包一层遇 NVM4306 自动重签重试的 wrapper（截至记录时尚未做）。

## 参考

- 源码：`nvm-windows/shim`（proxy/reshim）、`nvm-windows/common/verifycache`（信任缓存与重签逻辑）、`nvm-windows/docs`（NVM4306 错误码文档）
- 本机数据：`HKCU\Software\Author Software\Preferences\nvm\VerifyCache\scripts`、`D:\ScoopGlobal\persist\nvm\`
