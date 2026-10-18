# rtk 的 Pi 集成：决策记录与机制备忘

> 盘问与实施日期：2026-10-18（grilling 三轮：形态与恢复通道与改写范围 → 记账与告知与时机 → awareness 事实修正轮）
> 方法：上游源码与官方文档查证 + 本机端到端实测；本文按防漂移四件套写法——不变量直书、机制带复现、事实带探针、断言带失效条件

## 结论先行（不变量层）

rtk 的 bash 输出压缩经官方 stock 扩展接入 Pi，一个命令完成安装，不在本仓库托管任何 rtk 代码：

```bash
rtk init --agent pi --global
```

依据是三项机制属性而非任何版本号：

1. 改写决策全部在 rtk 二进制内（`rtk rewrite` 为单一事实源），扩展文件是薄代理，随 rtk 升级由 `rtk init` 原地 patch；
2. “原始结果路径提示”由 rtk 内建 recall 系统承担（失败或截断时输出 `[full output: rtk recall <hash>]`），扩展层零逻辑，无重复建设；
3. fail-open 失效模型：rtk 缺失、超时（2 秒）、版本过旧、改写失败全部透传原命令，压缩层故障不阻塞工作。

**重审触发条件**（任一成立即重新选型）：

- stock 扩展语义变化导致行为漂移：rtk 升级后重读 `~/.pi/agent/extensions/rtk.ts` 头注释的退出码契约（0/3 改写、其余透传），契约变化则重读本节
- recall hint 不再出现或模型不再跟随：跑 `rtk gain --recalls` 看 recall 命中率，长期为零说明 hint 引导失效，考虑 awareness 段加码或换 tee 模式
- 官方给 Pi 增加 awareness 注入通道：跟踪 `rtk init --help` 的 agent 列表与 Pi 段文档，通道出现后评估撤掉自管 awareness 段

## 事实层：一律探针，不抄值

| 事实 | 探针 |
|------|------|
| rtk 在位与版本 | `command -v rtk && rtk --version` |
| stock 扩展在位 | `head -4 ~/.pi/agent/extensions/rtk.ts`（thin delegate 头注释与退出码契约） |
| 恢复通道模式 | `rtk config \| rg -A3 '\[retriever\]'`（sqlite 为默认，FIFO 200 条 + 30 天保留） |
| awareness 配置位 | `rtk config \| rg -A1 '\[awareness\]'`（levels: default/high/full；对 Pi 无消费方，仅 Claude/Gemini 等有独立指令文件的 agent 消费） |
| 改写白名单 | `rtk config \| rg -A3 '\[hooks\]'`（exclude_commands 按需追加） |

## 决策记录

### 形态：官方 stock，不用 npm 包，不自研

Pi 生态第三方 rtk 集成至少六个（`pi-rtk-optimizer`、`pi-rtk-rewrite`、`@izhimu/pi-rtk`、`capyup/pi-rtk`、r3b1s 与 zogzog26 两个极简版），
能力与 stock 重叠：全部是 tool_call 事件薄代理，差异只在配置面（TUI 设置、widget、ask 模式）与自带压缩管线。
选 stock 的理由：零第三方信任面、随 rtk 版本演进自动 patch、文件极小可全文审阅。
代价：文件是机器本地状态（`~/.pi/agent/extensions/` 不在 dot_pi 管辖，不入 chezmoi），换机需重跑一条安装命令（见管理与回退）。

### “原始结果路径提示”由 rtk 内建 recall 承担，扩展层不做

原始需求“自动调用 rtk 但提示原始结果路径”的后半截已被 rtk 0.49+ 的 recall 系统内建：
失败或截断时完整原文（gzip 字节级）存入 `~/.local/share/rtk/recall.db`，输出尾部打印可执行 hint，模型照跑取回。
若扩展层再自存一份原始输出并注入路径，与内建 recall 形成两份真相，违背单一源头原则，已否决。
恢复通道保持默认 sqlite；legacy tee 文件模式（提示 `~/.local/share/rtk/tee/*.log` 路径，轮转仅 20 个文件、单文件 1 MiB 截断）留存能力弱于 sqlite，不用。

### awareness 自管 high 语义，落点 APPEND_SYSTEM.md.tmpl

