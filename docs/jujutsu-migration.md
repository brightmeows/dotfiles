# Jujutsu 迁移记录（dotfiles 仓库）

记录本仓库引入 jujutsu（jj）的决策、使用方式谱系与失效模式。jj 版本基线：本机 0.45.1（上游 0.46.0 已发布，含 workspace colocate 与模板 json map 增量）。官方文档 docs.jj-vcs.dev/latest；hook 缺口追踪 jj-vcs/jj#405。

## 决策总表

| 决策点 | 结论 | 依据 |
|---|---|---|
| 角色 | 日常主力，git 留兼容层 | 主人裁决（grilling 共识） |
| 形态 | colocated 共存（`jj git init` 默认） | 保留 GitHub 远端与既有 git 工具链；删 `.jj` 与 `.git/jj` 可完全卸载 |
| 配置托管 | `dot_config/jj/config.toml`（共享层）+ `~/.config/jj/conf.d/`（本机层，不托管） | jj 的 repo 级配置出于安全设计不存仓库内，托管只能走 user config 路线 |
| 签名 | `signing.backend = "gpg"`、`behavior = "own"`；key 放 conf.d 本地层 | 对齐 `.gitconfig` 的 `commit.gpgsign = true`，GitHub Verified 不断 |
| 验证门槛 | 会话纪律兜底：jj 提交不触发 git hooks，收尾手动跑 `.githooks/pre-commit` | jj 不执行 git hooks（官方文档 Git compatibility 节，#405 未落地）；第三方 jj-hp 只识别 pre-commit.com 等四种 runner 格式，对本仓库自定义 hook 脚本无效 |
| inline-context | Git 行尾追加 jj colocated 标注，修正快照基准失真 | colocated 下 git HEAD 停在 @-，git 的“未提交”实为相对 HEAD 的差异，语义需显式纠正 |

## 接入形态谱系

- **colocated 共存**（本仓库采用）：`.jj` 与 `.git` 同目录，jj/git 双界面，每次 jj 命令自动双向同步 refs。适合保留 git 工具链（远端、hook、第三方集成）的仓库。`.jj` 目录由 jj 内建忽略机制处理，git status 零污染，仓库 `.gitignore` 无需条目。
- **纯 jj**（`--no-colocate`）：git 仓库藏进 `.jj` 内部，需显式 `jj git import/export` 同步。适合无 git 依赖的个人项目；对本仓库这类配置仓库，hook 与 chezmoi 的 git 假设全部要重审，不采用。
- **只读旁观**：colocate 后仅用 jj log/diff/undo 观察，提交仍走 git。适合试水期；本仓库已越过此阶段。
- **`jj git clone` 新克隆**：新机器直接以 jj 接管，colocated 为默认形态。其他机器迁移时按此路径，无需先 git clone。

## 日常操作流谱系

- **匿名 change 流**：工作自然落进 `@`，`jj commit`（描述并开新 change）或 `jj new` 推进。不需要提前想分支名，是 jj 的默认心智模型。
- **bookmark 直推流**（本仓库 main 工作流的等价物）：收尾检查通过后 `jj bookmark set main -r @`，再 `jj git push`。`immutable_heads()` 默认保护 `main@origin`，改已推送历史会被拦，属预期行为。
- **修订流**：`jj describe` 补描述、`jj squash`（含 `-i` 交互）合并改动、`jj split` 拆分提交、`jj absorb` 把零散修改归位到相关提交、`jj diffedit` 不检出改历史。拆分提交场景（type 或 scope 不同需拆开时）用 `jj split <路径>`。
- **兜底与回溯**：`jj undo`/`redo` 撤销最近仓库操作，`jj op log` 查全部操作历史，`jj evolog` 看单个 change 的演化。误操作先看这里，不靠重新做。
- **多工作副本**：`jj workspace add <目录>` 创建独立工作副本（对应 git worktree）。大幅重构隔离用这个；0.46 起子 workspace 也支持 colocate（本机 0.45.1 尚无）。workspace 可能 stale，用 `jj workspace update-stale` 恢复。
- **自动化**：`jj run` 对一组 change 各配私有工作副本跑命令（0.43+）；`jj fix` 挂格式化工具按提交修文件（可配 line-range 行级格式化）；`jj bisect` 内建二分。
- **推送形态**：`jj git push` 按 bookmark 推送；`jj git fetch` 按 change ID 重写本地后代并 rebase；tag 的 fetch/push 自 0.44 稳定化。

