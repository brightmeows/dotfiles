# Web 搜索源配置与实测记录

`web-search.json` 是 pi-web-access 扩展的配置源，经 chezmoi 分发到 `~/.pi/web-search.json`（legacy 路径，兼容读取）。本文档记录各搜索源的启用状态、免费额度与实测表现，不部署到 `$HOME`（已加入 `.chezmoiignore`），仅在仓库内维护。

## 配置机制

三条钉死的机制，改配置前先读：

- `searchRouting.providers` 是顺序 fallback 链，不是聚合。头部源失败（`fallbackOn` 里的 quota/transient/network/invalid-response/unsupported）才轮到下一个；无凭据的源在本地可用性判定时直接跳过，零网络开销。
- API key 一律走 `~/.env_self` 的 legacy 环境变量（如 `TAVILY_API_KEY`），JSON 里不写 `"$VAR"` 占位。
  原因：`$VAR` 引用在变量缺失时抛 credential 类错误，而 `fallbackOn` 不含该类别，routing 会中断整条链而不是跳到下一家（`gemini-search.ts` 的 `classifyProviderError` 钉死的行为）。
  环境变量路径则天然安全：变量不在时 provider 直接 `unavailable` 跳过，注册后填值即生效，无需再动 JSON。
- `/curator` 等命令持久化设置时会写到新路径 `~/.pi/agent/web-search.json`，与本文件分发的 legacy 路径并存漂移，出现行为不一致时先查两份文件。

## 已启用源（fallback 顺序 = 实测质量降序）

| 顺序 | 源 | 凭据 | 免费额度 | 实测定位 |
|---|---|---|---|---|
| 1 | exa | `EXA_API_KEY` | 注册送 $20，每月循环 $10 credit，无卡 | 时效与长尾最强，返回页面级内容；耗尽 credit 报 quota 自动下落 |
| 2 | duckduckgo | 无需 key | 无限（HTML 抓取） | 中文最贴；无 SLA，偶发空结果报 invalid-response 自动下落 |
| 3 | anysearch | `ANYSEARCH_API_KEY` | 付费 key（已有） | 官方源命中稳定；时效弱 |
| 4 | keenable | 无需 key | 公共端点 1000 次/时、10 QPS/IP | 论坛与邮件列表深挖强；中文弱 |
| 5 | tavily | `TAVILY_API_KEY` | 1000 credits/月，无卡 | 行业标杆，时效好；本地样本未显出口碑优势 |
| 6 | tinyfish | `TINYFISH_API_KEY` | 不计费，30 次搜索/分 + 150 次 fetch/分 | 时效完败（返回两年前旧闻），其余方向可用 |
| 7 | querit | `QUERIT_API_KEY` | 1000 请求/月，无卡 | 全面平庸，无硬伤无亮点 |
| 8 | serpdive | 未注册 | krill 免费（官网口径月度 1000 credits，无卡） | 注册被 Cloudflare 拦截；链尾保留，拿到 `sd_live_` key 填 `SERPDIVE_API_KEY` 即自动生效 |

## 未启用源（移除原因，防重复踩坑）

| 源 | 移除原因 | 重新启用条件 |
|---|---|---|
| brave | 2026-02 取消免费层，改每月 $5 credit（约 1000 次），且免费计划也要求绑卡验证身份 | 出现真免费层 |
| kagi | 纯付费订阅 | 不考虑 |
| bocha | 付费，支付宝充值无海外卡门槛，中文质量最强 | 需要中文最强源时充值，加 `BOCHA_API_KEY` 并排前 |
| gemini | AI Studio 免费层支持地区不含中国大陆与港澳，地区拦截 | 官方开放，或接受代理与账号合规成本 |
| searchinfinity | Byteplus 国际版支付渠道仅 Visa/Mastercard | 不考虑 |
| openai | 无 Codex 订阅登录 | `/login` 登录 Codex 后自动可用 |
| parallel | REST API 需 key；parallel-mcp 免 key 但仅抓取场景且需显式配置 | 需要 Parallel 抓取时 |
| searxng | 需自建实例 | 自建后配 `searxngBaseUrl` |
| firecrawl / jina / search1api | 免费可注册（1000 credits/月、10M tokens、100 credits）但非必需，偏抓取增强 | 需要抓取增强时注册 |
| ollama / perplexity | 需付费账号 | 不考虑 |

