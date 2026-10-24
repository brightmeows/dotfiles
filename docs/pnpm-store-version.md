# pnpm 版本与 store 布局

## 当前定义

- 仓库 `packageManager` 为 `pnpm@12.15.0`；本机 `/usr/bin/pnpm` 也是 12.15.0，仓库内外版本一致。此前全局 12.15.0 与仓库 10.33.2 并存时，pnpm 会按 `packageManager` 自动切换版本。
- pnpm 12 仍写 `lockfileVersion: '9.0'`。项目 pin 了 pnpm 时，`pnpm-lock.yaml` 是两个 YAML 文档：第一个是 env 文档，记录 `configDependencies` 与 `packageManagerDependencies`（pnpm 本体和各平台 `@pnpm/exe`）；第二个是项目依赖文档。不要手工合并这两个文档。
- store 在 `~/.local/share/pnpm/store/v11`；`node_modules/.modules.yaml` 的 `storeDir` 与之一致。v10 是 pnpm 10.33.2 时代留下的。

## 2026-10-24 的 ERR_PNPM_UNEXPECTED_STORE（历史）

当时 `node_modules` 链在 `~/.pnpm-store/v10`，pnpm 想用 `~/.local/share/pnpm/store/v10`，触发保护。处理方式：

```sh
pnpm install --frozen-lockfile --config.confirmModulesPurge=false
```

无 TTY 时必须显式确认清空 `node_modules`。重链后 `.modules.yaml` 的 `storeDir` 指向 pnpm 当前版本的 store；判断以这个字段为准，不要只看 `pnpm store path`（版本切换时它可能报另一套 store）。

升级 pnpm 12 时又做了一次同样的重链，落到 `store/v11`。

## 构建脚本放行

- pnpm 11 起不再读 `package.json` 的 `pnpm` 字段，构建放行配置在 `pnpm-workspace.yaml`。
- pnpm 12 用 `allowBuilds` 映射（`包名: true | false`），`onlyBuiltDependencies` 旧名不再生效。
- 本仓显式拒绝 `@google/genai` 与 `protobufjs` 的构建脚本（`false`），与 pnpm 10 时代忽略它们的行为一致；需要放行时用 `pnpm approve-builds <包名>`。
- 未在 `allowBuilds` 出现的构建脚本在 pnpm 12 下会让 `pnpm install` 以 `ERR_PNPM_IGNORED_BUILDS` 失败，不再只是警告。

## 注意

- 旧 store `~/.pnpm-store/v10`（约 572M）仍被 `~/Codes/dotfiles-sha256-archive` 的 `node_modules` 引用，不能整目录删；清理前先查各仓 `.modules.yaml`。
- 磁盘当时占用 93%；`~/.local/share/pnpm/store` 下 v10 与 v11 并存属正常。
- 不要为了对齐全局版本改 `packageManager` 到未验证的版本；锁文件与工具链按 12.15.0 验证。
