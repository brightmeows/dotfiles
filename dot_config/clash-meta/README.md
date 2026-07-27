# clash-meta（mihomo）配置

本目录管理 [mihomo](https://github.com/MetaCubeX/mihomo)（即 clash-meta）的 tun 全局透明代理配置，采用“配置归仓库、服务归系统”的分层设计。

## 文件清单

| 文件 | 归属 | 职责 |
|---|---|---|
| `config.yaml.tmpl` | chezmoi 模板 | 渲染为 `~/.config/clash-meta/config.yaml`，含订阅注入逻辑 |
| `deploy.sh` | 手动 sudo 脚本 | 把渲染产物搬运到 `/etc/clash-meta/` 并重载服务 |
| `README.md` | 文档 | 本文件 |

模板源文件不含订阅明文，可安全进 git；渲染产物含明文订阅 URL，仅落在 `$HOME`，不进 git。

## 订阅管理

订阅来自 `~/.env_self` 中以 `_SUBSCRIPTION` 结尾的环境变量。模板渲染时筛选**变量名以 `_SUBSCRIPTION` 结尾、值非空、且为合法 `http://` 或 `https://` URL** 的条目，为每个生成一个 `proxy-providers` 条目。

约定示例：

```bash
# ~/.env_self
AKKCLOUD_SUBSCRIPTION=https://example.com/link/xxx?sub=3
AKKCLOUD_VLESS_SUBSCRIPTION=https://example.com/link/xxx?sub=5
PEIQIANJICHANG_SUBSCRIPTION=   # 空值会被自动跳过
```

- provider 名 = 变量名去掉 `_SUBSCRIPTION` 后缀（如 `AKKCLOUD`、`AKKCLOUD_VLESS`）
- 节点缓存路径 = `./proxy_provider/<name 小写>.yaml`（相对 mihomo 工作目录 `/var/lib/clash-meta`）
- `proxy-groups` 无需手动改：所有地区组用 `include-all: true` + 地区正则 filter 自动汇入全部 provider 节点

## 部署步骤

```bash
# 1. 仓库内改配置 / 改订阅后，渲染到 ~/.config/clash-meta/
chezmoi -S . apply

# 2. （可选）本地非 root 预检配置语法
mihomo -t -d /tmp -f ~/.config/clash-meta/config.yaml

# 3. 系统侧部署（写 /etc、enable 服务、配 firewalld）
sudo bash ~/.config/clash-meta/deploy.sh
```

`deploy.sh` 内部流程：root 检查 → `mihomo -t` 语法校验 → `install -m644` 到 `/etc/clash-meta/config.yaml` → `systemctl enable --now clash-meta` → firewalld 放行 `mihomo` 接口（best-effort）。

## 日常维护

改配置或增删订阅后的标准流程：

```bash
chezmoi -S . diff        # 预览差异
chezmoi -S . apply       # 渲染
sudo bash ~/.config/clash-meta/deploy.sh   # 部署 + 重载
```

## 管理面板

metacubexd 由 mihomo `external-ui` 本地托管（首次启动自动从 GitHub 下载到 `/var/lib/clash-meta/ui`）。
`external-controller` 监听 9090（与 metacubexd 默认后端一致，免手动填），浏览器按 RFC 6761 将 `clash.localhost` 自动解析为 127.0.0.1，无需 `hosts` / `/etc/hosts`：

- 面板：`http://clash.localhost:9090/ui/metacubexd/`（`external-ui-name` 决定子路径）
- 直连：`http://127.0.0.1:9090/ui/metacubexd/`

手动更新面板：`curl -X POST http://127.0.0.1:9090/upgrade/ui`

> `external-controller` 端口与 `external-ui` serve 在 mihomo **启动时**绑定，payload 热加载不触发；改这两项后需 `deploy.sh` 重启生效。

## 已知约束

本配置针对 Fedora Kinoite（原子化系统）调校，部署时需注意以下几点。

### TUN 生效验证

部署后确认 tun 真正接管流量（曾因 auto-redirect 冲突导致 tun 静默失败，mihomo 进程仍 active 极具迷惑性）：

```bash
ip -br link | grep mihomo                      # 应出现 mihomo 接口
ip route show table 2022 | head -3             # 应有 0.0.0.0/1、128.0.0.0/1
curl -s https://www.cloudflare.com/cdn-cgi/trace | grep ^ip=  # 节点 IP（非本地运营商）
journalctl -u clash-meta -n 30 | grep "Tun adapter listening"  # 应有该日志
```

任一项缺失即 tun 未生效，查 `journalctl -u clash-meta | grep -i error`。

### 本地网络直连

`tun.route-exclude-address` 已排除全部本地网段，确保局域网通信、设备发现、组播**不走代理**：

- 私有段：`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`
- loopback：`127.0.0.0/8`
- link-local（mDNS/SSDP/zeroconf）：`169.254.0.0/16`
- 组播（mDNS/SSDP/IGMP）：`224.0.0.0/4`
- IPv6 对应段：`fc00::/7`、`fe80::/10`、`ff00::/8`

验证：`ip route get 169.254.1.1` 应走物理网卡（如 `wlp1s0`）而非 `mihomo`。

### allow-lan

`allow-lan: false`（关闭局域网入站）。桌面单机 TUN 透明代理无需给其它设备当代理网关，关闭可减少攻击面。若后期需为局域网其他设备提供代理服务，改回 `true` 并确认 `external-controller` 监听地址绑定正确。

### SSH 直连

所有 22 端口流量走 DIRECT 直连，不走代理节点。

**原因**：机场节点普遍在服务器端封锁出站 22 端口（`iptables ... --dport 22 -j DROP`），防止用户通过 SSH 动态转发（`ssh -D`）把节点变成免费 SOCKS 代理跳板。SSH 走代理必然超时，表现为 `git push` / `git pull`（SSH 方式）、`ssh` 远程登录卡住无响应。

**规则设计**：用一条 `DST-PORT,22,DIRECT` 覆盖所有 SSH 目标（GitHub、Codeberg、自建仓库等），无需逐域名添加规则。

**fake-ip-filter 配合**：常用 Git 托管域名（`+.github.com`、`+.githubusercontent.com`、
`+.codeberg.org`、`+.gitlab.com`）已加入 `dns.fake-ip-filter`（blacklist 模式），
这些域名直接返回真实 IP 而非 fake-ip。作用是 fake-ip 模式下 DST-PORT,22,DIRECT
时无需反查 fake-ip→域名，消除 SSH 首连抖动。

**影响范围**：

| 连接方式 | 端口 | 走向 | 是否受机场封 22 影响 |
|---------|------|------|-------------------|
| SSH（`git@github.com:...`、`ssh user@host`） | 22 | DIRECT 直连 | 否（绕过代理） |
| HTTPS（`https://github.com/...`） | 443 | 代理节点 | 否（443 不封） |

### DNS 与 systemd-resolved

参考配置原带的 `dns.listen: 0.0.0.0:53` 会与系统默认运行的 `systemd-resolved`（占用 `127.0.0.53/54:53`）冲突。本模板已**注释掉 `dns.listen`**，改由 `tun.dns-hijack: any:53` 在 tun 层接管 DNS 解析，二者各司其职，无需关闭 resolved。

### firewalld

系统默认启用 firewalld（nftables backend）。**实测 `auto-redirect: true` 会与之冲突**：
auto-redirect 用 nftables 在 output 链重定向流量，创建规则时 netlink 返回 EEXIST（`file exists`），
导致 TUN listening 失败、tun 接口从未创建。
本配置已关闭 `auto-redirect`，仅靠 `auto-route`（路由表 2022 + ip rule），
纯路由表方式不碰 nftables，与 firewalld 真正独立共存。

`deploy.sh` 会把 `mihomo` tun 接口置入 `trusted` zone 放行流量（best-effort）。

### SELinux

mihomo 二进制为 `bin_t`、无专属 SELinux 策略，运行于 `unconfined_service_t`（放行域），正常情况下不会被拦截。若启动后功能异常，先查 AVC：

```bash
sudo ausearch -m AVC -ts recent | grep -i clash
```

若有 denial，可用 `audit2allow` 生成补丁策略或临时 `sudo setenforce 0` 排查（排查后务必 `setenforce 1` 恢复）。

### 不可变系统路径

- `/etc/clash-meta/`：可写（rpm-ostree 三路合并），用户新建文件升级时保留
- `/var/lib/clash-meta/`：可写，mihomo 工作目录
- `/usr/lib/systemd/system/`：只读，unit 定制走 `/etc/systemd/system/clash-meta.service.d/*.conf` drop-in

## 参考

- 配置主体搬运自 [MiyakoMeow/nixos-config](https://github.com/MiyakoMeow/nixos-config/blob/main/modules-physical/proxy-mihomo/mihomo.yaml)，针对 Kinoite + 环境变量订阅做了适配
- 规则集来自 [Sukka/Surge](https://ruleset.skk.moe/)
- mihomo 官方文档：<https://wiki.metacubex.one/>
