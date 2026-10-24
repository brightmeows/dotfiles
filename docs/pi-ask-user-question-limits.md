# ask_user_question 的 vendor 化与题数上限移除

## 背景

Pi 的 `ask_user_question` 组件原为第三方包 `@juicesharp/rpiv-ask-user-question`（经 settings.json packages 安装）。其单次调用 4 题上限硬编码于 `tool/types.ts`（`MAX_QUESTIONS = 4`），无法通过配置解除。

2026-10-03 曾决策走上游 PR 路线（[PR #289](https://github.com/juicesharp/rpiv-mono/pull/289)，参数化四个上限常量），约定“长期无响应即重开路线讨论”。PR 挂三周无审阅动作，触发条件成立。

## 决策（2026-10-24）

放弃上游路线，整包 vendor 进本仓库维护：

- **基线**：`@juicesharp/rpiv-ask-user-question@2.15.0`（npm tarball，源码即 .ts；上游 tests 不带）
- **位置**：`dot_pi/agent/ext/ask-user-question/`，包名 `pi-meow-ask-user-question`，入口 `index.ts`
- **同步策略**：以 2.15.0 为基线冻结，不整体跟上游；允许按需吸收单个补丁并在本文件记录。已吸收 #309（参数硬限制进提示词）；#241（Ctrl+C 语义）与 #194（RPC fallback 草稿状态机）不跟。
- **题数上限**：完全移除——`MAX_QUESTIONS` 常量、schema `maxItems` 与“1-4 questions”文案、运行时 `too_many_questions` 校验与错误码、“up to N questions”提示词文案全部删除，`minItems: 1` 保留。options 2-4、header 16、label 60 三个限制原样
- **依赖**：`@juicesharp/rpiv-config`（322 行）内联为包内 `internal/rpiv-config.ts`，裁剪到本包用到的配置加载 + guidance 校验面；`@juicesharp/rpiv-i18n` 保持 optional peer，运行时动态 import（变量 specifier，tsc 不解析），缺失时英文 fallback
- **peer 元数据**：按 Pi 1.4 约定恢复 `peerDependencies`（`pi-coding-agent`、`pi-tui`、`typebox`、可选 `rpiv-i18n`，范围均 `"*"`），包标 `private`，避免误发布

## 依赖对齐与漂移门禁

仓库用根 `node_modules` 做类型检查，Pi 运行时是全局安装，锁文件管不到全局升级。两者曾实际漂移：devDeps 1.2.0 对运行时 1.4.0，`typebox` 根上 1.3.34 而 Pi 固定 1.3.27。

现在的约束：

- 根 `package.json` 的 `@earendil-works/pi-ai`、`pi-coding-agent`、`pi-tui` 精确写 `1.4.0`，`typebox` 精确写 `1.3.27`；锁文件里 `typebox` 只有一份
- `scripts/check-pi-version.mjs` 校验四件事：specifier 必须精确；安装的 pi 三包版本等于 `pi --version`；`typebox` 等于安装的 `pi-coding-agent` 声明的 pin；找不到 `pi` 时跳过运行时检查
- `.githooks/pre-commit` 无条件执行 `pnpm check:pi`，不一致直接阻断提交；`pnpm check` 也先查漂移再跑 tsc
- 不引入 pnpm workspace/catalog：12 个扩展包当前零依赖，单一根安装已经消除包间漂移；出现第二个声明依赖的包时再考虑
- 不用 `pnpm.overrides` 强压 Pi 的依赖：Pi 对 `typebox` 是精确 pin，覆盖会制造第二套运行时

## 本地适配（vs 上游 2.15.0）

- 仓库 tsconfig 严格项适配：parameter properties 改显式字段、index signature 访问改括号、索引访问加守卫、可选属性补 `| undefined`（`erasableSyntaxOnly` 等，改类型定义侧，赋值侧语义不变）
- oxlint：上游代码风格与本仓规则冲突面大（550+ 处，curly/注释大写/array-type 等），在 `.oxlintrc.json` 对本包目录级豁免全部冲突风格规则；complexity 从 50 收紧到 25（实测最高 24，`tool/external-answer.ts` 的 `resolveEntry`）
- oxfmt：整包排版已统一为 2 空格，与上游 tab 排版不同；语义差异以 `index.ts` 头注释与本文件为准
- 多题 tab 条：`view/components/tab-bar.ts` 在题数溢出时以活动项为中心开窗、两端省略号，Submit 固定右侧；窗口过窄时降级为 `□ i/N`
- reconcile：`reconcile.ts` 只保留无 UI 时的剥离分支，交互态不再强制加回工具，尊重 `--tools` / `-xt` 与工具集管理扩展（上游 #149）；依赖 Pi 1.4 的注册激活与 resume 恢复
- 提示词：吸收 #309，把 header 16 / label 60 硬限制写进 guidance 与 tool description，去掉原补丁中的 `MAX_QUESTIONS` 措辞
- 测试：`node:test` 覆盖校验（含 12 题通过）、参数归一化、答案封装、tab 条溢出与 reconcile；根 `pnpm test` 同时跑模型域与扩展目录
- 2.14.0 起上游将工具注册为 `model-only`：codemode 脚本内不可调用，模型直接调用不受影响

## 部署与清理

- 配置文件 `~/.config/rpiv-ask-user-question/config.json` 与 chezmoi 托管 `dot_config/rpiv-ask-user-question/` 已删除（原 `maxQuestions: 8` 随上限移除失去意义）；包内 config 加载逻辑保留（collapseKey 等仍可用，无配置文件走默认）
- settings.json 的 packages 为并集语义：npm 条目删除不自动传导，已手动从 `~/.pi/agent/settings.json` 移除 `npm:@juicesharp/rpiv-ask-user-question`，并清理 `~/.pi/agent/npm/node_modules/@juicesharp/` 安装残留
- 部署副本 `~/.pi/agent/ext/ask-user-question/` 与源目录保持一致；修改源文件后仍需 `chezmoi apply`
