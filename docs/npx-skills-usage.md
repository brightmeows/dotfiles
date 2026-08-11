# npx skills 使用规范与踩坑记录

> 2026-08-11 建立。记录 npx skills CLI 的作用域机制、remove 假成功 bug 与安全使用姿势。

## 背景

本机通过 npx skills 管理全局技能（`~/.agents/skills`）。2026-08-11 清理全部全局技能时发现 remove 命令存在假成功问题，且本机安装了多个 agent（codex、opencode、claude-code、goose、trae、openclaw、hermes-agent 等），导致行为与直觉不符。本文记录源码级分析结论与安全操作姿势。

## 关键机制（源码层面，skills CLI 1.5.22）

### universal agent 与 canonical 目录

- `~/.agents/skills` 是 canonical/universal 目录，`skillsDir = ".agents/skills"` 的 agent（codex、opencode、amp、replit 等）都共享它
- 各 agent 还有专属目录（`globalSkillsDir`）：
  - codex → `~/.codex/skills`
  - opencode → `~/.config/opencode/skills`（**symlink → `~/.agents_meow/skills`**，危险区）
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

`remove --all` = `--skill '*' --agent '*'`，会把 **opencode symlink 区（`~/.agents_meow/skills`）中的本地技能**
（grilling、humanizing-text、querying-clippy-lints）也纳入删除清单，rm 顺着 symlink 删除真实文件 → 2026-08-10 事故重演。**永远不要用 `--all`。**

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

1. **永远不要 `npx skills remove --all`**（会波及 opencode symlink 区）
2. 删除前确认技能名不与 `~/.agents_meow/skills` 下的本地技能重名（grilling、humanizing-text、querying-clippy-lints）
3. 每次操作后检查 canonical 目录和 lock 文件确认实际效果，不信任 CLI 的 success 报告
4. 本机不再提供 `skills` wrapper（2026-08-11 移除），裸跑 `npx skills` 需自己确认作用域

## 本机 agent 状态备忘

| agent | 目录 | universal | 备注 |
|-------|------|-----------|------|
| codex | `~/.codex` | 是 | skillsDir = .agents/skills |
| opencode | `~/.config/opencode` | 是 | globalSkillsDir 是 symlink 危险区 |
| claude-code | `~/.claude` | 否 | |
| goose | `~/.config/goose` | 否 | |
| trae | `~/.trae` | 否 | |
| openclaw | `~/.openclaw` | 否 | |
| hermes-agent | `~/.hermes` | 否 | `~/.hermes/skills/openclaw-imports/` 是 hermes 自动导入缓存（`openclaw_residue_cleanup: true` 自管），非 npx skills 管理，勿手动清理 |
| pi | `~/.pi/agent` | 否 | `~/.pi/agent/skills` 不存在 |

## 变更历史

- 2026-08-11：移除 bash/nushell 的 `skills` wrapper；清空全部全局技能（33 个 + lark-* 27 个副本）；本文档建立
- 2026-08-10：`npx skills remove` 曾顺着 opencode symlink 删除仓库源文件（事故）
