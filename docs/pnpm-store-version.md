# pnpm 版本切换与 store 重链

## 现象

2026-10-24 在 dotfiles 跑 `pnpm add` 报 `ERR_PNPM_UNEXPECTED_STORE`：`node_modules` 链接自 `~/.pnpm-store/v10`，pnpm 想用 `~/.local/share/pnpm/store/v10`。

## 根因

- `/usr/bin/pnpm` 是全局 12.15.0；仓库 `packageManager` 固定 `pnpm@10.33.2`，pnpm 10 起会按声明自动切换版本。仓库内 `pnpm --version` 报 10.33.2，仓库外报 12.15.0。
- store 布局随 pnpm 版本走：本机 10.33.2 用 `store/v10`，12.15.0 用 `store/v11`。
- 本机 `pnpm store path` 报的是 launcher 视角的 `store/v11`；`pnpm install` 实际由 10.33.2 执行，落盘到 `store/v10`。判断当前项目用哪个 store，以 `node_modules/.modules.yaml` 的 `storeDir` 为准。
- 现有 `node_modules` 是旧 pnpm 10.x 用 `~/.pnpm-store/v10` 装的；版本切换后路径对不上，触发保护。

## 处理

无 TTY 时 pnpm 要求显式确认清空 `node_modules`：

```sh
pnpm install --frozen-lockfile --config.confirmModulesPurge=false
```

完成后 `node_modules/.modules.yaml` 的 `storeDir` 变为 `~/.local/share/pnpm/store/v10`，再次裸跑 `pnpm install --frozen-lockfile` 直接成功。

## 注意

- 不要为了让全局版本对上而改 `packageManager`；锁文件与工具链按 10.33.2 验证。
- 旧 store `~/.pnpm-store/v10`（约 572M）仍被 `~/Codes/dotfiles-sha256-archive` 的 `node_modules` 引用，不能整目录删；清理前先查各仓 `.modules.yaml`。
- 磁盘当时占用 93%；`~/.local/share/pnpm/store` 下 v10 与 v11 并存属正常，不同 pnpm 版本各用各的。
- `pnpm store path` 与 `pnpm install` 可能来自不同版本，别用它判断项目 store。
