---
description: Pi 扩展维护约定与运行时验证方法
tags: [pi, extensions, typescript]
---

# Pi 扩展（面向代理）

本目录的 `*.ts` 为 Pi 扩展（ExtensionAPI）。约定优先级：本文件 > 各文件头部注释（即设计文档，修改前完整读取）> 仓库根 [AGENTS.md](../../../AGENTS.md)（chezmoi、`pnpm check`、提交规范）> 官方文档 `~/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`。

## 目录结构（现状）

本目录为独立扩展包集合，每个子目录是一个 Pi 包（`package.json` 声明 `pi.extensions`），通过 `settings.json` 的 `packages` 数组显式注册，不再依赖 Pi 自动发现。

组织原则（2026-08-30 定）：**各包完全自包含**——包间零 import、无共享目录，复用模块（如
`inject-notice.ts`）各包自备副本、无同步义务；目录名 = 扩展语义名，包名前缀 `pi-meow-`；例外：`better-skill/`
为技能域合集包，新技能扩展默认入此包。历史域分组与 lib/ 均已拆解（跨包共享库）。
包内纯库归包内 `internal/` 子目录（不跨包，与历史 lib/ 拆解性质不同）：better-skill 2026-08-31 起，subdir-agents-md 2026-09-08 起。

| 路径 | 包名 | 角色 | 要点 |
|------|------|------|------|
| `aliases/` | `pi-meow-aliases` | 斜杠命令别名 | /clear → /new、/exit → /quit |
| `inline-context/` | `pi-meow-inline-context` | 环境摘要注入 | 日期/系统环境/Git 状态/工具与 gh，systemPrompt 注入；含包内 `inject-notice.ts` |
| `subdir-agents-md/` | `pi-meow-subdir-agents-md` | 子目录规则懒加载 | 结构化路径 + bash 全 token 提取触发；启动注入规则索引；含包内 `inject-notice.ts` 与 `internal/path-extract.ts` |
| `esc-hold/` | `pi-meow-esc-hold` | Esc 防误触 | 单击提示不中断，双击/长按才中断；terminal 输入层，与编辑器槽位无关 |
| `editor-input-tweaks/` | `pi-meow-editor-input-tweaks` | 编辑器输入增强 | /@ 标记符着色 + / 补全停留；独占编辑器槽位（`ctx.ui.setEditorComponent` 全局单例，后设覆盖先设，新增编辑器类扩展须链式包装或并入本包） |
| `questionnaire/` | `pi-meow-questionnaire` | 问卷工具 | 官方示例演化可自由修改，typebox 为仓库 devDependency |
| `models-dev/` | `pi-meow-models-dev` | 模型目录导入 | models.dev 注册表导入，协议感知 + 用户配置，async factory，入口 await；纯库模块（registry / config / mapping / thinking / custom-models）归 `internal/` 子目录；配置 schema 见下文 |
| `better-skill/` | `pi-meow-better-skill` | 技能域（合集包） | 注册模块（index-rewrite / read-hint / skill-tool）合并为 `index.ts` 顺序注册；skill 工具按名加载为主通道（全局唯一名空间 + 重名消歧别名），read 拦截为兜底，两通道共用增强段组装；纯库归 `internal/` 子目录（skill-content / namespace / inject-notice / path-canon）；customType `better-skill`（2026-09-01 由 skill-ext 改名） |

注册方式（`settings.meow.json`）：

```json
"packages": [
  "npm:pi-mcp-adapter",
  "./ext/aliases",
  "./ext/editor-input-tweaks",
  "./ext/esc-hold",
  "./ext/inline-context",
  "./ext/models-dev",
  "./ext/questionnaire",
  "./ext/better-skill",
  "./ext/subdir-agents-md"
]
```

本地包按字母序排列（顺序无运行时语义，各扩展事件面互不重叠）；npm:pi-mcp-adapter 保持首位。

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

## 与 models.json 的关系（优先级：models.json > models-dev 扩展 > pi 内置目录）

pi 原生自定义模型文件 `~/.pi/agent/models.json`（chezmoi 源 `dot_pi/agent/models.json`）中显式声明的 provider 进入保护名单，本扩展注册时跳过（2026-09-08 定，修复 registerProvider 带 models 整体替换导致的自定义失效）。扩展启动时读一次名单，reload/重启生效。

## 新增与归组

- 一包一扩展（2026-08-30 定）：新扩展建新包目录（目录名 = 扩展语义名），包名 `pi-meow-<目录名>`，扩展文件改名 `index.ts` 直接作为入口；并在 `settings.meow.json` 注册
- 技能域例外：技能相关扩展入 `better-skill/` 合集包（合集入口顺序注册），不单独成包
- 编辑器槽位例外：替换主编辑器的扩展（`ctx.ui.setEditorComponent` 全局单例）不可与 `editor-input-tweaks` 并存，新编辑器功能并入其 `SlashAtHighlightEditor` 或链式包装
- 各包完全自包含（2026-08-30 定）：包间零 import、无 lib 类共享目录；包内模块用 `./xxx.ts` 写法（tsconfig 已开 `allowImportingTsExtensions`）；需复用的模块在各包自备副本，副本间无同步义务
- 新增包须在 `settings.meow.json` 的 `packages` 数组注册路径
- 新增/移动扩展须实测加载：`pnpm check` 不查 default factory 契约，须 `pi -p -e <入口> --no-session` 验证（组目录传 `xxx/index.ts`）
- 各文件头部注释即设计文档：改动前完整读取，改动后同步更新（含包内模块）

