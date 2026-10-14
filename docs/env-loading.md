# 环境变量配置：单一数据源 + 双加载路径

**数据源**：`dot_env_common`（bash 与 nushell 共享的静态变量，chezmoi 管理）+ 可选 `~/.env_self`（本地补充，不入仓库）。

**自定义语法**（`KEY=` 原样 / `KEY+=` 以 `:` 追加 / `KEY<=` 前插）由 shell 加载器与 environment.d 生成脚本共用。

**双加载路径**：

| 路径 | 消费者 | 影响范围 | 读取源 |
|---|---|---|---|
| ① Shell | `dot_bashrc`（`_load_env_file`）、`dot_config/nushell/env.nu`（`load-env-file`） | TTY/SSH 登录的交互式 shell | `.env_common` + `.env_self` |
| ② systemd environment.d | `run_onchange_after_gen-environmentd.sh.tmpl` → `~/.config/environment.d/50-meow.conf` | systemd user manager 及图形会话（Hyprland/niri） | 仅 `.env_common` |

## 踩坑点

- environment.d **不影响** TTY/SSH 登录的 shell——纯 shell 变量只走路径①
- `~/.env_self` **只被 shell 读取**，不进 environment.d——本地补充的变量在图形会话/服务中不可见
- nushell 加载器不支持 `$VAR` 引用展开，含变量引用的项须保留在各 shell 配置内
- Nu 的 `load-env-file` 的 `PATH+=` 处理器会根据 `$env.PATH` 的类型分支：list→`append`，string→`concat`。Windows 上初始为 list，但部分场景（Nu 版本/交互模式差异）可能丢失系统 PATH。`env.nu` 底部有安全兜底——保存原始 PATH 并在末尾合并缺失条目。

> environment.d 生成产物 `50-meow.conf` 的同步机制见仓库根 AGENTS.md 的“自动同步机制”一节。
