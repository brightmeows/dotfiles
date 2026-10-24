---
description: Pi 扩展维护约定与运行时验证方法
tags: [pi, extensions, typescript]
---

# Pi 扩展（面向代理）

本目录的 `*.ts` 为 Pi 扩展（ExtensionAPI）。约定优先级：本文件 > 各文件头部注释（即设计文档，修改前完整读取）> 仓库根 [AGENTS.md](../../../AGENTS.md)（chezmoi、`pnpm check`、提交规范）> 官方文档 `extensions.md`（npm 全局安装在 `node_modules/pi/packages/coding-agent/docs/`，路径随安装方式而变）。

## 目录结构（现状）

本目录为独立扩展包集合，每个子目录是一个 Pi 包（`package.json` 声明 `pi.extensions`），通过 `settings.json` 的 `packages` 数组显式注册，不再依赖 Pi 自动发现。

组织原则：**各包完全自包含**——包间零 import、无共享目录，需复用的模块各包自备副本、无同步义务；目录名 = 扩展语义名，包名前缀 `pi-meow-`；
`skill-reminders/` 为独立的技能专项提醒注入包（自 better-skill 拆出）。历史域分组与 lib/ 均已拆解（跨包共享库）。
包内纯库归包内 `internal/` 子目录（不跨包，与 lib/ 拆解性质不同）：subdir-agents-md 采用此结构。
（better-skill 技能域合集包已移除，技能加载回归 Pi 内置机制）

