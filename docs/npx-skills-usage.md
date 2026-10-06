# npx skills 使用规范与踩坑记录

> 2026-08-11 建立。记录 npx skills CLI 的作用域机制、remove 假成功 bug 与安全使用姿势。

## 背景

本机通过 npx skills 管理全局技能（`~/.agents/skills`）。2026-08-11 清理全部全局技能时发现 remove 命令存在假成功问题，且本机安装了多个 agent（codex、opencode、claude-code、goose、trae、openclaw、hermes-agent 等），导致行为与直觉不符。本文记录源码级分析结论与安全操作姿势。

## 关键机制（源码层面，skills CLI 1.5.22）

### universal agent 与 canonical 目录

- `~/.agents/skills` 是 canonical/universal 目录，`skillsDir = ".agents/skills"` 的 agent（codex、opencode、amp、replit 等）都共享它
- 各 agent 还有专属目录（`globalSkillsDir`）：
  - codex → `~/.codex/skills`
  - opencode → `~/.config/opencode/skills`（原 symlink 危险区；2026-10-06 随仓库分发退役，专属目录已删除）
  - claude-code → `~/.claude/skills`
  - goose → `~/.config/goose/skills`
  - trae → `~/.trae/skills`
  - openclaw → `~/.openclaw/skills`
  - hermes-agent → `~/.hermes/skills`
  - pi → `~/.pi/agent/skills`
- `detectInstalled` 只检查目录存在性：`~/.codex`、`~/.config/opencode`、`~/.claude`、`~/.config/goose`、`~/.trae`、`~/.openclaw`、`~/.hermes`、`~/.pi/agent` 在本机都存在，因此全部被当作“已安装 agent”

### remove 的假成功 bug

remove 逻辑（`dist/cli.mjs` 5958 行附近）：

1. 对每个 targetAgent 清理其专属目录，但 **canonical 路径被跳过**（`if (pathToCleanup === canonicalPath) continue`）
2. 计算 `remainingAgents`（已安装 agent 减去 targetAgents），只要有任一剩余 agent 的安装路径存在，`isStillUsed = true` → **不删 canonical 文件、不删 lock**
3. 但无论是否真删，结果都 push `success: true` → **报“Successfully removed”但实际没删**

因此：

| 用法 | 实际效果 |
|------|---------|
| `remove X -g -a codex` | **假成功**：opencode 也是 universal 且已安装，其安装路径指向 canonical 存在 → 不删 |
| `remove X -g -a codex -a opencode` | 仅当 codex+opencode 是**全部**已安装 universal agent 时真删；claude/goose/trae/openclaw 专属目录里的同名副本会被清，但 canonical 删除仍取决于 remainingAgents 中无 universal agent |
| `remove X -g`（不带 -a） | targetAgents = 全部 60+ agent → remainingAgents 为空 → **必删 canonical + lock**，同时清理所有 agent 专属目录中的同名技能 |

本机实测：lark-* 27 个技能曾因 `-a codex -a opencode` 假成功残留，最终靠不带 `-a` 全部真删。

### `--all` 的危险

`remove --all` = `--skill '*' --agent '*'`，不带 `-g` 同样作用于全局，效果是清空 canonical 全部技能。
2026-08-10 事故中它曾顺着 opencode symlink（`~/.config/opencode/skills` → `~/.agents_meow/skills`）删掉仓库源文件；
该 symlink 已于 2026-10-06 随仓库技能分发退役删除，但**仍然不要用 `--all`**。

### add 的行为

- `add <repo> -g -a codex`：codex 是 universal agent → 只写 canonical `~/.agents/skills`，所有 universal agent 共享，opencode/pi 都能读到
- 不带 `-a`：检测到已安装 agent 后 `ensureUniversalAgents(installedAgents)` → 也写 canonical；但会装到各 agent 专属目录（本机 claude/goose/trae/openclaw/hermes 都有副本）
- 推荐显式 `-a codex`，只装 canonical 一份

## 安全操作姿势

### 安装

```bash
npx skills add <owner>/<repo> -g -a codex
```

### 删除

```bash
# 方式 A（推荐）：不带 -a，让 CLI 清理所有 agent 目录 + canonical + lock
npx skills remove <技能名> -g -y

# 方式 B：列出全部已安装的 universal agent（本机为 codex+opencode），仅清 canonical
npx skills remove <技能名> -g -a codex -a opencode -y
```

### 删除后必须验证（CLI 报成功 ≠ 真删）

```bash
ls ~/.agents/skills/                    # 应为空
jq '.skills | length' ~/.agents/.skill-lock.json   # 应为 0
find ~ -maxdepth 4 -type d -name "<技能名>" 2>/dev/null | grep -v "\.npm\|node_modules\|\.cache"
```

### 铁律

1. **永远不要 `npx skills remove --all`**（会清空 canonical 全部技能）
2. 每次操作后检查 canonical 目录和 lock 文件确认实际效果，不信任 CLI 的 success 报告
3. 本机不再提供 `skills` wrapper（2026-08-11 移除），裸跑 `npx skills` 需自己确认作用域

