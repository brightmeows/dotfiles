# agents_meow 与 workflow-skills 的边界与校验

本文记录 dotfiles 的 `dot_agents_meow/` 与独立仓 `workflow-skills` 的职责边界、事实源收口与技能清单校验方案。
2026-10-28 按本文落地；实施细节以仓库当前状态为准。

2026-10-29 回退：提交、内容治理、取数纪律三条搬回 `dot_agents_meow/AGENTS.md`，对应三个技能从 workflow-skills 删除，理由并入 `AGENTS.ref.md`，技能清单缩到五项。本文按新边界改写，10-28 的文件级改动保留在文末作为历史。

## 背景

`dot_agents_meow/` 是 chezmoi 的源目录，部署到 `~/.agents_meow/`，承载人设、工程准则、维护参考、模型管线与脚本。
`workflow-skills` 是独立公开仓，按 npx 安装到 `~/.agents/skills`，承载工作流技能（当前四项）。

两个仓通过 `dot_agents_meow/AGENTS.md` 的“工作流技能”节耦合。提交、内容治理、取数纪律三条规则正文已在 2026-10-29 搬回主文件，
跨仓同步只剩技能清单与锁文件。

## 现状与证据

### 耦合点

| 耦合点 | 证据 | 风险 |
|---|---|---|
| 技能指针无校验 | `AGENTS.md` 点名五项技能；改造前 `pnpm check` 只跑 Pi 版本与 `tsc`，没有技能检查 | 缺装、改名、换源不会在提交时暴露，指针静默悬空 |
| 规则正文与清单分居两仓 | 规则正文在 dotfiles，技能清单在 workflow-skills | 只有技能增删需要跨仓；规则改动不再跨仓 |
| 两条分发链 | dotfiles 走 `chezmoi apply`；技能走 `npx skills add`，本地改动要先 push 再装 | dotfiles 侧没有版本锚点；换机器要手动重装 |
| 两套检查 | dotfiles pre-commit 管格式、lint、中文引号与模型生成物；workflow-skills pre-commit 管 markdownlint、digest 与技能清单 | 提交纪律在两边的 `AGENTS.md` 各写一遍，存在措辞漂移 |
| 旧锁文件 | `~/skills-lock.json` 是 version 1 旧格式，9 条记录里只覆盖 2 个 workflow 技能 | 文档里的 lock 路径与实际不一致，容易读错账本 |

### npx lock 与 hash 的事实

- npx skills CLI 1.7.x 的 `getSkillLockPath()`：设了 `XDG_STATE_HOME` 时用 `$XDG_STATE_HOME/skills/.skill-lock.json`，
  否则回退到 `~/.agents/.skill-lock.json`。本机是前者，即 `~/.local/state/skills/.skill-lock.json`。
- canonical lock 的格式版本是 3，记录 `source`、`skillPath` 与 `skillFolderHash`。`skillFolderHash` 是上游 git tree hash，
  不是安装内容的摘要，不能直接拿来比对本地文件。
- 家目录 `~/skills-lock.json` 是 2026-10-06 的 version 1 旧格式副本，9 条记录里只有 `grilling` 与 `writing-for-agents`
  两个 workflow 技能；它不是 canonical lock。
- workflow-skills 的 `.well-known/agent-skills/index.json` 存的是 `SKILL.md` 的 sha256。审计时五个安装态文件的摘要全部匹配。
- npx 的 `computeSkillFolderHash()` 算法：递归收集文件，按相对路径 `localeCompare` 排序，对“路径 + 内容”依次做 sha256。
  `skills.lock.json` 用同一算法，覆盖技能目录内的全部文件，将来加 `references/` 也能校验到。

## 约束

- 双仓：`workflow-skills` 保持独立公开，继续走 npx、`.well-known` 与 Codeberg 镜像。
- 依赖单向：dotfiles 依赖 workflow-skills；公开仓不反向依赖 dotfiles 的本机路径或私有仓。
- 校验分层：仓库侧校验必须 CI 安全，不能要求本机装好技能；机器侧校验不能挡新机器引导。
- 名单单一：`AGENTS.md` 的“工作流技能”节是唯一技能名单；锁文件只存 hash 与来源，不另立名单。

## 候选方案

