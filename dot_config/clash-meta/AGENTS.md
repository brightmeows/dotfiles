---
description: mihomo (clash-meta) tun 代理配置的维护约定与踩坑点
tags: [mihomo, clash-meta, proxy, tun, fwmark]
---

# clash-meta 配置（面向代理）

本目录管理 mihomo (clash-meta) tun 全局透明代理。部署步骤、订阅管理、已知系统约束（systemd-resolved / firewalld / SELinux）见 [README.md](./README.md)（面向人）。本文件聚焦代理维护时的高信号约定与踩坑点。

仓库根 [AGENTS.md](../../../AGENTS.md) 的通用约定（`chezmoi -S .`、提交规范、中文引号）此处不重复。

## 三层架构

| 层 | 载体 | 职责 |
|---|---|---|
| 配置源 | `config.yaml.tmpl` | chezmoi 模板 → 渲染到 `~/.config/clash-meta/config.yaml` |
| 部署桥梁 | `deploy.sh` | 手动 sudo：渲染产物 → `/etc/clash-meta/` + 重载服务 |
| 运行 | `clash-meta.service` | root + CAP_NET_ADMIN，读 `/etc/clash-meta/config.yaml` |

订阅明文仅落在 `$HOME`（渲染产物），**不进 git**。

## 订阅注入：三处模板必须同步

订阅来自 `~/.env_self` 的 `*_SUBSCRIPTION` 变量。`config.yaml.tmpl` 开头用 `output` 提取为 `$subs`，下列三处**共同消费 `$subs`**，改一处必须同步其余两处：

| 位置 | 作用 | 缺失的后果 |
|---|---|---|
| `proxy-providers` | 生成 provider 条目 | 无节点来源 |
| `rules` 头部 `DOMAIN,host,DIRECT` | 订阅域名直连 | 连接死锁：下载订阅走 MATCH→节点→无节点 |
| `dns.nameserver-policy` | 订阅域名用国内 DoH | DNS 死锁：解析境外 IP 触发 fallback→走节点→无节点 |

域名提取统一用 `urlParse $url | .host`。`nameserver-policy` 是 mapping，须用 `dict` / `hasKey` 去重
（同一域名多个订阅会生成重复 key 导致 mihomo 报错）。`rules` 头部 `DOMAIN,host,DIRECT` 现在同样使用
`dict` / `hasKey` 去重（与 nameserver-policy 一致的 `$seen` dict 模式，但 rules 是序列而非 mapping，
去重目的是消除冗余规则而非避免报错）。

## 踩坑点

### 抓取 yaml 参考必须 curl，禁用 web_fetch

`exa_web_fetch` / `anysearch_extract` 会把多空格缩进压平到 1 层，导致 mihomo 报大量 `mapping key already defined`。抓远程 yaml 用：

```bash
curl -sL <raw URL> -o /tmp/ref.yaml
```

### DNS 双死锁（respect-rules + fallback）

`respect-rules: true` 让 DNS 按域名匹配的规则选 nameserver；`fallback`（境外 DoH）需走节点。节点未就绪时（启动期、订阅失效），**解析到境外 IP 的域名全部超时**——包括订阅域名本身，形成“下不到订阅→无节点→解析更下不到”的死循环。

**死锁面控制**：`nameserver` 仅含国内 DoH（alidns / doh.pub），不放境外 DoH（如 cloudflare）——境外 DNS 全放 `fallback`。避免 `nameserver` 中的境外 DoH 服务端域名在 respect-rules 下同样需走节点才能解析，把死锁面从订阅域名扩到所有经该 DoH 解析的域名。

订阅域名靠 `nameserver-policy` 绕过 fallback 打破。改 `dns` 全局策略前务必理解此耦合。

**新增**：`fallback-filter.domain` 显式列出了已知易被污染的境外域名（`+.google.com`、`+.github.com` 等），让这些域名直接走 fallback（境外 DNS）解析，跳过 nameserver 污染→fallback-filter 判定的环节，更快拿到正确 IP。

### route-exclude-address 须含本地网段

`tun.route-exclude-address` 必须排除全部本地网段，否则 mDNS / SSDP / 局域网设备发现会走代理而异常。须包含：私有段（`10/8`、`172.16/12`、`192.168/16`）、`127.0.0.0/8`（loopback）、
`169.254.0.0/16`（link-local）、`224.0.0.0/4`（组播）及 IPv6 对应段（`fc00::/7`、`fe80::/10`、`ff00::/8`）。验证：`ip route get 169.254.1.1` 应走物理网卡而非 `mihomo`。