| 路径 | 包名 | 角色 | 要点 |
|------|------|------|------|
| `aliases/` | `pi-meow-aliases` | 斜杠命令别名 | /clear → /new、/exit → /quit |
| `ask-user-question/` | `pi-meow-ask-user-question` | 结构化问卷工具（vendor） | 自 @juicesharp/rpiv-ask-user-question@2.15.0 vendored、冻结不跟上游，见 [docs/pi-ask-user-question-limits.md](../../../docs/pi-ask-user-question-limits.md)；题数上限已移除（常量/schema/校验/提示词四处全删）；rpiv-config 内联 internal/、i18n 为 optional peer 运行时软加载；包名与入口保持本仓惯例；上游排版已由 oxfmt 统一为 2 空格，语义差异见 `index.ts` 头注释——oxlint 冲突规则包级豁免见 `.oxlintrc.json` overrides |
| `esc-hold/` | `pi-meow-esc-hold` | Esc 防误触 | 单击提示不中断，双击/长按才中断；terminal 输入层；以 `ctx.isIdle()` 分场景：生成中守卫、空闲全放行 |
| `git-hooks/` | `pi-meow-git-hooks` | git hooks 自动配置 | session_start 检测 cwd 所属仓库一次：`.githooks/` 含可执行脚本则补设 `core.hooksPath=.githooks`（githooks 优先；已设 `.githooks` 静默、指向别处不动仅提示）；`.pre-commit-config.yaml` + 系统有 pre-commit 命令则 hook 缺失时跑 `pre-commit install`（已装看 hook 头部标记，外来 hook 交工具 migration mode，工具缺失静默）；互斥锚定：hooksPath 已设时 pre-commit install 上游拒绝执行（实测 4.6.2），githooks 命中即分流；提示 setWidget（激活 8s 清、失败不自动清，models-dev 同款理由），已就绪零输出，非 tui 打 stderr；hooks 目录用 `--git-path hooks` 解析（兼容 worktree）；中途 cd 不检测，Windows 执行位退化可接受 |
| `editor-input-tweaks/` | `pi-meow-editor-input-tweaks` | 编辑器输入增强 | /@ 标记符着色 + / 补全停留；独占编辑器槽位（`ctx.ui.setEditorComponent` 全局单例，后设覆盖先设，新增编辑器类扩展须链式包装或并入本包） |
| `inline-context/` | `pi-meow-inline-context` | 环境摘要注入 | 日期/系统环境（含 WSL/SSH/提权/代理 TUN 信号，只陈述事实）/Git 状态/工具与 gh，写入结构化 `sections.inline_context`；Git 快照：remote（URL 剥 userinfo 凭据）/dirty/ahead-behind/stash/进行中操作/最近提交，session_start 快照零缓存损伤、resume 自动重算、行尾标注过期语义；首条摘要消息走默认渲染 |
| `subdir-agents-md/` | `pi-meow-subdir-agents-md` | 子目录规则懒加载 | 触发在 `tool_result` 收集、投递在 `turn_end` 边界条目（短通知 display: true + 全文 display: false，`details.subdirAgents` 标记持久去重；设计原因：codemode 嵌套下脚本可能丢弃拼接内容，条目通道保证送达）；结构化 `input.path` + bash 白名单启发式双通道；已注入规则文件被 read 时追加提示；含包内 `internal/path-extract.ts` |
| `thinking-flow/` | `pi-meow-thinking-flow` | thinking 呈现接管 | 接管 `AssistantMessageComponent.updateContent`：flow 态（默认）进行中 thinking 完整渲染、历史收起分层色占位“> Thinking · N 字符 · N Tokens · 点击展开”（N Tokens 为估算，展开态上下双标题行同构 > 前缀、提示点击收起，流式进行中的块同样双行；鼠标单块展开）；expanded 态（`hideThinkingBlock=true`，语义反转内置“隐藏”开关）全量展示；ctrl+t 两态切换（内置传导链白得）；私有成员形状守卫回退原生渲染；reload 幂等（原生方法 globalThis 槽）；含包内 `internal/`（thinking-flow / markdown-transform；left-bar 色带已随符号移除删除）；pi 升级须 tmux 实测 |
| `statusline/` | `pi-meow-statusline` | 状态栏 footer + 下边框速度（2026-10 起自定义布局，与内置分道） | 行1 pwd（左 目录+分支+会话名，右 (提供商) 模型·档位）、行2 stats（左 tokens/缓存/费用含 (sub)，右 上下文分档色%/窗口含 (auto)）、行3 扩展状态行（承接 `ctx.ui.setStatus`）；下边框流式速度：monkey-patch `CustomEditor.renderBottomBorder` 嵌入“平均 N · 1s N tok/s”（当前回合口径，流式中 delta 估算、结束时精确 usage 校准保留，空闲隐 1s 段；滚动提示优先；装卸随 /statusline 开关，reload 幂等 globalThis 槽）；两行宽度降级：行1右 provider 括号先丢→右截→只左段；省略 routed 路由与 (sub) 订阅半边（扩展侧不可达，经确认接受）；默认启用，`/statusline` 切换持久化；踩坑（session_start 时机、56 token、bind this、patch 报错回退）见文件头；含包内 `internal/`（footer-lines / stream-speed） |
| `working-status/` | `pi-meow-working-status` | Working 行多状态计时文案 | 事件驱动切 `setWorkingMessage`：agent_start→等待模型响应、bpr→发送请求 N KB（provider 重试附 `· 重试N`；计数挂 message_end stopReason=error、清零挂 before_agent_start——重试是 agent_end→agent_start 的新 run）、assistant message_start→生成中、tool_execution_start→执行工具 X（嵌套回退父名）；切换重锚定 interval 保整秒节奏；agent_end 复位默认；ui_prompt 确认态实测放弃（阻塞对话框整块替换指示行区域） |
| `models-dev/` | `pi-meow-models-dev` | 模型目录导入 | models.dev 注册表导入，协议感知 + 用户配置，async factory，入口 await；注册按内建重名分流（非重名走原生 createProvider + fetchModels/ModelsStore，重名保留 legacy 合成，即 M2-hybrid 分流）；重名 provider 映射时按 id\|api 合并内建 compat 与档位表（内建优先，见下文）；纯库模块（registry / config / mapping / thinking / custom-models / native）归 `internal/` 子目录；配置 schema 见下文 |
| `skill-reminders/` | `pi-meow-skill-reminders` | 技能专项提醒注入 | 三通道命中：read/edit/write 通道 `input.path`（tool_result 段尾注入 + details 载标记）、bash/powershell 通道白名单启发式（tool_result 只收集、turn_end 投单条 display:true 条目——codemode 嵌套下拼接会丢，条目保住投递与标记的原子性）、`/skill:<name>` 手动命令（input 事件 transform，先于 Pi 技能展开）；持久去重 subdir-agents-md 同款（details 标记 + 扫库，hash 为权威键同提醒跨文件一次，compact 后可重注）；存在性守卫 requiresPath（技能未安装整条静默跳过，`internal/skill-presence.ts`）；注册表（数据驱动）归 `internal/reminders.ts`，新增提醒只加注册项；bash 提取归 `internal/bash-paths.ts`（自 subdir-agents-md 副本，白名单加纯读取命令）；自 better-skill 拆出 |