| 方案 | 收益 | 代价 | 结论 |
|---|---|---|---|
| 保留双仓，补接口 | 跨仓改动只剩事实源一处；不新增第二份名单；公开分发不变 | 需要维护校验脚本与锁文件 | 采用 |
| 继续瘦身 `AGENTS.md` | 常驻行数更少 | 技能激活率低于常驻指令，遵循度换行数不划算 | 不采用 |
| 把 workflow-skills 收进 dotfiles | 单仓改动最顺 | 与 npx canonical、lock、公开分发和 `.well-known` 打架；回退 2026-10-06 的裁决 | 不采用 |
| 两仓合并 | 凝聚力最高 | 迁移与公开历史成本最高 | 不采用 |
| 只整理 `dot_agents_meow` 内部布局 | 目录卫生改善 | 不解决跨仓事实源与指针校验 | 暂不单独做 |

## 推荐方案

### 事实源收口

- 规则正文留在 dotfiles 的主文件；决策理由、证据与否决记录留在 `AGENTS.ref.md`。
- workflow-skills 只承载技能正文、分发索引与技能清单；提交、内容治理、取数纪律三节已从技能域移出。
- “工作流技能”节留在 ref，因为它记录的是 dotfiles 侧的激活机制、依赖校验与 npx 分发事实，不属于任何单个技能。

### 指针与校验

- `AGENTS.md` 的技能清单改成五条列表，格式为 `- \`name\`：用途`；脚本只解析“### 工作流技能”节。
- `dot_agents_meow/skills.lock.json` 记 `version`、`source` 与每个技能的目录 hash。锁的键集必须与 `AGENTS.md` 名单一致。
- `dot_agents_meow/scripts/check-skills.mjs` 提供四种模式：
  - `--decl-only`：解析名单、对照锁文件，不读本机状态；进 `pnpm check`，CI 可跑。
  - `--warn`：声明校验加本机安装校验，缺装、换源、hash 不符只告警；进 pre-commit。
  - `--strict`：声明校验加本机安装校验，缺装、换源、hash 不符都失败；作为 `pnpm check:skills` 手动闸门。
  - `--write-lock`：从 workflow-skills 检出重新生成锁文件；作为 `pnpm gen:skills-lock`。
- 机器侧校验读 `$XDG_STATE_HOME/skills/.skill-lock.json`（无 `XDG_STATE_HOME` 时读 `~/.agents/.skill-lock.json`），
  核对 `source` 与 `skillPath`；不读 `~/skills-lock.json`。
- hash 不符在 `--strict` 下硬失败。本地故意改技能时，先更新锁，或临时用 `--warn`。

### 同步协议

| 变更 | 先改 | 再改 | 验证 |
|---|---|---|---|
| 技能规则正文 | workflow-skills 的 `SKILL.md` 与 `docs/<skill>-rationale.md` | 更新 `.well-known` digest，push，npx 重装 | `pnpm gen:skills-lock` 后 `pnpm check:skills` |
| 技能增删改名 | workflow-skills 的技能目录、`index.json`、`marketplace.json`、`README.md`、`AGENTS.md` 表 | push，npx 重装；dotfiles 的 `AGENTS.md` 名单与锁文件 | `pnpm check:skills` |
| dotfiles 专属规则（含提交、内容治理、取数纪律） | `AGENTS.md` 或 `AGENTS.ref.md` | 无 | `pnpm check` 与 pre-commit |
| npx 升级改 lock 布局 | 复核 CLI 的 `getSkillLockPath()` 与版本号 | 更新 `check-skills.mjs` 的路径与版本常量，更新 npx 文档 | `pnpm check:skills` |

## 文件级改动清单（2026-10-28 历史）

### dotfiles

| 文件 | 改动 |
|---|---|
| `dot_agents_meow/AGENTS.md` | 技能段落改成八条列表，去掉“这八个”这种会随增删漂移的计数（2026-10-29 已缩到五条） |
| `dot_agents_meow/AGENTS.ref.md` | 索引表三条迁出规则改指针并去掉日期；三节正文改指针；补依赖方向、校验分层、npx lock 路径 |
| `dot_agents_meow/skills.lock.json` | 新增，记八个技能的目录 hash 与来源（2026-10-29 改为五项） |
| `dot_agents_meow/scripts/check-skills.mjs` | 新增，四模式校验与锁生成 |
| `dot_agents_meow/scripts/check-skills.test.mjs` | 新增，覆盖解析、重复、空清单、锁键集与 hash 稳定性 |
| `package.json` | 新增 `check:skills` 与 `gen:skills-lock`；`check` 加 `--decl-only`；`test` 加脚本目录 |
| `.githooks/pre-commit` | 新增 `--warn` 校验 |
| `docs/ai/agents-meow-workflow-skills-boundary.md` | 新增，本文 |
| `AGENTS.md` | 在 `docs/ai/` 表登记本文 |
| `docs/skills/npx-skills-usage.md` | 更正 canonical lock 路径；注明 `~/skills-lock.json` 是历史备份 |
| `/home/brightmeows/AGENTS.md` | 旧锁文件的说明改为历史备份（仓库外，手工维护） |