## Benchmark（2026-10-12）

### 设计

三方向覆盖三种能力：中文内容（中文索引与切题）、时效性（新鲜度）、长尾硬件问题（索引深度）。7 个可用源各跑 3 个查询、每次取 3 条结果，共 21 次搜索。评分维度为来源权威性、切题度、时效性，人工判分，每方向满分 2。

| 方向 | 查询 | 考察点 |
|---|---|---|
| 中文 | `chezmoi 管理点文件 入门教程` | 中文来源命中与中文意图理解 |
| 时效 | `Hyprland latest release October 2026 new features` | 新鲜度（当时最新版为 v0.56.2） |
| 长尾 | `ACP3x ES8336 headphone no sound Linux fix` | 冷门硬件 bug 的检索深度 |

### 结果

| 源 | 中文 | 时效 | 长尾 | 总分（满分 6） | 关键观察 |
|---|---|---|---|---|---|
| exa | 1.5 | 2 | 2 | 5.5 | 给出精确版本序列 v0.56.2 往回排；LKML 命中 MateBook 具体机型的驱动注册讨论 |
| duckduckgo | 2 | 1.5 | 2 | 5.5 | 知乎专栏与中文博客最贴题；直接找到 acp3x-es8336 修复仓库 |
| anysearch | 2 | 1 | 2 | 5 | 命中 kernel bugzilla 主战场；时效方向返回四年前的入门视频 |
| keenable | 1 | 2 | 2 | 5 | ALSA 邮件列表的 `snd_soc_acp3x_es8336_mach` 模块级细节；中文弱 |
| tavily | 1 | 2 | 1.5 | 4.5 | 唯一直答 2026-10 新特性条目的源 |
| tinyfish | 2 | 0 | 2 | 4 | 时效方向返回 2024-10 旧闻，硬伤 |
| querit | 1 | 1 | 1.5 | 3.5 | 全面平庸，无硬伤无亮点 |
| serpdive | — | — | — | — | 无 key 未测 |

### 方法论局限

结论只到“方向级排序参考”的置信度，不到精确定位：

- 每方向仅 1 个查询，无方差估计。duckduckgo 的中文满分与 keenable 的长尾满分都可能含单次运气。
- 人工判分无锚定评分卡，且非盲评（判分时知道结果来自哪家），存在偏好污染。
- 查询选自自身生态（chezmoi、Hyprland、自用硬件），不代表一般查询分布。
- 未核验 answer 的事实正确性：时效方向 tavily 声称的“October 2026 特性”未逐条核实，搜索源的 answer 可能含幻觉。
- 未测延迟与失败恢复行为。

### 业界基准对照

需要更认真的评测时的参照系：

- **BrowseComp**（OpenAI，2025-04）：1266 道高难度检索题，是搜索 API 质量的硬基准；Parallel 2026 年用它横评 6 家搜索 API，agentic 准确率分布在 19% 到 58% 之间。个人可直接抽子集跑，答案唯一可机判。
- **LiveBrowseComp**（2026）：335 道人写题的防记忆版本，专治“搜索 agent 只是答自家索引覆盖而非真搜索”。
- **Search Arena**（LMSYS）：搜索增强 LLM 的人类盲评竞技场（arena.ai 的 Search 榜），解决评分主观问题。
- **DeepResearch Bench / DeepSearchQA**：深度研究 agent 的报告级评测（22 领域 / 900 prompt 多步搜寻）。
- **aimultiple 方案**：8 家 API × 100 条真实查询 × LLM judge 逐条打分（4000 条结果），是个人可复制的规模化横评做法。
- **FRAMES / FreshQA**：多跳事实与时效问答，带 ground truth，对应本文 benchmark 的中文与时效方向。

### 重审触发条件

- exa credit 耗尽、无卡渠道政策收紧，或 duckduckgo 频繁 invalid-response——触发顺序重测。
- serpdive 注册成功——实测并入链。
- bocha 充值或 brave 免费层回归——按未启用表的条件重启评估。
- pi-web-access 大版本变更 provider 行为时。