注册方式（`settings.meow.json`）：

```json
"packages": [
  "npm:pi-lsp-extension",
  "npm:pi-web-access",
  "./ext/aliases",
  "./ext/ask-user-question",
  "./ext/editor-input-tweaks",
  "./ext/esc-hold",
  "./ext/git-hooks",
  "./ext/inline-context",
  "./ext/models-dev",
  "./ext/skill-reminders",
  "./ext/statusline",
  "./ext/subdir-agents-md",
  "./ext/thinking-flow",
  "./ext/working-status"
]
```

权威源是 `settings.meow.json`（npm 包与本地包分组，组内按字母序，npm 组在前）；上方代码块仅为快照，改包后同步。

扩展文件必须 `export default function (pi)`，仅命名导出会加载报错。子目录内其他 `.ts` 仅作 import 模块。

## models-dev 用户配置（~/.pi/agent/models-dev.json）

models.dev 导入的用户配置，源文件 `dot_pi/agent/models-dev.json` 由 chezmoi 直接部署（独占文件无合并），扩展启动时读取一次，reload/重启生效。JSON 无注释，schema 以本节为准（typebox 严格校验，多余属性/未知协议值直接校验失败）。配置不存在或校验失败时按无配置运行（全量注册），不崩溃。

```json
{
  "providers": {
    "<provider-id>": {
      "disabled": false,
      "api": "openai-responses",
      "baseUrl": "https://gw.example.com/v1",
      "models": {
        "<model-id>": {
          "disabled": false,
          "api": "openai-completions",
          "baseUrl": "https://gw.example.com/v1",
          "name": "显示名"
        }
      }
    }
  }
}
```

- 全部字段可选；`api` 合法值：anthropic-messages / openai-completions / openai-responses / google-generative-ai / google-vertex / bedrock-converse-stream
- `disabled: true` 过滤（provider 整体不注册 / 模型不进列表）；默认全注册（黑名单语义）
- 覆盖优先级：模型级 > provider 级 > models.dev 自动判定（npm 映射 → shape → 官方默认）
- provider 级 `api`+`baseUrl` 双写可救活被协议判定跳过的 provider（未知 npm 等），用户承担协议正确性；单写其一仅覆盖已注册者属性
- 引用未知 provider/模型 id 时忽略；配置语法/校验失败时警告并按无配置运行
- 配了 `api` 的 provider 视为显式表态：env 守卫缺失不阻止其注册

## 注册分流（M2-hybrid）

pi 1.0 的原生注册是顶层替换（`composeProvider` 取 `nativeExtensionProviders ?? builtins`），
注册原生 provider 会顶掉同名内建（含 OAuth 登录与目录合成），故按 `getBuiltinProviders()`
分流：

- 与内建重名的 id：保留 legacy `registerProvider`（与内建 base 合成、保留内建 auth/登录；
  本机如 deepseek / openrouter / github-copilot / opencode / opencode-go / zai）
