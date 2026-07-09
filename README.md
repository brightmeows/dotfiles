# MiyakoMeow 的 Dotfiles 配置文件

由 [chezmoi](https://www.chezmoi.io/) 管理。

## 应用步骤

```bash
git clone git@github.com:MiyakoMeow/dotfiles
cd dotfiles
chezmoi apply -S .
chezmoi apply -S .
```

## 更新步骤

```bash
chezmoi update -S .
```

## 参考列表

### Skill

- [obra/superpowers](https://github.com/obra/superpowers) — Code review skills（receiving / requesting code review）、code-reviewer subagent
- [apollographql/skills](https://github.com/apollographql/skills) — rust-best-practices skill
- [getsentry/skills](https://github.com/getsentry/skills) — structuring-agents-md skill
- [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) — caveman skill 系列
- [jnMetaCode/superpowers-zh](https://github.com/jnMetaCode/superpowers-zh) — superpowers 中文版

#### npx skills 小贴士：按来源卸载全部 skill

`npx skills remove` 不支持按 package source 批量卸载（[#1034](https://github.com/vercel-labs/skills/issues/1034)），
但可通过锁文件变通实现：

```bash
# 卸载所有来自 obra/superpowers 的 skill（全局）
npx skills rm -g $(jq -r --arg src "obra/superpowers" \
  '.skills | to_entries[] | select(.value.source == $src) | .key' \
  ~/.agents/.skill-lock.json) -y
```

原理：全局锁文件 `~/.agents/.skill-lock.json` 中每个 skill 条目
记录了 `source` 字段（如 `"obra/superpowers"`），
`jq` 过滤出匹配的 skill 名后传给 `npx skills rm`。