### auto-redirect 与 Fedora firewalld 冲突（TUN 静默失败）

`tun.auto-redirect: true` 用 nftables 在 output 链重定向本机出站流量到 tun（mihomo 1.19.5+，文档标“比 auto-route 快”）。
**Fedora firewalld 默认 nftables backend**，auto-redirect 创建规则时与之冲突，netlink 返回 EEXIST（`file exists`），
mihomo 报 `Start TUN listening error: auto redirect: ...`，tun 接口**从未创建**、流量全走直连——
但 mihomo 进程仍 active，极具迷惑性。

桌面单机透明代理**不需要 auto-redirect**：`auto-route`（路由表 2022 + ip rule fwmark）已足够把本机流量导入 tun，
纯路由表方式不碰 nftables。auto-redirect 为网关/转发场景设计。本配置 `auto-redirect: false`，勿改回 true。

诊断 TUN 未生效：`ip -br link | grep mihomo`（无）+ `ip route show table 2022`（空）+ `journalctl -u clash-meta | grep "auto redirect"`（file exists）。

### 出站防回环：fwmark 替代 auto-detect-interface（消除 ENODEV）

`auto-detect-interface: true` 在网卡抖动（WiFi 波动、USB↔无线切换）时，netlink 探测出口接口偶发返回空名
（日志 `Auto detect interface for X get empty name` → `return '<invalid>' to avoid lookback`）。
随后 `SO_BINDTODEVICE` 绑定失败，内核返回 `no such device` (ENODEV)——节点 TLS 隧道中断，
客户端表现偶发连接重置/SSL 错误。多网卡切换场景下高频触发。

**根因**：auto-detect 的 `SO_BINDTODEVICE` 是 TUN 防回环的手段之一，但依赖每次拨号实时探测接口名，脆弱。

**解法**：改用 fwmark 策略路由防回环，彻底绕开接口探测：

- 顶层 `routing-mark: 2158`：mihomo 所有出站包打 mark 2158（含代理流量，非仅 self-traffic）
- `tun.auto-detect-interface: false`：不再 SO_BINDTODEVICE，消除空名 bug
- `deploy.sh` 维护 `ip rule add fwmark 2158 lookup main pref 8998`：带 mark 的包走 main 表（物理网卡），绕开 auto-route 的 table 2022（tun）回环

**多网卡自动跟随**：main 表 default 由 NetworkManager 实时维护，USB↔WiFi 切换时 NM 更新 default，带 mark 出站自动跟随，零配置——这正是关闭 auto-detect 却不丢失切换能力的原理。

