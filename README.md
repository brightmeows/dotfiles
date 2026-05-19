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
- [getsentry/skills](https://github.com/getsentry/skills) — agents-md skill
- [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) — caveman skill 系列
- [jnMetaCode/superpowers-zh](https://github.com/jnMetaCode/superpowers-zh) — superpowers 中文版

## Skill 配置记录

### 安装 rust-best-practices

```bash
npx --yes skills add apollographql/skills --yes --global --skill rust-best-practices --agent claude-code
```

## 存档：旧 Skill 配置记录

### 安装 superpowers

```bash
npx --yes skills add obra/superpowers --yes --global --skill "*" --agent claude-code
```

### 卸载 superpowers

```bash
npx --yes skills remove --yes --global brainstorming dispatching-parallel-agents executing-plans finishing-a-development-branch receiving-code-review requesting-code-review subagent-driven-development systematic-debugging test-driven-development using-git-worktrees using-superpowers verification-before-completion writing-plans writing-skills
```

### 安装 superpowers-zh

```bash
npx --yes skills add jnMetaCode/superpowers-zh --yes --global --skill "*" --agent claude-code
```

### 卸载 superpowers-zh

```bash
npx --yes skills remove --yes --global brainstorming dispatching-parallel-agents executing-plans finishing-a-development-branch receiving-code-review requesting-code-review subagent-driven-development systematic-debugging test-driven-development using-git-worktrees using-superpowers verification-before-completion writing-plans writing-skills chinese-code-review chinese-git-workflow chinese-documentation chinese-commit-conventions mcp-builder workflow-runner
```

### 安装 caveman

```bash
npx --yes skills add JuliusBrussee/caveman --yes --global --skill "*" --agent claude-code
```

### 卸载 caveman

```bash
npx --yes skills remove --yes --global caveman caveman-commit caveman-compress caveman-help caveman-review compress
```

### 安装 agents-md

```bash
npx --yes skills add getsentry/skills --yes --global --skill agents-md --agent claude-code
```
