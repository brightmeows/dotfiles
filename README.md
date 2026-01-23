修改自 [Isoheptane/dotfiles](https://github.com/Isoheptane/dotfiles/)。
# Dotfiles 配置文件

由 [chezmoi](https://www.chezmoi.io/) 管理。

## 安装与使用

### 前置要求
首先安装 chezmoi：
```sh
# 大多数系统
curl -sfL https://git.io/chezmoi | sh

# 或使用包管理器
# NixOS: nix-env -iA nixpkgs.chezmoi
# macOS: brew install chezmoi
# Arch: pacman -S chezmoi
# Ubuntu/Debian: apt install chezmoi
```

### 应用此配置

#### 快速开始（一次性设置）
```sh
# 一键克隆并应用
chezmoi init --apply https://github.com/yourusername/dotfiles.git
```

#### 手动设置
```sh
# 克隆仓库
git clone https://github.com/yourusername/dotfiles.git ~/.local/share/chezmoi

# 初始化 chezmoi
chezmoi init

# 应用配置文件
chezmoi apply
```

### 日常使用命令

#### 管理你的配置文件
```sh
# 应用所有配置文件到主目录
chezmoi apply

# 检查状态（会显示什么变化）
chezmoi status

# 显示源文件和目标文件的差异
chezmoi diff

# 仅应用特定文件
chezmoi apply ~/.config/hypr/hyprland.conf

# 从主目录更新文件回源
chezmoi re-add ~/.config/hypr/hyprland.conf

# 添加新文件到 chezmoi 管理
chezmoi add ~/.config/new-file.conf
```

#### Git 操作
```sh
# 拉取最新远程更改
chezmoi source pull

# 推送你的更改到远程
chezmoi source push

# 查看源文件中的更改
chezmoi source status

# 一键提交并推送
chezmoi source add -A && chezmoi source commit -m "更新配置" && chezmoi source push
```

#### 高级用法
```sh
# 直接编辑管理的文件
chezmoi edit ~/.config/hypr/hyprland.conf

# 查看会创建哪些管理的文件
chezmoi managed

# 从 chezmoi 管理中移除文件
chezmoi forget ~/.config/hypr/hyprland.conf

# 使用详细输出运行 chezmoi
chezmoi -v apply

# 使用 dry-run 查看会发生什么但不实际更改
chezmoi --dry-run apply
```

### 仓库结构

```
dotfiles/
├── .chezmoi.toml*         # Chezmoi 配置文件
├── hypr/                  # Hyprland 配置
├── mako/                  # Mako 通知守护进程
├── niri/                  # Niri 窗口管理器
├── nushell/               # Nushell 配置
├── waybar/                # Waybar 配置
└── wofi/                  # Wofi 启动器
```

### 配置文件

#### .chezmoi.toml（可选）
在根目录创建 `.chezmoi.toml` 文件来自定义 chezmoi 行为：

```toml
[data]
    [data.nixos]
        is_nixos = "{{- eq .chezmoi.os \"linux\" -}}{{- if lookPath \"nixos-version\" }}true{{ else }}false{{ end -}}"
```

### 机器特定配置

使用模板处理不同配置：
```sh
# 创建模板文件
chezmoi add --template ~/.config/app/config.toml

# 带条件判断的模板内容示例：
{{ if eq .chezmoi.hostname "work-laptop" }}
# 工作专用设置
profile = "work"
{{ else }}
# 家庭设置
profile = "personal"
{{ end }}
```

### 故障排除

#### 常见问题
```sh
# 如果文件没有被应用，检查状态
chezmoi status

# 强制重新应用所有内容
chezmoi apply --force

# 移除所有管理的文件
chezmoi purge --force

# 重置 chezmoi 配置
rm -rf ~/.config/chezmoi ~/.local/share/chezmoi
```