### workflow-skills

| 文件 | 改动 |
|---|---|
| `docs/commit-discipline-rationale.md` | 新增，承接 dotfiles 提交节的决策理由、证据与否决记录 |
| `docs/doc-governance-rationale.md` | 新增，承接内容治理的理由与证据 |
| `docs/retrieval-discipline-rationale.md` | 新增，承接取数纪律的语气备案、事实基础与粒度裁决 |
| `skills/commit-discipline/SKILL.md` | 末尾加一行维护理由指针 |
| `skills/doc-governance/SKILL.md` | 末尾加一行维护理由指针 |
| `skills/retrieval-discipline/SKILL.md` | 末尾加一行维护理由指针 |
| `AGENTS.md` | 增加 `docs/<skill>-rationale.md` 的编写约定（2026-10-29 三个技能删除后条款失效） |
| `.well-known/agent-skills/index.json` | 更新三个技能的 digest（2026-10-29 三项已移除） |

## 验证

workflow-skills 侧：

- `pre-commit run --all-files` 全部通过，含 markdownlint、digest、技能清单、marketplace 与 SKILL.md 格式。
- 推送后 `npx -y skills add brightmeows/workflow-skills -g -y -s '*' -a codebuddy -a codex -a opencode -a pi` 重装五个技能。
- `npx skills ls -g` 显示五个技能的来源仍是 `brightmeows/workflow-skills`。

dotfiles 侧：

- `pnpm check`：Pi 版本、声明与锁一致、`tsc` 通过。
- `pnpm test`：66 个测试通过，含新增的 5 个技能校验测试。
- `pnpm lint`、`pnpm format:check`、`.githooks/pre-commit` 通过。
- `pnpm check:skills`：五个技能，0 错误、0 警告。
- `chezmoi diff` 只包含预期文件；`chezmoi apply` 后 `~/.agents_meow/AGENTS.md`、`skills.lock.json` 与脚本同步。

未覆盖的验证：

- 没有在真实安装上模拟“缺装一个技能”与“改一个技能正文但不更新锁”。`--warn` 的缺装路径用临时 `HOME` 验证；
  hash 不符路径用临时锁文件验证（`--warn` 退出 0，`--strict` 退出 1）；真实安装上的缺装与旧版场景留到换机器时实测。

## 回滚

- workflow-skills：revert 对应提交并 push，再按旧提交重装技能；理由文档是新增文件，回滚不丢原内容。
- dotfiles：revert 对应提交；`skills.lock.json` 是生成物，回滚后重跑 `pnpm gen:skills-lock` 即可恢复。
- 校验挡住正常提交时：先跑 `pnpm gen:skills-lock` 更新锁；只是本地实验时用 `--warn`，不要用 `--no-verify` 绕过。

## 未决与后续

- `~/skills-lock.json` 保留原位作历史备份，不参与校验；是否删除留到下次家目录清理时再定。
- `docs/` 不随技能分发；`SKILL.md` 末尾的维护理由指针只对仓库读者有效。
- 技能若新增 `references/` 文件，目录 hash 已覆盖，不需要改校验算法。
- 若将来引入其他来源的技能，锁文件需要按技能记录来源；当前五个技能同源，先用全局 `source`。
- 校验只证明本机安装与锁一致，不证明上游仍可安装；npx 重装是同步点。
- 目录 hash 的排序用 `localeCompare`，非 ASCII 文件名在极端 locale 下可能不稳定；当前技能文件都是 ASCII。

## 实施顺序

1. workflow-skills：删三个技能目录、表项、索引与 rationale；pre-commit；提交。
2. dotfiles：主文件补回三节；ref 并入理由；清单与锁缩到五项；SOUL 加英文名；pre-commit。
3. 收尾：`npx skills remove` 清三个已部署副本；`pnpm check`、`pnpm test`、`pnpm check:skills`、pre-commit、`chezmoi diff` 与 `apply`。
