# NVM shim 模式 NVM4306 拦截排查

> 2026-10-04 建立；2026-10-05 nvm 在本机退役（见文末“退役记录”），本文化为历史参考。
> 记录 `pi update --extensions` 被 NVM for Windows 以 NVM4306 拦截的根因（脚本信任缓存 USN 漂移）、源码级机制与修复命令。

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
另：bash 下路径必须用单引号包裹，否则反斜杠被当转义符吃掉、签名器对不存在的目录静默返回 nil（exit 0 的假成功），见“退役记录”。

## 复发与处置

只要 USN 日志再变动（日志重置、卷操作等）即会复现，且本机构建的 proxy 没有自动恢复（prompt/allow 重签）路径，不会自愈。复发时执行：

```text
nvm --sign-version-scripts D:\ScoopGlobal\persist\nvm\nodejs\v24.21.0
```

可选固化：给 `pi update` 包一层遇 NVM4306 自动重签重试的 wrapper（截至记录时尚未做）。

## 退役记录（2026-10-05）

nvm 已在本机卸载，改用 scoop 全局安装的 nodejs 26.10.0；pnpm 由 scoop 的 pnpm 12.9.x 提供（实测自动识别
`package.json` 的 `packageManager` 引脚并自管版本），npm 全局 prefix 保持 `C:\Users\19601\.local\bin`
（用户级 `~/.npmrc`，与 node 安装目录解耦）。Node 25 起 corepack 不再随发行包分发，该方案不依赖 corepack。

退役动机：shim 代理的信任层会随 USN 日志变动反复失效（本文问题），且 `auto_detect` 在 `.nvmrc` 指向未安装
版本时直接拦截（本机 brightmeows.github.io 的 `.nvmrc=26` 曾使 node 完全不可用），收益为负。换到 scoop
nodejs 后没有代理层，NVM4306 这一类问题不复现，升级即 `scoop update nodejs`。

退役过程中确认的两点操作事实：

- 在 bash 里直接写 `nvm --sign-version-scripts D:\ScoopGlobal\persist\nvm\nodejs\v24.21.0`，反斜杠被当
  转义符吃掉，路径变成不存在的 `D:ScoopGlobalpersistnvmnodejsv24.21.0`；签名器对不存在的目录静默返回
  nil，命令 exit 0 却没有做任何事（假成功）。必须用单引号。
- `--sign-version-scripts` 覆盖版本目录顶层的全部 `.cmd`/`.bat`（含 corepack 生成的 `pnpm.CMD`/`pnpx.CMD`），
  不止 npm/npx；重签会把条目 USN 刷成当前实读值（本机为 `0x0`）。

## 参考

- 源码：`nvm-windows/shim`（proxy/reshim）、`nvm-windows/common/verifycache`（信任缓存与重签逻辑）、`nvm-windows/docs`（NVM4306 错误码文档）
- 本机数据：`HKCU\Software\Author Software\Preferences\nvm\VerifyCache\scripts`、`D:\ScoopGlobal\persist\nvm\`