rtk 的 Pi 集成是 hook-only，无 awareness 注入通道（上游 `run_pi_mode` 注释明写 `no AGENTS.md injection`，Installation Modes 表 Pi 行 Patches 列为空）；
`[awareness] level` 配置对 Pi 无消费方，改了不生效。
`full` 档的“每条命令前缀 rtk”是给无 hook、需模型自己敲 rtk 的 agent 设计的，对带 hook 的 Pi 是冗余动作（stock 扩展显式跳过已带 `rtk` 前缀的命令）。
故自管一段中文 high 语义说明（recall/bypass/RTK_DISABLED/gain 四个抓手，不教主动前缀），写入 `dot_pi/agent/APPEND_SYSTEM.md.tmpl` 末尾——仓库单一源头，chezmoi 分发，与其他 Pi 专属纪律段同构。

### 改写范围全量交给 rtk，下游提取库配套修 rtk 前缀

改写面不预设排除（YAGNI），rtk 自身已处理 sudo 透传、已带前缀跳过、交互命令与 heredoc 跳过；需要排除时往 `hooks.exclude_commands` 追加。压缩对搜索类命令的伤害实测可控（见机制层）。
真正需要的下游配套：`skill-reminders` 与 `subdir-agents-md` 的 bash 路径提取库按首 token 识别命令，
`rtk` 不在其包装命令集合（BASH_WRAPPERS）内时整段静默漏报——两包副本各补 `rtk` 一处，前缀透明性由 node 直测断言（rtk 前缀命令与裸命令提取结果逐项相等）。

## 机制层（带复现路径）

### 改写链路

Pi `tool_call` 事件 → 扩展调 `rtk rewrite <命令>`（2 秒超时）→ 退出码 0/3 携 stdout 时就地改写 `event.input.command`，1/其余透传 → codemode 嵌套的 bash 调用同样经过该 handler（Pi 嵌套调用走完整 tool_call 链）。

复现：写一个 dump 扩展监听 `tool_call` 落盘 `input.command`，`-e` 时放在被测扩展之后（链尾拿到改写后值）：

```bash
pi -p -e ~/.pi/agent/extensions/rtk.ts -e /tmp/rtk-verify-dump.ts --no-session "运行命令 git status --short"
cat /tmp/rtk-verify.log   # 应出现 "rtk git status --short"
```

### recall 恢复

命令失败（非零退出）或过滤器截断长列表时，rtk 把完整输出存入 recall.db 并在压缩输出尾部打印 hint；`rtk gain --recalls` 报告各过滤器家族的 recall 命中率，用于判断哪些压缩上限该调。

### 压缩对搜索类命令的实测

`rtk rg ... -C 1` 在小样本上与原生 rg 输出逐字节一致（rtk 只在超限时压缩并给 recall hint）；“先定位再回读”工作流的小结果场景零损伤，大结果场景由 recall 兜底。若未来发现某过滤器丢上下文伤害定位，把该命令加入 `hooks.exclude_commands`。

## 管理与回退

| 操作 | 命令 |
|------|------|
| 换机复现 | `rtk init --agent pi --global` |
| 卸载 | `rtk init --uninstall --agent pi --global` |
| 升级 | 重跑 `rtk init --agent pi --global`（对 stock 内容原地 patch） |
| 预览不改 | 加 `--dry-run` |

rtk 对托管文件的所有权语义：只更新当前或已知历史版本的 stock 内容；文件被手改或含无关内容时拒绝覆盖并询问（`--auto-patch` 放行、`--no-patch` 保留且退出码非零）。awareness 段与提取库修复在本仓库托管，随 chezmoi 分发。

## 验证记录（2026-10-18）

- 加载与改写端到端：上节 dump 法实测，log 记录 `"rtk git status --short"`，模型正常收到压缩输出
- 提取库前缀透明性：node 直测五组断言全绿——skill 副本 `rtk cat` == 裸 `cat` == `["AGENTS.md"]`、`rtk rg` == 裸 `rg` == `[]`（排除语义保持）；subdir 副本 `rtk cp` == 裸 `cp`（含源文件与 creator 回落目录）、`cat` 保持不收（设计内，纯读命令仅 skill 副本收录）
- rg 压缩输出：`rtk rg -n -C 1` 与原生 rg 逐字节一致（aliases 包小样本）