## 统一提示约定（LLM 注入且用户需知情）

LLM 注入且用户需知情的操作，用户提示显示一律统一（2026-08-12；2026-08-17 补 entry 通道）：

- 投递 custom_message（`display: true`），TUI 渲染注册包内 `inject-notice.ts` 的 `renderInjectNotice`
- `details.notice`：提示文案，统一格式 `[自动注入] <来源>：<说明>`，collapsed（默认）只显示它
- `content`：注入全文（进 LLM；ctrl+o 展开工具输出后显示全文）
- 消费方：subdir-agents-md（懒加载子目录规则 + 启动索引）、inline-context（环境摘要）、better-skill（默认块移除断言告警；2026-08-17 移除常规重写提示，常规重写零提示）

### entry 通道（仅用户可见，不进 LLM）

告知用户“已向 LLM 注入什么”但本身不注入内容的简短提示，走 appendEntry（2026-08-17）：

- 投递 `pi.appendEntry(customType, { notice, lines? })`（CustomEntry，`buildSessionContext` 忽略，不进 LLM 上下文）
- TUI 渲染注册包内 `inject-notice.ts` 的 `renderInjectEntry`（外观与 message 版一致）：collapsed 只显示 `notice`，expanded 显示 `lines` 全文
- 消费方：better-skill 的 read-hint 与 skill-tool（各自独立投递，2026-09-01）；customType 均为 `better-skill`（由 skill-ext 改名，旧会话条目走默认渲染），renderer 在 index-rewrite.ts 统一注册

实现要点：renderer 按 customType 精确匹配（不支持前缀/通配）；不注册 renderer 时默认渲染直接显示 content 全文（无折叠）。headless（`-p`）下 entry 不渲染也不报错。

## 踩坑点：运行时验证

`pnpm check` 只保证类型正确，不验证运行时行为。Pi 无内置“dump 系统提示词”命令，验证 `before_agent_start` 类扩展的改写效果时：

- `-e` 传入的扩展排在扩展链最前（先于 `settings.json` 注册的包执行）；只传 dump 扩展会拿到改写前的提示词，误判“扩展未生效”。必须 `-e` 同时传入被测扩展源文件与 dump 扩展（dump 在后）：

```bash
pi -p -e dot_pi/agent/ext/better-skill/index.ts -e /tmp/dump-ext.ts --no-session "只回复：收到"
```

- 对比验证（行为回归）：从 git 检出旧版到 /tmp，两边分别 `pi -p -e <被测> -e <dump>` 跑，diff dump 落盘产物。对比前临时移走同源目录（`~/.pi/agent/ext/better-skill`），否则新旧双重改写，diff 失真
- Pi 项目技能加载渠道（2026-08-13 实测）：`loadSkills` 走 `includeDefaults: false`，不自动扫 `cwd/.pi/skills` 与祖先 `.agents/skills`（放进去不生效，项目 `.pi/settings.json` 的 skills 数组也未生效）
  项目技能靠 `--skill` 或 settings/packages 进入，验证注入路径技能与名空间消歧用 `--skill` 传 fixture 目录
- 验证 `tool_result` 拦截类扩展（read-hint）：`-p` 控制台不打印 tool_result 原文，须在 dump 扩展里监听 `tool_result` 并把 read SKILL.md 的 content 落盘（链尾拿到的是改写后内容）
- dump 工具定义验证 schema：`pi.on("session_start")` 内调 `pi.getAllTools()`，`-e` dump 扩展 + `--no-session` 跑，`parameters` 即 typebox JSON Schema（含 `maxLength`，确认已传 LLM）
- 孤儿目录清理：ext 为 copy 模式分发，chezmoi apply 不清理部署区多余目录——源目录删除/改名后 `~/.pi/agent/ext/` 残留孤儿（不再被 settings 引用、无害但混乱），apply 后手动 `rm -rf` 处理
- meow 合并脚本时序坑（2026-08-30 实测）：apply 时 `.chezmoiscripts`（字母序在前）先于 `dot_pi` 部署，脚本读到上一轮的 settings.meow.json 副本，改源后首次 apply 合并的是旧内容
  - 必要时手动执行渲染脚本：`chezmoi -S . execute-template < .chezmoiscripts/run_onchange_merge-pi-settings.sh.tmpl | bash`
  - packages 为并集语义，meow 源删除不传导，删包后手动从 settings.json 移除
- `/reload`（pi 内键入）热重载扩展/技能/提示词/主题/上下文文件（非仅 keybindings，`interactive-mode.js` 重载文案含 `extensions`）；改源文件后用它加载新代码免重启。副作用：reload 后旧 `pi`/`ctx` 变 stale（`runner.js` 校验），勿跨 reload 复用
- 验证 TUI 渲染（`renderResult`/`renderCall`/`ctx.ui.custom`）：`-p` headless 不走 TUI 渲染，须 `/reload` 后在交互会话触发该工具，人眼校验两态——如 `Ctrl+O`（`app.tools.expand`）由 `tool-execution` 重调 renderer 传 `{ expanded }` 触发展开态
- 块注释内禁含 `*/` 序列（会提前终止注释，tsc 报 TS1443 / oxfmt 语法错；写路径如 `*/index.ts` 时改写避让，2026-08-12 inject-notice.ts 踩坑）
- 本文件列表行宽 ≤200 字符（markdownlint MD013 豁免表格，列表不豁免）