## 本机 agent 状态备忘

| agent | 目录 | universal | 备注 |
|-------|------|-----------|------|
| codex | `~/.codex` | 是 | skillsDir = .agents/skills；`~/.codex/skills` 下 16 项 npx 副本 2026-09-24 已删（保留 `.system/` codex 自管系统技能与 Omarchy 只读技能 diagnose-crash/omarchy） |
| opencode | `~/.config/opencode` | 是 | 专属 skills symlink 已于 2026-10-06 退役删除，技能读 canonical |
| claude-code | `~/.claude` | 否 | 已弃用，根目录 2026-09-24 删除（内仅 skills 副本与 omarchy 主题，无用户数据），npx 不再检测 |
| goose | `~/.config/goose` | 否 | 根目录不存在，npx 不检测 |
| trae | `~/.trae` | 否 | 根目录不存在，npx 不检测 |
| openclaw | `~/.openclaw` | 否 | 根目录不存在，npx 不检测 |
| hermes-agent | `~/.hermes` | 否 | 已弃用，根目录 2026-09-24 删除（内仅 44 项 skills 副本，原 openclaw-imports 自管区已不存在），npx 不再检测 |
| pi | `~/.pi/agent` | 否 | `~/.pi/agent/skills` 副本区 2026-09-24 已删除（45 项均为 canonical/meow 的一致副本，Pi 原生扫描 canonical + settings skills 数组，副本无存在必要）；技能由 `~/.agents/skills`（canonical）单通道承载（settings skills 数组 2026-10-06 移除） |

## 本机技能目录现状（2026-10-06 盘点）

| 目录 | 数量 | 职责 |
|------|------|------|
| `~/.agents/skills` | 18 | npx canonical 区：全部技能唯一存放点（含自有 4 仓库的 9 个技能，2026-10-06 安装） |
| `~/.pi/agent/skills` | 已删 | Pi 原生扫描 canonical，专属副本区冗余（2026-09-24 删） |
| `~/.agents_meow/skills` | 已删 | 原仓库本地技能分发区，2026-10-06 随 `dot_agents_meow/skills` 迁往自有 GitHub 仓库而退役；opencode/dsh symlink、Pi settings skills 数组同步移除 |

注意：`~/.agents/.skill-lock.json` 现已存在（25 条），其中 7 条（docx、humanizer-zh、pdf、pptx、
pptx-generator、uv-package-manager、xlsx）在 canonical 目录无对应文件，为历史幽灵条目；lock 内有效技能
可走 `skills update`，升级前先核对 lock 与目录的一致性。

## 变更历史

- 2026-10-06：仓库技能分发退役。`dot_agents_meow/skills` 全部 5 技能（codeberg-github-migration、
  git-hash-repo-conversion、grilling、querying-clippy-lints、writing-for-agents）已迁往自有 GitHub 仓库
  （skills-scratch、rust-meta-skills、workflow-skills），本机 `~/.agents/skills` 经 npx 安装承载（4 仓库 9 技能）；
  删除仓库分发区、`~/.agents_meow/skills`（含 10 项历史孤儿副本）、opencode/dsh symlink、Pi settings skills 数组
- 2026-10-04：meow 分发区新增本地技能 writing-for-agents（中文本地化，译自 mattpocock/skills 的
  skills/productivity/writing-for-agents，基准提交 d81f3a1，含 SKILL.md 与 SKILL-MECHANICS.md）；
  上游同名技能不要再用 npx 安装，避免 canonical 与本地版本重名
- 2026-10-02：canonical 增装 humanizer-zh（op7418/Humanizer-zh，基于
  blader/humanizer v3.0.0 的中文润色技能，revision 2026-09-23）；安全姿势
  `npx skills add … -g -a codex -y`，专属目录零副本；lock 文件仍未生成，
  `skills update` 账本继续不覆盖，升级需重新 add
- 2026-09-24（二次清理）：弃用并删除 claude-code（`~/.claude`）与 hermes（`~/.hermes`）根目录，npx 不再检测二者；删除 `~/.codex/skills` 下 16 项 npx 副本（保留 `.system/` 与 Omarchy 只读技能）。CLI 1.7.0 源码确认无作用域配置机制
  （agent 表硬编码、detectInstalled 为目录存在性检查），“只管 canonical”只能靠姿势：add 永远 `-a codex`
- 2026-09-24：删除 `~/.pi/agent/skills`（45 项纯冗余副本，验证技能索引集合前后 diff 为零、collision 日志消失）；14 个 cloudflare 系技能自 meow 分发区迁入 canonical，meow 区职责纯化为仓库本地技能分发区；更新本表 pi 行与技能目录现状节
- 2026-08-11：移除 bash/nushell 的 `skills` wrapper；清空全部全局技能（33 个 + lark-* 27 个副本）；本文档建立
- 2026-08-10：`npx skills remove` 曾顺着 opencode symlink 删除仓库源文件（事故）
