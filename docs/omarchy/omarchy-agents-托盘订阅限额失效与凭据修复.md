# Omarchy agents 托盘订阅限额失效与凭据修复

## 现象与数据链路

托盘右侧 `omarchy.agents` 面板里某个订阅的套餐限额消失，本地 token 用量统计却一直正常。

数据链路分两段，失效只发生在第二段：

1. 本地统计：collector 扫 pi/opencode 会话日志，不需要凭据，正常工作。
2. 套餐限额：collector 拿 API key 探询各家 usage 端点，无 key 时写“Waiting for auth”或留空并保留本地统计。

面板本身只读 `~/.local/state/omarchy/agents/usage/<agent>.json`（`Agent.qml` 的 `FileView` watchChanges 自动重载），
所以托盘组件、`shell.json` 布局条目出问题时表现不同：真正失效的是 collector 的凭据获取。

## 通用陷阱：环境变量传不到 quickshell

`omarchy-restart-shell` 刻意用 `hyprctl dispatch 'hl.dsp.exec_cmd("omarchy-launch-shell")'` 拉起 shell，
让 quickshell 继承 Hyprland 的会话环境，而不是终端或工具的临时变量。这条链路意味着：

- `~/.env_self` 只被交互式 shell 加载，图形会话看不到。
- `~/.config/environment.d/*.conf` 只在 systemd user manager 启动或 `daemon-reload` 时读取；
  已经跑起来的 Hyprland 进程环境不会就地更新。
- 因此“写 environment.d + `omarchy restart shell`”本次会话无效，必须重新登录图形会话才进 Hyprland 环境。

结论：要修 collector 的凭据，优先用它自己支持的持久凭据源，不要依赖环境变量传播。

## 案例一：Z.ai GLM Coding Plan

collector：`/usr/share/omarchy/bin/omarchy-agent-usage-zai`。

凭据优先级：

1. `~/.config/omarchy/agents/zai.json` 的 `apiKey`（显式配置，最高优先）
2. 环境变量 `ZAI_API_KEY`，其次 `ZHIPU_API_KEY` / `ZHIPUAI_API_KEY`
3. `~/.pi/agent/.env`、`~/.omp/agent/.env` 的 env 文件
4. pi/omp 的 `auth.json`，只收字面 key，`$VAR` 间接引用会被跳过

国内智谱 key 只有 config 文件这条稳。写入（本机凭据，不入 chezmoi，权限 600）：

```bash
mkdir -p ~/.config/omarchy/agents
jq -n --arg k "$ZHIPU_API_KEY" '{apiKey: $k, platform: "zhipu"}' > ~/.config/omarchy/agents/zai.json
chmod 600 ~/.config/omarchy/agents/zai.json
```

`platform` 必须写 `"zhipu"`：键映射 `{"zai": "https://api.z.ai", "zhipu": "https://open.bigmodel.cn"}`，
国内 key 走 z.ai 域名会被拒。验证：

```bash
omarchy agent usage-update zai --force
jq '{tierLabel, limits}' ~/.local/state/omarchy/agents/usage/zai.json
```

期望 `tierLabel` 为套餐名（当前“Pro”），`limits` 含 Session (5-hour) 与 Weekly (7-day)。

## 案例二：OpenCode Go

collector：`/usr/share/omarchy/bin/omarchy-agent-usage-opencode`，原生支持 Go plan 的三个计量窗口
（Rolling 5h、Weekly 7d、Monthly，`tierLabel` 为“Go”），端点 `https://opencode.ai/zen/go/v1/usage`。

凭据候选顺序：

1. 环境变量 `OPENCODE_API_KEY` / `OPENCODE_GO_API_KEY`
2. opencode v2 的 store：`~/.local/share/opencode/opencode.db` 的 `credential` 表，`active = 1` 且 `integration_id` 为 `opencode-go` 或 `opencode`
3. `~/.local/share/opencode/auth.json`
4. pi / omp 的 `auth.json`
5. OpenCode Console 会话（OAuth）

opencode 的凭据只挂在环境变量里时，quickshell 拿不到，store 也空，托盘就不显示 Go 限额。
官方把凭据交给 collector 的正规入口是 store。

`opencode auth login --method key` 强制交互输入（非 TTY 直接报“API key input requires an interactive terminal”，`--answer` 对它无效），
所以非交互写入走 `auth import`，格式为数组：

```bash
umask 077
jq -n --arg k "$OPENCODE_API_KEY" \
  '[{id:"opencode-go-primary", integrationID:"opencode-go", label:"OpenCode Go",
     value:{type:"key", key:$k}, active:true}]' > /tmp/oc-import.json
opencode auth import /tmp/oc-import.json
rm -f /tmp/oc-import.json
```

验证要在干净环境里跑，否则环境变量会掩盖 store 是否真的可用：

```bash
env -u OPENCODE_API_KEY -u OPENCODE_GO_API_KEY omarchy agent usage-update opencode --force
jq '{tierLabel, limits}' ~/.local/state/omarchy/agents/usage/opencode.json
```

期望 `tierLabel` 为“Go”，`limits` 含三个窗口。导入后 `opencode auth list` 会同时显示 stored 与 environment 两个连接，属正常。

### 换 key 的漂移风险

store 里的 key 是快照，改 `~/.env_self` 不会同步。换订阅或换 key 后要重新导入，否则托盘会一直显示旧账号的额度。

## 升级核对点

- omarchy 大版本升级后分别跑两个案例的验证命令，看 `limits` 是否仍填充。
- collector 的凭据优先级与 `PLATFORMS` 键名、OpenCode 的 usage 路径可能变化，核对
  `/usr/share/omarchy/bin/omarchy-agent-usage-zai` 与 `omarchy-agent-usage-opencode` 头部注释与本文件是否一致。