- 非重名 id：原生 `createProvider`（envApiKeyAuth 认证、`getApiProvider` 复用内建 API
  适配器、`fetchModels` 接入 pi 刷新生命周期）；映射结果由平台 ModelsStore
  （`~/.pi/agent/models-store.json`）持久化与离线恢复
- registry 的 `fetchForRefresh` 做 TTL 门控与并发合流；`isOffline` 让工厂期在
  `--offline` / `PI_OFFLINE` 下不发起网络
- 仓库根 devDependency `@earendil-works/pi-ai` 仅服务 tsc；运行时由 pi 虚拟模块提供
  （`getApiProvider` 走 `/compat` 超集，与 coding-agent 同款用法）
- 新增 internal 纯工厂模块 `native.ts`（不读环境、不注册；编排归 index.ts）

## compat 合并

与内建重名的 provider（legacy 路径）在模型映射时按 `id|api` 合并 pi-ai 内建模型的
compat 与档位映射：内建显式键优先（官方针对端点调校），扩展只补缺；档位表保留内建
的 null（显式“不支持”）。背景：pi compose 语义下扩展 `models` 会整体替换内建模型
定义，修复前只剩 `supportsReasoningEffort`，会丢 thinkingFormat、strict 工具、
zaiToolStream、reasoning_content 回传要求等（如 opencode-go/deepseek 退化为通用
OpenAI 格式，与内建设计的 deepseek 格式不符）。索引由 `getBuiltinModels()` 构建，
只在重名 provider 上；非重名 provider（zhipuai-coding-plan 等）行为不变。

签名：`mapModel(raw, resolved, MapModelOptions)`，`MapModelOptions` 含
provider/model/builtinIndex；`mapProviderModels` 用同名参数对象。验证方法：用
本目录“运行时验证”节的 `pi -p -e` 方式跑 dump 扩展，对比合并前后的运行时模型表
（关键点：opencode-go/deepseek 恢复 `thinkingFormat: "deepseek"`，zai 恢复
`zaiToolStream`，github-copilot 的 `supportsReasoningEffort` 冲突取内建 false）。

## 与 models.json 的关系（优先级：models.json > models-dev 扩展 > pi 内置目录）

pi 原生自定义模型文件 `~/.pi/agent/models.json`（chezmoi 源 `dot_pi/agent/models.json`）中显式声明的 provider 进入保护名单，本扩展注册时跳过（修复 registerProvider 带 models 整体替换导致的自定义失效）。扩展启动时读一次名单，reload/重启生效。

`models.json` 的 `modelOverrides` 自 pi 1.4 起也作用于扩展注册的 provider（上游 c6251a8）：覆盖 models-dev 注册的模型无需声明整个 provider 触发保护名单，直接写 `modelOverrides` 即可。

## 新增与归组

- 一包一扩展：新扩展建新包目录（目录名 = 扩展语义名），包名 `pi-meow-<目录名>`，扩展文件改名 `index.ts` 直接作为入口；并在 `settings.meow.json` 注册
- 技能域：better-skill 合集包（技能索引重写 / skill 工具 / read 兜底增强）已移除，技能加载回归 Pi 内置机制（Pi 默认建议式索引 + read 加载，`/skill:name` 手动命令保留）；专项提醒注入归 `skill-reminders/` 独立包
- 编辑器槽位例外：替换主编辑器的扩展（`ctx.ui.setEditorComponent` 全局单例）不可与 `editor-input-tweaks` 并存，新编辑器功能并入其 `SlashAtHighlightEditor` 或链式包装
- npm 扩展：`rpiv-todo` 已移除、不再引入（主人确认）；任务跟踪不用固定工具。`rpiv-ask-user-question` 已 vendor 成本地包（见 ask-user-question/ 行），不再走 npm 安装
- 各包完全自包含：包间零 import、无 lib 类共享目录；包内模块用 `./xxx.ts` 写法（tsconfig 已开 `allowImportingTsExtensions`）；需复用的模块在各包自备副本，副本间无同步义务
- 新增包须在 `settings.meow.json` 的 `packages` 数组注册路径
- 新增/移动扩展须实测加载：`pnpm check` 不查 default factory 契约，须 `pi -p -e <入口> --no-session` 验证（组目录传 `xxx/index.ts`）
- 各文件头部注释即设计文档：改动前完整读取，改动后同步更新（含包内模块）
- oxlint 复杂度规则放宽清单含 subdir-agents-md（index.ts、internal/path-extract.ts）、models-dev（index.ts、internal/mapping.ts）、inline-context（index.ts）、skill-reminders（internal/bash-paths.ts，自 subdir-agents-md 副本同源同待遇）——
  全局严阈值 complexity 15 / depth 4 / 函数 100 行，本域放宽 50/5/165（存量热点棘轮，不许比现状更糟）；
  触碰重构后从 `.oxlintrc.json` overrides 收紧删除

