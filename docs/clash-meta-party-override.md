# clash-meta 覆写壳拆分：Party / Verge 系客户端共用规则包

`config.yaml.tmpl` 原本是自包含全家桶（dns / tun / sniffer / providers / groups / rules 全在一处），本机之外的其他设备用 Clash Party、Clash Verge Rev 等客户端时，这套规则体系无法复用。
2026-10 拆分后，规则体系从单一模板变为“共享事实源 + 双消费点”结构，其他设备经 GitHub raw URL 导入覆写壳即可获得同一套分流。

## 事实源架构

| 事实源 | 内容 | 消费点 |
|---|---|---|
| `.chezmoidata/clash-meta.yaml`（仓库根） | 地区列表（name / emoji / filter 锚名） | 主模板 + 壳模板，模板变量 `$.regions` |
| `dot_config/clash-meta/.fragments/filters.part.yaml` | Filter* 地区正则锚定义 | 双模板 include |
| `dot_config/clash-meta/.fragments/rule-providers.part.yaml` | RuleSet* 锚 + rule-providers（sukkaw ruleset） | 双模板 include |
| `dot_config/clash-meta/.fragments/rules.part.yaml` | 静态规则行（SSH/RustDesk/BOF 直连 + RULE-SET 分流 + MATCH） | 双模板 include（两空格缩进文本碎片，拼进 `rules:` 列表） |
| `dot_config/clash-meta/party-override.yaml.tmpl` | 壳版组结构（顶层 / 地区 / 分流 / BOF） | `gen-party-override.sh` 渲染 |
| `dot_config/clash-meta/party-override.yaml` | 生成物，进仓库 | GitHub raw URL 分发 |

改动流向：改地区加节点池只动 chezmoidata；改规则集或规则行只动对应片段；改完跑 `gen-party-override.sh` 重新生成壳。pre-commit 在相关文件被暂存时运行 `gen-party-override.sh --check`，忘跑生成会被拦下。

`.fragments/` 与 `party-override.yaml` 在 `.oxfmtrc.jsonc` 排除格式化：前者是缩进敏感的文本碎片（不是完整 yaml 文档，格式化会破坏 include 拼接），后者是生成物（格式化即与模板漂移）。模板与生成物同时在 `.chezmoiignore` 排除部署——两个源条目映射同一目标路径，chezmoi 会报 inconsistent state。

## 壳与主配置的边界

壳只含 `proxy-groups`、`rule-providers`、`rules` 与锚定义伪键。以下内容留在主配置、不进壳，各有明确理由：

| 不进壳的内容 | 理由 |
|---|---|
| dns / tun / sniffer | 本机强耦合（systemd-resolved 抢 53、firewalld/ufw 回注、respect-rules 双死锁），且 Party / Verge 的接管配置优先级高于覆写，写了也会被打架 |
| 订阅级组（`⚡ X - 自动/手动选择`） | 壳侧订阅 URL 未知，组名无法静态化；`include-all` 地区组已覆盖选节点需求 |
| 订阅域名直连规则与 `nameserver-policy` | 消费 `~/.env_self` 的模板动态内容，且属于主配置的订阅死锁防御 |
| proxy-providers / NodeParam | 订阅注入是主配置专属逻辑，客户端有自己的订阅管理 |

壳版组结构的必要差异只有一处：`DomainGroupMembers` 锚与顶层组成员不含订阅级组。其余（组名、地区组字段、规则行）与主配置逐字段同源，由 `gen-party-override.sh` 生成时保证。

## 分发与导入

raw 地址（生成物，随 main 分支更新）：

```text
https://raw.githubusercontent.com/brightmeows/dotfiles/main/dot_config/clash-meta/party-override.yaml
```

- **Clash Party**：在“覆写”页 URL 导入，挂到目标订阅（或开全局）。
- **Clash Verge Rev**：作为全局扩展配置导入。两家对列表字段（`rules`、`proxy-groups`）均为整体替换：Party 的深度合并文档明确数组默认替换；Verge Rev v1.7+ 扩展配置的合并规则明确“列表和普通值整体替换”，机场订阅自带的 rules 与 proxy-groups 被壳完整换掉，无残留。

规则集下载（`rule-providers` 的 `proxy: 🚀 节点选择`）在壳侧同样成立：该组随壳定义，机场节点就位后规则集经代理拉取。

## 验证方法

```bash
# 1. 主配置回归：渲染 + 语义对比 + 语法校验
chezmoi execute-template < dot_config/clash-meta/config.yaml.tmpl > /tmp/after.yaml
python3 -c 'import yaml; assert yaml.safe_load(open("/tmp/after.yaml")) == yaml.safe_load(open("/tmp/before.yaml"))'
mihomo -t -d /tmp -f /tmp/after.yaml

# 2. 壳合法性：拼 dummy 节点基底后过 mihomo -t（壳是半份配置，不能单独 -t）
cat > /tmp/dummy.yaml << 'EOF'
mixed-port: 7890
mode: rule
proxies:
  - { name: dummy1, type: socks5, server: 127.0.0.1, port: 1080 }
EOF
cat /tmp/dummy.yaml dot_config/clash-meta/party-override.yaml > /tmp/combined.yaml
mihomo -t -d /tmp -f /tmp/combined.yaml

# 3. 生成物一致性（hook 同款命令）
bash dot_config/clash-meta/gen-party-override.sh --check
```

## 决策记录

- **标准键写法，不用 Party 特有的 `!` / `+` 修饰符**：目标客户端是 Party + Verge 系多客户端，整体替换语义两家通用；追加语法本场景用不到。
- **chezmoidata + 双模板 + 生成脚本**：复用仓库 gen-models 的“单一源 + 生成物进仓库 + pre-commit --check”既有模式；漂移面压到组循环代码本身（数据与规则全部单源）。
- **generate 物进仓库而非 chezmoi 渲染分发**：Party 从 GitHub raw 拉取，渲染产物落 `$HOME` 不进 git，无法满足分发；生成物路径与 tmpl 的渲染目标冲突时，以 ignore 排除部署解决。
- **BOF 组随壳分发**：规则行同源原则，组不进则 `bmsoffighters.net` 规则悬空；默认 DIRECT 对其他设备无害。
