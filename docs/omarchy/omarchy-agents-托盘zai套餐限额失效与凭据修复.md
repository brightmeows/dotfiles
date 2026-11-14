# Omarchy agents 托盘 Z.ai 套餐限额失效与凭据修复

## 现象与数据链路

托盘右侧 `omarchy.agents` 面板里 Z.ai（智谱 GLM Coding Plan）的套餐限额消失，报“Waiting for auth”，而本地 token 用量统计一直正常。

数据链路分两段，失效只发生在第二段：

1. 本地统计：collector 扫 pi/opencode 会话日志，不需要凭据，正常工作。
2. 套餐限额：collector 拿 API key 探询 `QUOTA_PATH = /api/monitor/usage/quota/limit`，无 key 时写“Waiting for auth”并保留本地统计。

面板本身只读 `~/.local/state/omarchy/agents/usage/<agent>.json`（`Agent.qml` 的 `FileView` watchChanges 自动重载），所以托盘组件、`shell.json` 布局条目都没问题，失效的是 zai collector 的凭据获取。

## 根因

zai collector 的凭据优先级（`/usr/share/omarchy/bin/omarchy-agent-usage-zai` 的 `credentials()`）：

1. `~/.config/omarchy/agents/zai.json` 的 `apiKey`（显式配置，最高优先）
2. 环境变量 `ZAI_API_KEY`，其次 `ZHIPU_API_KEY` / `ZHIPUAI_API_KEY`
3. `~/.pi/agent/.env`、`~/.omp/agent/.env` 的 env 文件
4. pi/omp 的 `auth.json`，只收字面 key，`$VAR` 间接引用会被跳过

失效当天的事实核查：collector 由 quickshell（systemd 图形会话）运行，其进程环境里没有 `ZAI_API_KEY` 也没有 `ZHIPU_API_KEY`。
key 只存在于两处：`~/.env_self`（仅 shell 加载，不进 systemd）与 `~/.config/environment.d/51-meow-local.conf`（systemd user manager 未重载 environment.d，已运行的 quickshell 也没有）。
第 2 步因此落空，pi/omp 的 auth.json 里无字面 key，第 3、4 步同样落空。

结论：凡是要让图形会话里的组件拿到 key，走环境变量传播链路是脆的；collector 官方支持且排第一的凭据源是 config 文件。

## 修复

写 `~/.config/omarchy/agents/zai.json`（本机凭据，不入 chezmoi，权限 600）：

```bash
mkdir -p ~/.config/omarchy/agents
jq -n --arg k "$ZHIPU_API_KEY" '{apiKey: $k, platform: "zhipu"}' > ~/.config/omarchy/agents/zai.json
chmod 600 ~/.config/omarchy/agents/zai.json
```

`platform` 必须写 `"zhipu"`：键映射 `{"zai": "https://api.z.ai", "zhipu": "https://open.bigmodel.cn"}`，国内智谱 key 走 z.ai 域名会被拒。该文件凭据优先级最高，之后 omarchy 升级、shell 重启都不再依赖环境传播。

写入后面板自动重载；手动验证用 `omarchy agent usage-update zai --force`，然后查 `~/.local/state/omarchy/agents/usage/zai.json`：`tierLabel` 应为套餐名（当前“Pro”），`limits` 应含 Session (5-hour) 与 Weekly (7-day) 两个窗口。

## 升级核对点

- omarchy 大版本升级后跑 `omarchy agent usage-update zai --force`，看 `limits` 是否仍填充。
- collector 的凭据优先级与 `PLATFORMS` 键名可能变化，核对 `/usr/share/omarchy/bin/omarchy-agent-usage-zai` 头部注释与本节描述是否一致。