## 通知约定（LLM 注入且用户需知情）

LLM 注入且用户需知情的操作，通知通道约定如下（不用各包
`inject-notice.ts` 渲染器覆写，回落 Pi 默认渲染）：

- 知情面：投递短 custom_message（`display: true`，content 即单行提示，统一格式
  `[自动注入] <来源>：<说明>`），Pi 默认渲染显示 `[customType]` 标签 + 全文
- 注入全文：另投一条 `display: false` 的 custom_message（content 总进 LLM，
  TUI 不渲染，实测确认）；两条均携去重所需 details 字段
- Pi 对 entry 无默认渲染：`appendEntry` 数据未注册 renderer 时不在转录显示
  （实测），故不注册 renderer 的扩展不用 entry 传知情面
- 消费方：inline-context（摘要单条消息，content 即全文无独立全文条）；
  subdir-agents-md 走 custom_message 双条（短通知 + 全文，
  turn_end 边界投递；不走 tool_result 拼接——codemode only
  下嵌套脚本可能丢弃拼接内容）

## 踩坑点：运行时验证

`pnpm check` 只保证类型正确，不验证运行时行为。扩展 `.ts` 代码的提交，正文须记录运行时验证（实测命令与结果），仅 `pnpm check` 通过不算完成验证。Pi 无内置“dump 系统提示词”命令，验证 `before_agent_start` 类扩展的改写效果时：

- `-e` 传入的扩展排在扩展链最前（先于 `settings.json` 注册的包执行）；只传 dump 扩展会拿到改写前的提示词，误判“扩展未生效”。必须 `-e` 同时传入被测扩展源文件与 dump 扩展（dump 在后）：

```bash
pi -p -e <被测扩展入口> -e /tmp/dump-ext.ts --no-session "只回复：收到"
```

- 对比验证（行为回归）：从 git 检出旧版到 /tmp，两边分别 `pi -p -e <被测> -e <dump>` 跑，diff dump 落盘产物。对比前临时移走同源目录（settings 注册的部署区包），否则新旧双重改写，diff 失真
- Pi 项目技能加载渠道（实测）：`loadSkills` 走 `includeDefaults: false`，不自动扫 `cwd/.pi/skills` 与祖先 `.agents/skills`（放进去不生效，项目 `.pi/settings.json` 的 skills 数组也未生效）
  项目技能靠 `--skill` 或 settings/packages 进入，验证注入路径技能与名空间消歧用 `--skill` 传 fixture 目录
