# lark-cli 技能环境与维护记录

> 记录时间：2026-07-31（2026-08-05 复核：版本升至 1.0.83，内容仍准确）
> 适用版本：lark-cli 1.0.83、skills CLI（skills.sh）1.5.21
> 主机：Fedora Kinoite，用户 `brightmeows`

## 一、环境概况

| 项 | 路径 / 值 |
|---|---|
| lark-cli 二进制 | `~/.local/bin/lark-cli` → `~/.local/lib/node_modules/@larksuite/cli/`（npm 全局安装） |
| 技能实际目录 | `~/.agents/skills/<技能名>/` |
| pi 技能入口 | `~/.pi/agent/skills/<技能名>/` → `~/.agents/skills/<技能名>/`（符号链接） |
| 安装清单 / 锁 | `~/.agents/.skill-lock.json` |
| lark 技能数量 | 27 个（lark-approval … lark-workflow-standup-report） |

lark-cli 同时维护**两套技能内容来源**：

1. **二进制内嵌**（`lark-cli skills read <技能> <路径>`）：SKILL.md + 全部 `references/*.md`，与 CLI 版本严格对齐。**这是官方指定的文档读取通道。**
2. **文件系统副本**（`~/.agents/skills/`）：供 pi 等通过文件加载技能的 harness 使用；内容多寡取决于安装来源。

## 二、两种安装来源的差异（核心认知）

| 来源 | 命令 | 文件系统内容 |
|---|---|---|
| **well-known**（open.feishu.cn） | lark-cli 自带 / `lark-cli update` 触发 | 仅 SKILL.md + 少量 references，**不含 `scripts/`** |
| **GitHub 仓库**（larksuite/cli） | `npx skills add larksuite/cli -y -g` | 完整文件夹：SKILL.md + 全部 references + **`scripts/`** |

部分 SKILL.md 强制要求运行脚本（如 lark-slides 的 `scripts/xml_text_overlap_lint.py`、lark-doc 的 `scripts/doc_word_stat.py`）。脚本属于“机器资源”，**不内嵌进二进制**，必须落在文件系统才能运行——因此只有 GitHub 源能让这些 MUST 步骤真正可用。

## 三、关键陷阱：`lark-cli update` 会冲掉 GitHub 安装

`lark-cli update` 在升级二进制后，会**强制把 27 个官方技能恢复成 well-known 源**（二进制内字符串：`restored all %d official skills`）。实测结果：

- 文件系统上的 `scripts/`、多出的 references **被清掉**；
- `.skill-lock.json` 里来源从 `github` 退回 `well-known`。

**没有任何环境变量或 flag 能跳过这个技能同步**（`LARKSUITE_CLI_NO_SKILLS_NOTIFIER` 只抑制通知，不同步）。这是官方工具的内在设计，无法绕过。

## 四、标准维护工作流

### 日常升级（必须两步，缺一不可）

```bash
lark-cli update                         # ① 升级二进制；会顺手把技能恢复成 well-known（无 scripts）
npx skills add larksuite/cli -y -g      # ② 从 GitHub 重装完整技能（带回 scripts + 全部 references）
```

> 第 ② 步正是 lark-cli 二进制自己在异常恢复时给出的官方重装指令，可放心使用。
> 注：`skills add` 无法用 `@ref` 锁定 git tag（`@` 被当作技能名过滤器），故文件系统技能取自 main 分支，略 ahead 于二进制版本；这是 README 文档化的官方流程，风险很低。

可选：把两步封装成 shell 函数（属于 shell 配置，不是技能文件改动）：

```bash
lark-update() { lark-cli update && npx -y skills add larksuite/cli -y -g; }
```

### 读取技能文档（官方推荐方式）

```bash
lark-cli skills read <技能名>                       # 读 SKILL.md
lark-cli skills read <技能名> references/<文件>.md   # 读某个 reference
lark-cli skills read <技能名> --json                # JSON 信封
lark-cli skills list                                # 列出已注册技能
```

官方原文要求 agent 用 `lark-cli skills read` 读取（保证与 CLI 版本对齐），**不要直接 grep / 打开本地 SKILL.md**。脚本（`scripts/*.py`、`references/*.xml`）不内嵌，必须用文件系统上的副本运行。

## 五、本次处理记录

1. **升级** lark-cli 1.0.77 → 1.0.80。
2. **原生重装** lark 技能为 GitHub 源（`npx skills add larksuite/cli -y -g`），获得完整文件夹含 scripts。
3. 清理掉早期手动补丁（手动放置的脚本、lark-shared 的手动编辑段）——现已被上游内容覆盖，**当前零手动编辑**。
4. 验证：3 个强制脚本原生就位且可运行；pi 的 27 个 lark 技能链接全部可用（0 断链）。

## 六、已知非致命告警

- `npx skills add larksuite/cli -y -g` 末尾会报 `PromptScript: PromptScript does not support global skill installation`（27 条）。**这是 skills CLI（vercel-labs/skills）的已知 bug（GitHub issue #1352 / #1424 / #1496），非致命**，本机实测（2026-08-05）零影响：
  - **PromptScript 本体**：一个 PromptOps 工具（`@promptscript/cli`，命令 `prs`，getpromptscript.dev），把 AI 指令当受版本管理的代码：`.promptscript/project.prs` 为唯一事实源，`prs compile` 编译成 `CLAUDE.md` /
    `.cursor/rules/` / `copilot-instructions.md` 等各平台配置。
  - **skills CLI 中的适配器定义**：`promptscript` 的 `skillsDir` 是 `.agents/skills`（与通用目录相同）、`globalSkillsDir` 为 undefined（README 标注 `N/A (project-only)`，设计上指令随项目走、不支持全局安装）、`detectInstalled`
    看当前目录有无 `.promptscript/` 或 `promptscript.yaml`。
  - **报错根因**：`getUniversalAgents()` 以 `skillsDir === ".agents/skills"` 过滤，promptscript 恰好命中且漏设 `showInUniversalList: false`，被误纳入 universal 列表；`-g` 安装时其 `globalSkillsDir` 为 undefined →
    报错。即使本机未安装 PromptScript 也照样报（#1496）。
  - **实测结论**：本机无 `.promptscript` / `promptscript.yaml`、未装 `@promptscript/cli`，告警纯属噪音；真实安装目标是 warp/zed/universal 等（`~/.agents/skills/`），27 个 lark 技能全部落盘成功，与 pi 无关（pi 经自有符号链接访问，27/27 正常）。
- lark-apps 的 `.spark/meta.json` 是本地初始化项目时生成的运行时文件，不属静态资源，正确地不在技能分发中。

## 七、本次未处理（留待决定）

- **rust-meta-cognition 的 6 个姊妹技能**（rust-daily、rust-skill-creator、core-actionbook、core-agent-browser、core-dynamic-skills、core-fix-skill-docs）：该技能附录“工具与实验”表引用了它们，但这 6 个未安装。它们都在 codeberg 仓库
  `brightmeows/rust-meta-skills` v0.1.4 内（rust-*在 `skills/`，core-* 在 `skills/.system/`），属可选配套。如需安装：

  ```bash
  npx skills add brightmeows/rust-meta-skills -y -g   # 语法以 skills --help 为准
  ```

  不装也不影响 rust-meta-cognition 本身工作。
