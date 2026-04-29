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

## 其它配置记录

### 安装 superpowers

```bash
npx --yes skills add obra/superpowers --yes --global --skill "*" --agent pi --agent claude-code
```

### 安装 rust-best-practices

```bash
npx --yes skills add apollographql/skills --yes --global --skill rust-best-practices --agent pi --agent claude-code
```

### 安装 caveman

```bash
npx --yes skills add JuliusBrussee/caveman --yes --global --skill "*" --agent pi --agent claude-code
```