- 验证 `tool_result` 拦截类扩展（read-hint）：`-p` 控制台不打印 tool_result 原文，须在 dump 扩展里监听 `tool_result` 并把 read SKILL.md 的 content 落盘（链尾拿到的是改写后内容）
- dump 工具定义验证 schema：`pi.on("session_start")` 内调 `pi.getAllTools()`，`-e` dump 扩展 + `--no-session` 跑，`parameters` 即 typebox JSON Schema（含 `maxLength`，确认已传 LLM）
- 孤儿目录清理：ext 为 copy 模式分发，chezmoi apply 不清理部署区多余目录——源目录删除/改名后 `~/.pi/agent/ext/` 残留孤儿（不再被 settings 引用、无害但混乱），apply 后手动 `rm -rf` 处理
- meow 合并脚本时序坑（已根因修复）：apply 时 `.chezmoiscripts`（字母序在前）先于 `dot_pi` 部署，脚本读到上一轮的 settings.meow.json 副本，改源后首次 apply 合并的是旧内容；已改用 `run_onchange_after_` 前缀让脚本在数据文件部署后执行，不再需要手动补救
  - 必要时手动执行渲染脚本：`chezmoi execute-template < .chezmoiscripts/run_onchange_after_merge-pi-settings.sh.tmpl | bash`
  - packages 为并集语义，meow 源删除不传导，删包后手动从 settings.json 移除
- `/reload`（pi 内键入）热重载扩展/技能/提示词/主题/上下文文件（非仅 keybindings，`interactive-mode.js` 重载文案含 `extensions`）；改源文件后用它加载新代码免重启。副作用：reload 后旧 `pi`/`ctx` 变 stale（`runner.js` 校验），勿跨 reload 复用
- 验证 TUI 渲染（`renderResult`/`renderCall`/`ctx.ui.custom`）：`-p` headless 不走 TUI 渲染，须 `/reload` 后在交互会话触发该工具，人眼校验两态——如 `Ctrl+O`（`app.tools.expand`）由 `tool-execution` 重调 renderer 传 `{ expanded }` 触发展开态
- 验证扩展触发的 custom run（pi ≥1.2 起 `sendMessage(..., { triggerTurn: true })`，如 goal 自动续跑）的 `before_agent_start`：`-p` 有两个假象——
  `agent_end` 栈内发起时 `isStreaming` 未翻转，消息走 steer 分支进 agent 内部续 turn（不经过 `_startRun`，无 `before_agent_start`）；稍后发起则撞 stale ctx（`-p` 收尾替换 session）。
  须 tmux 交互会话从 idle 态发起，dump 扩展记录 `event.messageType` 落盘断言；user run 侧行为（摘要投递类）`-p` 可验
- 块注释内禁含 `*/` 序列（会提前终止注释，tsc 报 TS1443 / oxfmt 语法错；写路径如 `*/index.ts` 时改写避让；inject-notice.ts 踩坑）
- pi 二进制的运行时结构与 npm 发布物可能不同：bun 打包把类字段降级为构造期赋值，未初始化的字段声明直接丢弃——用 `in` 探测实例属性会误报缺失。
  0.85.1 的 `Editor.autocompleteList`（d.ts 可选成员）即此类：仅补全菜单显示时才赋值，构造后不存在（editor-input-tweaks 实测 probe：`autocompleteList: false`，其余成员全部存在）。
  探测扩展依赖的 private 成员时，以 d.ts 可选性 + 运行时守卫读取为准，勿把可选成员纳入硬性自检
- tmux 交互实测会污染持久化状态：ctrl+t（hideThinkingBlock）、/statusline、/settings 各开关经 settingsManager
  立即写回 settings.json，测试遗留会改变用户日常会话行为（2026-10-17 实际踩中：测试遗留 expanded 态，
  用户重启后 thinking 全部平铺）。测完复位原值，或彻底隔离：`PI_CODING_AGENT_DIR=$(mktemp -d)` 并软链
  `auth.json` 与 `models.json` 两文件（认证与模型可用，settings 从零生成不带用户态）
- 验证 TUI 着色/渲染类扩展的真实画面：`tmux new-session -d -s <name> -x 140 -y 42 "bash -lc '<cmd>'"` 跑交互 pi，`tmux capture-pane -p -e` 捕获带 ANSI 的画面，
  grep 颜色序列（如 `\x1b[33m`）与降级通知文本；源文件改动须先 `chezmoi apply` 部署再测（`-e` 传入的扩展排最前、会被 settings 包覆盖，测不到目标版本）
- 本文件列表行宽 ≤200 字符（markdownlint MD013 豁免表格，列表不豁免）
