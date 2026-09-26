# Pi 的 LSP 支持：决策记录与机制备忘

> 盘问与实施日期：2026-09-26（grilling 两轮会话：落地轮 + 上游 PR 轮）
> 方法：源码级探查 + 三语言实测；本文按防漂移四件套写法——不变量直书、机制带复现、事实带探针、断言带失效条件

## 结论先行（不变量层）

pi 核心不承载 LSP，支持走扩展路线；选定 `pi-lsp-extension`。依据是三项**机制属性**而非任何版本号：

1. 项目级 `.pi-lsp.json` 配置（autoStart 预热、按项目关闭注入）；
2. 无跨会话 daemon 依赖的懒启动（普通项目每会话预热一次，详见机制层）；
3. 维护活跃（改动可跟进上游）。

**重审触发条件**（任一成立即重新选型）：

- 上游 90 天无提交：`gh api repos/samfoy/pi-lsp-extension --jq .pushed_at`
- 机制属性被移除：读上游 CHANGELOG，`rg "autoStart|loadProjectConfig" src/`
- 四个上游 issue 全部被拒：`gh issue list --repo samfoy/pi-lsp-extension --author brightmeows`
  ——被拒则“纪律长期化”，重开 fork / 自研路线的评估

**纪律**（上游信任门合并前的人肉约束）：不给不可信仓库开 pi 会话——`.pi-lsp.json` 的
`servers.*.command` 与 `lombokJar` 是代码执行向量（见机制层信任门）。

## 事实层：一律探针，不抄值

易变事实（版本、下载量、issue 状态）不写死值，只给权威源：

| 事实 | 探针 |
|------|------|
| pi 运行时版本 | `pi --version`（安装位置 `command -v pi`；包名曾从 `pi-coding-agent` 改为 `pi`，故不探包名） |
| 扩展版本 | `npm view pi-lsp-extension version` |
| 语言服务器在位 | `command -v rust-analyzer ty clangd typescript-language-server` |
| 四 issue 状态 | `gh issue view {15,16,17,18} --repo samfoy/pi-lsp-extension` |
| 上游核心 LSP 立场 | `gh issue view 4235 --repo earendil-works/pi`（截至 2026-09 为 `closed-because-bigrefactor`；维护者曾在 #4616 表态“pi does not have LSP”） |
| 本机配置分布 | `fd .pi-lsp.json ~/Codes -H`（应命中 6 处，见落地状态） |

## 机制层（带复现路径）

### tsserver 要求文档先打开（上游 issue #18 的根因）

`typescript-language-server` 对从未 `didOpen` 的文件返回空结果；`rust-analyzer` 与 `ty`
走磁盘/VFS 应答，掩盖了这一差异。复现（裸 LSP，无需 pi）：spawn
`typescript-language-server --stdio`，rootUri 指向仓库，发 initialize/initialized 后做
`documentSymbol` 得 0；补发目标文件 `didOpen` 再请求同接口得 16（2026-09-26 实测）。

扩展内的三种症状（同日实测）：从未读文件导航空；同一 assistant 消息里 read 与导航并行
时定义抢跑失败（相差约 4ms）；跨回合先 read 再导航正常且跨文件精确命中。

### 配置合并与路径（上游 issue #15 的设计）

- 合并为**逐键覆盖**：项目 `.pi-lsp.json` > 用户配置 > 内置默认；数组整体替换，
  `servers` 按语言键整体替换。实现入口符号：`loadProjectConfig()`。
- 用户配置路径跟随 pi 环境变量惯例（`PI_CODING_AGENT_DIR` → `~/.pi/agent`）。
  教训出处：web-search.json 曾因第三方扩展自造 XDG 解析分支导致 GUI/TTY 行为分裂
  （详见 `dot_pi/agent/AGENTS.md` 对应节）。

### 信任门（上游 issue #16 的设计）

- 攻击面：`servers.*.command/args/env`（任意命令、`LD_PRELOAD` 类注入）、`lombokJar`
  （仓库内 jar 作 `-javaagent` 加载）；`autoStart` 只列语言 ID，本身无执行向量。
- 设计：未信任项目**整份忽略** `.pi-lsp.json`（`ctx.isProjectTrusted()`，pi 官方文档
  即建议用于项目级配置），忽略时一次性 notify（仅配置存在时触发）。

### 普通项目无跨会话 daemon（选型复议时塌方的依据）

`DefaultWorkspaceProvider` 显式 `stateDir = null`（“no daemon support”），共享 daemon 仅
Brazil 企业工作区经外部 provider 启用——普通项目每会话冷启动一次，autoStart 是唯一预热
手段；选型复议（维持原选）即基于此事实。

## 落地状态（本机，2026-09-26）

- 服务器安装：pacman（rust-analyzer / ty / typescript-language-server；clangd 原有）。
  ty 的 LSP 子命令为 `ty server`（官方 `docs/editors.md`），经 `servers.python` 覆盖默认 pyright。
- 配置文件 6 处：dotfiles 仓根（typescript 预热，已随仓库提交）；bmsrs、bms-table-rs、
  strict-num-extended（rust）；bms-resource-scripts（python + ty）；BeAtBench（cpp/c → clangd）。
  后五处为各仓本地未跟踪文件。统一两键：`autoInjectDiagnostics: false` + `autoStart`。
- BeAtBench 编译数据库：`cmake -B build -DCMAKE_EXPORT_COMPILE_COMMANDS=ON -DCMAKE_POLICY_VERSION_MINIMUM=3.5`
  （第二标志因 portaudio 的 CMake 最低版本声明过老；产物均在 gitignore 内）。

## 实测摘要（导航路径，2026-09-26）

- 工具延迟毫秒级（rust-analyzer documentSymbol 8ms、definition 4ms，ty 同级）；
- autoStart 在会话约 1.3s 完成进程拉起与握手——状态件“ready”指握手完成，非项目加载完成；
- 社区流传的“rust-analyzer 冷启动 30-60s”在导航路径**未出现**（VFS 应答不等 cargo）；
  全量诊断与跨 crate 解析场景未测，此结论不外推。
- 方法存档：RPC 探针（`pi --mode rpc` + 时间戳解析 `setStatus` 事件）。探针脚本置于
  tmp 目录易失，重建要点即本节与复现段所列步骤。
