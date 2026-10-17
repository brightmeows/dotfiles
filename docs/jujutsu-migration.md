# Jujutsu 试验记录（dotfiles 仓库）

本仓库曾于 2026-10 启用 jujutsu colocated（`jj git init`，日常主力），同月裁决回退至纯 git。回退原因：pre-commit 验证门槛在 jj 提交路径下静默失效（jj 不执行 git hooks，只能退化为会话纪律）；
colocated 下 git 语义持续失真（HEAD detached 在 `@-`、dirty 计数含 `@` 内容），git 为主的使用体验被两套心智模型互相干扰。当前仓库工作流见根 [AGENTS.md](../AGENTS.md) 的 Git Workflow 节。

本文档保留试验期的特性谱系与踩坑结论，供将来其他仓库启用 jj 时参考。

## 特性谱系（jj 通用）

- **工作副本即提交**：几乎所有命令自动把工作副本快照进 `@`，无 index、无 stash，命令不因 dirty 失败
- **change ID / commit ID 双标识**：change ID 跨重写稳定（类似 Gerrit Change-Id）
- **操作日志**：`jj op log`/`undo`/`redo`/`evolog`，所有仓库操作可查可撤
- **冲突一等公民**：冲突可提交、自动传播解决到后代；`jj resolve` 接外部合并工具
- **历史重写全家桶**：`describe`/`squash -i`/`split`/`diffedit`/`absorb -i`/`duplicate`/`parallelize`
- **revset 与模板**：`immutable_heads()` 默认保护 main/master 与远程 tags；template 语言 + `escape_json()` 拼 JSON（map 字面量需 jj 0.46+）
- **workspace 多工作副本**：`jj workspace add`（git worktree 等价物），0.46 起子 workspace 也支持 colocate
- **`jj run`**（0.43+）：对一组 change 各配私有工作副本跑命令；`jj fix` 挂格式化器；内建 bisect

## 接入形态与混用边界

- **colocated**（`jj git init` 默认）：`.jj` 与 `.git` 同目录，jj 每条命令自动双向同步 refs；`.jj` 由 jj 内建忽略，git status 零污染
- **官方口径**：允许任意顺序混用，但推荐"git 只读、jj 写"；mutating 混用仍有已知 bug（分支指针错位类，数据不丢但状态乱）
- **colocated 对 git 视角的失真**：git HEAD 停在 `@-`，`git status` 把 `@` 内容显示为未提交、`git log` 滞后一个 change；0.44 起 colocated 的手动 `import/export` 默认禁用（自动同步内建）
- **git 写命令避免在 jj 仓库使用**：`git add` 混用曾致 index 损坏（0.45 已修，语义错位仍在）
- **冲突盲区**：jj 冲突提交在 git 工具里呈现为 `.jjconflict-base-*/`、`.jjconflict-side-*/` 目录，diff 体验破功

## 踩坑备案（实测）

- **快照吸附与 abandon 连带撤销**：jj 自动快照把工作区全部改动吸进当前 `@`；对新历史提交做 `abandon` 会连带撤销它吸附的改动并从磁盘消失（本仓库实际踩中：探针提交吸走了刚写的配置文件）。清理探针前先 `jj show` 确认吸了什么，无关改动先 `jj split` 出去；丢改动用 `jj restore` 按路径，不用 abandon 清场
- **身份无 fallback**：jj 不读 git config（`user.name` 为空时提交无身份且 push 被拒），身份必须在 jj config 显式配置，与 `.gitconfig` 双源同步
- **hook 缺口**：jj 不执行任何 git hooks（官方 git-compatibility 文档，jj-vcs/jj#405 未落地）；第三方 jj-hp 只识别 pre-commit.com 等四种 runner 格式，对自定义 hook 脚本静默放行
- **检测调用必须 `--no-integrate-operation`**（0.41+ 全局 flag）：否则只读探测也会快照工作副本并写操作日志
- **conf.d 覆盖顺序**：`~/.config/jj/conf.d/*.toml` 在 `config.toml` 之后加载，同名键覆盖（本机层压过托管层的正确姿势）
- **仓库级配置不存仓库内**：jj 的安全设计（防恶意仓库），仓库差异配置走 user config 条件作用域：

```toml
[[--scope]]
--when.repositories = ["~/Codes/dotfiles"]
# 仅该仓库生效的键
```

条件维度含 repositories / workspaces / commands / platforms / hostnames / environments。

## 重启用路径

历史中的启用提交（`feat(jj)`、`feat(inline-context)` 标注）可通过 revert-the-revert 取回；重新启用即 `jj git init` + `jj bookmark track main@origin` + 恢复配置托管，签名密钥按机器放 `~/.config/jj/conf.d/`。
全局代理准则中的 jj 探测条款（AGENTS.main.md 提交节）保留未撤，jj 仓库内自动生效。
