# ask_user_question 的 vendor 化与题数上限移除

## 背景

Pi 的 `ask_user_question` 组件原为第三方包 `@juicesharp/rpiv-ask-user-question`（经 settings.json packages 安装）。其单次调用 4 题上限硬编码于 `tool/types.ts`（`MAX_QUESTIONS = 4`），无法通过配置解除。

2026-10-03 曾决策走上游 PR 路线（[PR #289](https://github.com/juicesharp/rpiv-mono/pull/289)，参数化四个上限常量），约定“长期无响应即重开路线讨论”。PR 挂三周无审阅动作，触发条件成立。

## 决策（2026-10-24）

放弃上游路线，整包 vendor 进本仓库维护：

- **基线**：`@juicesharp/rpiv-ask-user-question@2.15.0`（npm tarball，源码即 .ts；上游 tests 不带）
- **位置**：`dot_pi/agent/ext/ask-user-question/`，包名 `pi-meow-ask-user-question`，入口 `index.ts`
- **同步策略**：彻底冻结，视为完全自有代码，不再跟踪上游（上游一周发 5 版，例行跟进不现实）
- **PR #289**：已关闭，附言说明转为本地 vendor
- **题数上限**：完全移除——`MAX_QUESTIONS` 常量、schema `maxItems` 与“1-4 questions”文案、运行时 `too_many_questions` 校验与错误码、“up to N questions”提示词文案全部删除，`minItems: 1` 保留。options 2-4、header 16、label 60 三个限制原样
- **依赖**：`@juicesharp/rpiv-config`（322 行）内联为包内 `internal/rpiv-config.ts`，裁剪到本包用到的配置加载 + guidance 校验面；`@juicesharp/rpiv-i18n` 保持 optional peer，运行时动态 import（变量 specifier，tsc 不解析），缺失时英文 fallback
- **合规**：MIT，上游 LICENSE 原样保留；`index.ts` 文件头注明来源、基线版本与本地改动清单

## 本地适配（vs 上游 2.15.0）

- 仓库 tsconfig 严格项适配：parameter properties 改显式字段（`erasableSyntaxOnly`）、index signature 访问改括号
  （`noPropertyAccessFromIndexSignature`）、索引访问加守卫（`noUncheckedIndexedAccess`）、exactOptionalPropertyTypes
  下可选属性定义加 `| undefined`（改类型定义侧，赋值侧语义不变）
- oxlint：上游代码风格与本仓规则冲突面大（550+ 处，curly/注释大写/array-type 等），在 `.oxlintrc.json` 对本包目录级豁免全部冲突风格规则；complexity 按先例棘轮放宽到 50（实测最高 24）
- 2.14.0 起上游将工具注册为 `model-only`：codemode 脚本内不可调用，模型直接调用不受影响

## 部署与清理

- 配置文件 `~/.config/rpiv-ask-user-question/config.json` 与 chezmoi 托管 `dot_config/rpiv-ask-user-question/` 已删除（原 `maxQuestions: 8` 随上限移除失去意义）；包内 config 加载逻辑保留（collapseKey 等仍可用，无配置文件走默认）
- settings.json 的 packages 为并集语义：npm 条目删除不自动传导，须手动从 `~/.pi/agent/settings.json` 移除 `npm:@juicesharp/rpiv-ask-user-question`，并清理 `~/.pi/agent/npm/node_modules/@juicesharp/` 安装残留
