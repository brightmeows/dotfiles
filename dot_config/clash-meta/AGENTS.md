---
description: mihomo (clash-meta) tun 代理配置的维护约定与踩坑点
tags: [mihomo, clash-meta, proxy, tun]
---

# clash-meta 配置（面向代理）

本目录管理 mihomo (clash-meta) tun 全局透明代理。部署步骤、订阅管理、已知系统约束（systemd-resolved / firewalld / SELinux）见 [README.md](./README.md)（面向人）。本文件聚焦代理维护时的高信号约定与踩坑点。

仓库根 [AGENTS.md](../../../AGENTS.md) 的通用约定（`chezmoi -S .`、提交规范、中文引号）此处不重复。

## 三层架构

| 层 | 载体 | 职责 |
|---|---|---|
| 配置源 | `config.yaml.tmpl` | chezmoi 模板 → 渲染到 `~/.config/clash-meta/config.yaml` |
| 部署桥梁 | `deploy.sh` | 手动 sudo：渲染产物 → 系统配置目录 + 重载服务（自动探测发行版布局） |
| 运行 | `mihomo.service`（Arch）/ `clash-meta.service`（Fedora） | root + CAP_NET_ADMIN，读系统配置目录 |

订阅明文仅落在 `$HOME`（渲染产物），**不进 git**。

## 发行版布局（deploy.sh 自动探测）

| | Arch（mihomo-bin AUR） | Fedora（clash-meta COPR） |
|---|---|---|
| 系统配置 | `/etc/mihomo/config.yaml` | `/etc/clash-meta/config.yaml` |
| 数据目录（`-d`） | `/etc/mihomo` | `/var/lib/clash-meta` |
| 服务名 | `mihomo.service` | `clash-meta.service` |

下文凡提 `/var/lib/clash-meta`（如 `PUT /configs` path 模式安全限制），Arch 上对应 `/etc/mihomo`。

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

### system/mixed 栈 NAT 回注与 ufw INPUT（放行由 deploy.sh 保证）

sing-tun `stack: system`/`mixed` 的 TCP 是 NAT 模式：tun 读到 SYN 后改写目的为 tun 接口地址 + 内核监听
端口（`processIPv4TCP` → `writeBack`），交**本机内核 TCP 栈**完成握手。回注包以 `iif=mihomo`、
conntrack NEW 过 netfilter INPUT 链；ufw（本机 Arch 是 ufw/iptables-nft，非 Fedora firewalld）
INPUT 默认拒绝，目的为 LOCAL 的包经 `ufw-after-input → ufw-skip-to-policy-input` 丢弃：SYN 到不了内核
监听 → 无 SYN-ACK → 全部 TCP 静默死亡（境内直连也死），`/connections` 无连接、无日志。UDP 不过此
路径（system 栈 UDP 直通写回、mixed 栈 UDP 走 gvisor），ICMP 同样用户态应答——故障面精确限定在 TCP。

单变量实验闭环（2026-08-30，内核 7.1.9）：mixed 栈下 `ufw allow in on mihomo` → TCP 立即复活；
`ufw delete` → 复死。官方 wiki 亦明示“开启防火墙则 system/mixed 不可用需放行”。

本机决策：`stack: system` + deploy.sh 自动放行（ufw 分支 `allow in on mihomo`，幂等、持久化于
`/etc/ufw/user.rules`；firewalld 机器走 trusted zone 分支），部署后自动 curl 验证数据路径。
**勿绕过 deploy.sh 改防火墙或换防火墙**——放行缺失即静默复发。诊断：TCP 全死（境内直连也死）+
`pkexec nft list chain ip filter ufw-skip-to-policy-input` 计数随探测增长即中招。

### payload 热加载重建 tun 有竞态（device or resource busy）

`PUT /configs?force=true` 会重建 tun 设备，实测偶发 `Start TUN listening error: configure tun
interface: device or resource busy`——tun 消失、流量走直连，且用直连探测会得到“正常”假象（境内直连
本就通）。需要验证 tun 行为时先 `PUT` 一份 `tun.enable: false` 的配置卸载，再 `PUT` 目标配置；
或直接 `systemctl restart`。部署一律走 deploy.sh（systemctl restart），不受此影响。

### DoT 直连 IP 与接口监控空窗（TUN 探测警告风暴）

`fallback` 中的 `tls://8.8.4.4:853`（IP 直连 DoT）在 suspend/resume、换网、挂起恢复的接口监控空窗期
高频重试并刷 `Auto detect interface ... get empty name`：monitor 拿不到默认接口名时，每次 DoT 重连
都记一条 warning。实测（2026-09-19/20）：单次挂起恢复风暴 2.1 万条，风暴日 mihomo 日志全天可达数十
万行（journal 历史累计 562 万行/2.8GB）。2026-09-20 已移除该项，保留 dns.google 与 dns.twnic.tw
两个域名形式 DoH（解析走 bootstrap，重试节奏不同，双源冗余不变）。若日后要恢复第三境外源，
优先 DoH 域名形式，勿用 IP 直连形式。

### 开机竞态（本机 drop-in 已修）

Arch 上 mihomo 早于 NM 的 DHCP 约 3s，开机刷 `default interface lost` + `no such device`（monitor 自愈）。
Omarchy mask 了 wait-online，`After=network-online.target` 无效。本机在
`/etc/systemd/system/mihomo.service.d/override.conf` 用 ExecStartPre 等默认路由（最长 30s 超时放行）；
机器本地配置不入仓库，换机部署需重建（内容见 README 开机竞态节）。

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