## 混用边界与失效模式

- **git 写命令避免在 jj 仓库使用**（`git add`/`git commit` 改历史的动作走 jj）。git 读命令（log/diff/show）可用，但注意基准差：git HEAD 停在 @-，
  `git status` 显示的“未提交”与 `git log` 的 HEAD 都滞后 jj 工作副本一个 change。外部 `git add` 混用曾致 index 损坏，0.45 已修，但语义错位仍在。
- **git hooks 不触发**：jj 提交路径完全绕过 `.githooks/`，format/lint 门槛退化为纪律。收尾必须手动跑 `.githooks/pre-commit`（或照抄其中的命令行），这与根 AGENTS.md 的“hook 外补验”条款同一姿势。
- **colocated 的手动同步命令默认禁用**（0.44+）：自动 import/export 已内建，手动 `jj git import/export` 通常无事可做且曾有竞态。
- **stale working copy**：其他 workspace 改写了本 workspace 的 @ 时，本 workspace 变 stale，`jj workspace update-stale` 恢复。
- **快照吸附与 abandon 连带撤销**（本仓库实际踩中）：jj 自动快照把工作区全部改动吸附进当前 @；若随后对新历史提交做 `abandon`，被弃提交吸附的改动（如新增文件）会被连带撤销并从磁盘消失。清理探针提交前先 `jj show` 确认它吸了什么，无关改动先 `jj split` 出去；丢弃改动改用 `jj restore`（按路径），不要用 abandon 清场。
- **检测类 jj 调用必须带 `--no-integrate-operation`**（0.41+ 全局 flag）：否则任何 jj 命令都会快照工作副本并写操作日志，脚本与扩展的“只读”探测会改仓库状态。挂起的快照会在下一个正常 jj 命令时补上，属预期。

## 配置托管结构

- 唯一托管源：[`dot_config/jj/config.toml`](../dot_config/jj/config.toml)，`chezmoi apply` 部署到 `~/.config/jj/config.toml`。内容为共享层：用户身份与签名策略。
- 本机层：`~/.config/jj/conf.d/*.toml`，不入仓库，放机器相关项（当前是 `signing.key` 的 GPG 指纹）。conf.d 在 config.toml 之后加载，同名键覆盖（实测确认）；chezmoi copy 模式不清理部署区多余文件，conf.d 天然安全。
- **双源义务**：jj 不读 git config（实测 `user.name` 无 fallback），身份在 `.gitconfig` 与 jj config 各存一份，改动需同步两处。repo 级配置不存仓库内是 jj 的安全设计，仓库差异配置走 user config 的条件作用域：

```toml
[[--scope]]
--when.repositories = ["~/Codes/dotfiles"]
# 仅该仓库生效的键
```

条件维度含 repositories / workspaces / commands / platforms / hostnames / environments，可替代大部分“机器相关本地写”的补丁场景。

## inline-context 的 jj 感知

`pi-meow-inline-context` 扩展在 Git 行尾追加 colocated 标注：`@` 的短 change ID、描述首行、冲突标记，并提示 git 快照的基准失真。
检测用 `jj --no-integrate-operation workspace root`（失败即非 jj 仓库，整段省略），数据一条模板命令拿到，描述经 `escape_json` 转义防分隔符注入。
detached HEAD 的既有提示句（“收尾时需创建分支”）在 jj 场景被抑制，改为标注 colocated 正常形态。设计细节见扩展文件头注释。

## 实测记录

- 初始化：`jj git init` 后历史完整导入，`@` 为 main 之上的空提交；`jj bookmark track main@origin` 建立跟踪（init 提示的必做项）。
- 身份：未配置时提交 author 为空（官方警告 push 会被拒），配置后正常。
- 签名：探针提交经 `git log --format='%G?'` 验证为 `G`（有效签名），git/GitHub 侧完整识别；探针以 `jj abandon` 清理，历史无痕。
- conf.d 优先级：config.toml 与 conf.d 同键并存时 conf.d 胜出（实测）。
- 失真形态：新建文件在 git status 为未跟踪（`??`），jj 侧已是 `A`（快照进 @）；git HEAD detached 在 @-，`git branch --show-current` 返回空。
