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

域名提取统一用 `urlParse $url | .host`。`nameserver-policy` 是 mapping，须用 `dict` / `hasKey` 去重（同一域名多个订阅会生成重复 key 导致 mihomo 报错）。

## 踩坑点

### 抓取 yaml 参考必须 curl，禁用 web_fetch

`exa_web_fetch` / `anysearch_extract` 会把多空格缩进压平到 1 层，导致 mihomo 报大量 `mapping key already defined`。抓远程 yaml 用：

```bash
curl -sL <raw URL> -o /tmp/ref.yaml
```

### DNS 双死锁（respect-rules + fallback）

`respect-rules: true` 让 DNS 按域名匹配的规则选 nameserver；`fallback`（境外 DoH）需走节点。节点未就绪时（启动期、订阅失效），**解析到境外 IP 的域名全部超时**——包括订阅域名本身，形成“下不到订阅→无节点→解析更下不到”的死循环。订阅域名靠 `nameserver-policy` 绕过 fallback 打破。改 `dns` 全局策略前务必理解此耦合。

### route-exclude-address 须含本地网段

`tun.route-exclude-address` 必须排除全部本地网段，否则 mDNS / SSDP / 局域网设备发现会走代理而异常。须包含：私有段（`10/8`、`172.16/12`、`192.168/16`）、`127.0.0.0/8`（loopback）、
`169.254.0.0/16`（link-local）、`224.0.0.0/4`（组播）及 IPv6 对应段（`fc00::/7`、`fe80::/10`、`ff00::/8`）。验证：`ip route get 169.254.1.1` 应走物理网卡而非 `mihomo`。

### external-ui 与 hosts 仅启动时初始化

`external-ui`（metacubexd 静态托管）与 `hosts`（`clash.meow` → 127.0.0.1）在 mihomo 启动时初始化。payload 热加载（`PUT /configs`）不重新注册 external-ui HTTP serve、不重载 hosts 表——改这两项后必须 `deploy.sh` 重启验证，不能靠热加载。

### 配置校验与热加载（无需 sudo 的验证闭环）

```bash
# 1. 语法校验（oxfmt 不管 .tmpl，这是唯一强校验）
mihomo -t -d /tmp -f ~/.config/clash-meta/config.yaml

# 2. payload 模式热加载验证运行效果（无需 sudo）
CFG=$(python3 -c 'import json;print(json.dumps(open("/var/home/brightmeows/.config/clash-meta/config.yaml").read()))')
curl -X PUT 'http://127.0.0.1:9090/configs?force=true' -d "{\"payload\":$CFG}"

# 3. 验证地区组节点就位
curl -s http://127.0.0.1:9090/proxies | python3 -c "import json,sys;d=json.load(sys.stdin)['proxies'];print('🇭🇰',len(d['🇭🇰 - 自动选择']['all']),'🇯🇵',len(d['🇯🇵 - 自动选择']['all']))"
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
