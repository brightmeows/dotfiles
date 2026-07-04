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

metacubexd 由 mihomo `external-ui` 本地托管（首次启动自动从 GitHub 下载到 `/var/lib/clash-meta/ui`）。`external-controller` 监听 80 端口，浏览器按 RFC 6761 将 `clash.localhost` 自动解析为 127.0.0.1，故无需 `:9090`、无需 `hosts` / `/etc/hosts`：

- 面板：`http://clash.localhost/ui/`
- 直连：`http://127.0.0.1/ui/`

手动更新面板：`curl -X POST http://127.0.0.1/upgrade/ui`

> `external-controller` 端口与 `external-ui` serve 在 mihomo **启动时**绑定，payload 热加载不触发；改这两项后需 `deploy.sh` 重启生效。

## 已知约束

本配置针对 Fedora Kinoite（原子化系统）调校，部署时需注意以下几点。

### 本地网络直连

`tun.route-exclude-address` 已排除全部本地网段，确保局域网通信、设备发现、组播**不走代理**：

- 私有段：`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`
- loopback：`127.0.0.0/8`
- link-local（mDNS/SSDP/zeroconf）：`169.254.0.0/16`
- 组播（mDNS/SSDP/IGMP）：`224.0.0.0/4`
- IPv6 对应段：`fc00::/7`、`fe80::/10`、`ff00::/8`

验证：`ip route get 169.254.1.1` 应走物理网卡（如 `wlp1s0`）而非 `mihomo`。

### DNS 与 systemd-resolved

参考配置原带的 `dns.listen: 0.0.0.0:53` 会与系统默认运行的 `systemd-resolved`（占用 `127.0.0.53/54:53`）冲突。本模板已**注释掉 `dns.listen`**，改由 `tun.dns-hijack: any:53` 在 tun 层接管 DNS 解析，二者各司其职，无需关闭 resolved。

### firewalld

系统默认启用 firewalld，它通过 nftables 管理自己的表，与 mihomo `auto-redirect` 的 nft 表互相独立、可共存。`deploy.sh` 会把 `mihomo` tun 接口置入 `trusted` zone 以放行其流量（best-effort，失败不阻断主流程）。

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
