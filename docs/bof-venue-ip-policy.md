# BOF 会场 IP 管控与 mihomo 分流记录

记录日期：2026-10-20。本文是发现记录与改动计划，截至记录时配置尚未修改。

## 结论

THE BMS OF FIGHTERS（BOF）会场对访问没有严格 IP 管控，对投稿有明确的来源限制。当前 mihomo 配置把 bmsoffighters.net 落到 MATCH 默认代理，出口是机场机房 IP，投稿会违反禁则第 9 条。计划把 BMS 组改名为 BOF 组、默认直连，并把会场域名纳入该组。

## 会场侧

- 站点：bmsoffighters.net，SAKURA Internet 日本（59.106.171.86，AS9370），nginx，无 Cloudflare 前置，无地域封锁。
- 2026-10-20 实测：从新加坡机房 IP 访问 BOF22 会场返回 200；访问层不拦代理或海外 IP。
- 管控在投稿与评价层，依据 BOF22 规则：
  - 禁则 9：禁止经 VPN、托管服务（hosting）、代理投稿；IPv4 over IPv6 的 VPN 例外；IPv6 投稿后转 IPv4 视为违规，全部投稿无效。
  - 禁则 13：禁止学校、公共设施、移动运营商或格安 SIM 经投稿。
  - 同一 provider、地域、国家连续违规会整段限制；对 VPN 和托管服务“厳しく処置”。
  - 具体检测手段未公开，规则只说明“対策の観点上不正手段の具体的な手法は割愛”；判定依据是投稿来源 IP 的 ASN、归属与行为关联。
- 结论：这不是 IP 白名单，能打开页面不代表能安全投稿。

来源：

- <https://bmsoffighters.net/bof22/rule.html>
- <https://bmsoffighters.net/bof22/rule_en.html>

## 当前 mihomo 实测

配置里没有 bmsoffighters.net 规则，只有 manbow.nothing.sh 走 `🎵 BMS`。BOF 会场命中最后一条 MATCH：

```text
bmsoffighters.net
  -> 🚀 节点选择
  -> ⚡ LIANGXINYUN - 自动选择
  -> 🇸🇬新加坡高速01|BGP|CTCUCM
```

出口：66.90.98.34，新加坡，AS30058 FDCSERVERS，机房托管段。用这个出口投稿或评价会踩禁则 9；机场节点是共享 IP，连坐风险更高。

`ipv6: false`，BOF 域名只有 A 记录、无 AAAA，实际全程 IPv4，不会触发“IPv6 投稿后转 IPv4”的违规组合。

本机接入：有线，网关 192.168.101.1，公网 IPv6 2408:825c（联通段），特征像联通家宽；若实际是校园网、宿舍公共网或移动热点，直连也会命中禁则 13，需另行确认。

## 计划改动

- `🎵 BMS` 组改名 `🎵 BOF`，成员单独定义，首项 DIRECT 作为默认出口。
- 规则加入 `DOMAIN-SUFFIX,bmsoffighters.net,🎵 BOF`；`manbow.nothing.sh` 保留在同一组。
- 副作用：manbow 谱面站默认也走直连（日本源站，直连可能变慢）；需要时从组内切到订阅或地区节点。
- 投稿时浏览器不要另开代理扩展或其它 VPN；保持 IPv4 单栈。

## 验证

```bash
mihomo -t -d /tmp -f ~/.config/clash-meta/config.yaml
curl -s http://127.0.0.1:9090/proxies | jq -r '.proxies["🎵 BOF"].now'   # 应为 DIRECT
curl -s -o /dev/null https://bmsoffighters.net/
curl -s http://127.0.0.1:9090/connections | jq -r '.connections[] | select((.metadata.host // "")|test("bmsoffighters";"i")) | [.metadata.host, (.chains|join(" <- "))] | @tsv'
```

`/connections` 的 chains 应为 DIRECT，destinationIP 为 59.106.171.86。

## 未决

- 确认本机接入是住宅固网而非校园网、公共设施或移动网络。
- 直连无法消除 CGNAT 共享 IP、同 provider 他人违规连坐、运营裁量等残留风险。
- 投稿时间窗口以当届规则为准；BOF22 规则页最后更新 2026-09-28。