**fwmark 值 2158 的由来**：对齐 mihomo [PR#3007](https://github.com/MetaCubeX/mihomo/pull/3007)（2026-07，修复 `auto-route && !auto-redirect` 下 self-traffic 回环）的 `outputMark` 默认值。
当前 1.19.24 不含该 PR，故手动设顶层 routing-mark；未来升级到含该 PR 的版本时值一致，无需改。

**实测验证**（2026-07-27，1.19.24）：

```
ip route get 108.162.198.60 mark 0x86e        # 应显示 dev <物理网卡>（非 mihomo tun）
journalctl -u clash-meta | grep "no such device"      # 应为空
journalctl -u clash-meta | grep "Auto detect interface"  # 应为空（已关）
```

**勿改回 `auto-detect-interface: true`**：会重新引入 ENODEV（实测 6h 内 16213 次 `no such device`）。
多网卡切换需求已由 main 表 + NM 等价满足。

**⚠ 配套必需：DNS 模块漏 mark 修补（1.19.24 无 PR#3007）**

顶层 `routing-mark: 2158` 覆盖**代理 outbound**，但**不覆盖 DNS 模块的内部查询**
（default-nameserver 的 UDP、DoH 的 443）。这些查询无 mark → 命中 ip rule 9002
（`from 0.0.0.0 iif lo lookup 2022`）→ 进 tun → 被 dns-hijack 劫持 → 解析循环。

**症状**：doh.pub / alidns 被 mihomo 内部解析成 fake-ip（198.18.x），
DIRECT outbound 连它们时 mihomo 检测 loopback 主动拒绝，
日志 `reject loopback connection to: doh.pub:443`，实测 6h 17979 次——
比 ENODEV 更严重（破坏 DNS 解析，影响所有域名）。
PR#3007（2026-07）正是修这个（自动给 self-traffic 打 mark），但 1.19.24 不含。

**修补**：创建带 fwmark 的 direct 代理，DNS 各 nameserver 用 `#DNS直连` 后缀强制走它：

```yaml
proxies:
  - name: DNS直连
    type: direct
    routing-mark: 2158
dns:
  default-nameserver:      [114.114.114.114#DNS直连, ...]
  nameserver:              [https://dns.alidns.com/dns-query#DNS直连, ...]
  proxy-server-nameserver: [...#DNS直连]
```

`#代理名` 是 mihomo DNS 的 URL 后缀语法（见官方 DNS 文档），让该 nameserver 的查询经指定代理出站。
DNS直连 带 routing-mark 2158，查询打 mark 走 main 表绕开 tun。

**验证**：`journalctl -u clash-meta | grep "reject loopback"` 应为空。

**升级后**：含 PR#3007 的版本会自动给 DNS 模块查询打 mark，
此 `#DNS直连` 修补可移除（但保留无害，仅多一层显式绑定）。

### external-controller 端口与 external-ui serve 启动时绑定

`external-controller` 监听端口与 `external-ui` 的 HTTP serve 在 mihomo 启动时绑定。payload 热加载（`PUT /configs`）不重新绑定端口、不重新注册 ui serve——改这两项后必须 `deploy.sh` 重启验证。

### 本地面板访问（clash.localhost）

面板用 `http://clash.localhost:9090/ui/metacubexd/`（`external-ui-name` 决定子路径）。
`external-controller` 监听 9090（与 metacubexd 默认后端一致，免手动填后端）。
**不要用 mihomo `hosts` 做本地域名**——实测其对 DNS 查询的拦截不可靠（自定义 TLD 查询返回 NXDOMAIN），`.localhost` 走浏览器原生解析绕过此问题。

### 配置校验与热加载（无需 sudo 的验证闭环）

```bash
# 1. 语法校验（oxfmt 不管 .tmpl，这是唯一强校验）
mihomo -t -d /tmp -f ~/.config/clash-meta/config.yaml

# 2. payload 模式热加载验证运行效果（无需 sudo）
CFG=$(python3 -c 'import json;print(json.dumps(open("/var/home/brightmeows/.config/clash-meta/config.yaml").read()))')
curl -X PUT 'http://127.0.0.1:9090/configs?force=true' -d "{\"payload\":$CFG}"

# 3. 验证地区组节点就位
curl -s http://127.0.0.1:9090/proxies | python3 -c "import json,sys;d=json.load(sys.stdin)['proxies'];print('🇭🇰',len(d['香港 - 手动选择']['all']),'🇯🇵',len(d['日本 - 手动选择']['all']))"
```

`PUT /configs` 的 `path` 模式只接受 `/var/lib/clash-meta` 下路径（mihomo 安全限制），验证时必须用 `payload` 传内容。

## 工作流

改配置的标准流程：

1. 编辑 `config.yaml.tmpl`
2. `chezmoi -S . apply ~/.config/clash-meta`
3. `mihomo -t -d /tmp -f ~/.config/clash-meta/config.yaml`（退出码须为 0）
4. payload 热加载 + `/proxies` 验证节点
5. `sudo bash ~/.config/clash-meta/deploy.sh`（持久化到 `/etc`）

**完成标准**：`mihomo -t` 退出码 0 + 地区策略组有节点 + 外部连接（`curl https://www.google.com`）HTTP 200。

## 边界

### Always

- 改订阅注入逻辑时，三处模板（proxy-providers / rules DIRECT / nameserver-policy）同步
- 静态主体改动后跑 `mihomo -t`
- 抓远程 yaml 用 `curl`，不用 web_fetch

### Ask First

- 改 `dns` 全局策略（respect-rules / fallback / enhanced-mode）——死锁敏感
- 改 `tun` 段（auto-redirect / dns-hijack）——影响全局路由与 DNS 劫持

### Never

- 把订阅明文 URL 写入本目录文件（仅允许 `~/.env_self` 与渲染产物）
- 用 web_fetch 抓 yaml 参考（压平缩进）
