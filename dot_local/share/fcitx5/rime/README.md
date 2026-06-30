# MiyakoMeow Rime 配置

Fcitx5 Rime 输入法配置，双方案：**小鹤双拼** + **五笔98**。

## 架构分工

```
fcitx5               Rime
─────────────────────────────────────────
Ctrl+Space           仅管理中文打字
keyboard-us ↔ rime   ascii_mode reset: 0
（中英切换）          无内部中英切换
```

- **Ctrl+Space** — fcitx5 在 keyboard-us（英文）和 rime（中文）间切换
- Rime 激活后**默认中文输入**，不管理中英切换
- 方案切换使用 Rime 内置 switcher

## 方案一览

| 方案 ID | 名称 | 类型 |
|---------|------|------|
| `double_pinyin_flypy` | 小鹤双拼 | 双拼（小鹤双拼布局，明月拼音词典） |
| `wubi98` | 五笔98 | 形码（五笔字型98版） |

- **双拼词典**：使用内置 `luna_pinyin`，无需额外词库文件
- **五笔词典**：使用自有 `wubi98.dict.yaml`（约 98K 条目）
- **拼音反查**（五笔下）：敲 `z` 前缀进入拼音反查

## 快捷键一览

| 快捷键 | 功能 | 层级 |
|--------|------|------|
| **Ctrl+Space** | 中/英切换 | fcitx5 |
| **Ctrl+Shift+`** 或 **F4** | 切换方案（双拼 ↔ 五笔） | Rime switcher |
| **Ctrl+Shift+3** | 中英标点切换 | Rime |
| **Ctrl+Shift+4** | 简繁切换 | Rime |
| `-` / `=` 或 `[` / `]` | 翻页 | Rime |
| `Tab` / `Shift+Tab` | 按音节移动光标 | Rime |
| `Alt+←` / `Alt+→` | 按音节移动光标 | Rime |
| 小键盘数字/运算符 | 等同主键盘（输入时可用） | Rime |

## 文件结构

```
~/.config/fcitx5/
├── profile                      # 输入法列表（keyboard-us + rime）
└── conf/
    ├── hotkey.conf              # 全局快捷键（Ctrl+Space trigger）
    └── globalhotkey.conf

~/.local/share/fcitx5/rime/
├── default.custom.yaml          # 全局设置（方案列表、按键、标点）
├── double_pinyin_flypy.custom.yaml  # 小鹤双拼自定义
├── wubi98.schema.yaml           # 五笔98 方案定义
├── wubi98.dict.yaml             # 五笔98 码表
├── build/                       # Rime 编译输出（自动生成）
├── lua/                         # 当前为空（无自定义处理器）
├── opencc/                      # （保留目录，未使用）
└── dicts/                       # （保留目录，未使用）
```

## 配置要点

- **双拼默认中文**（`ascii_mode reset: 0`），激活即可输入
- **Rime 内中英切换全部禁用**（`ascii_composer` 所有键设为 `noop`）
- **候选词 9 个**（`menu/page_size: 9`）
- **顶字上屏**（`auto_select: true`），无重码自动上屏
- **直接上屏标点**（`half_shape` 符号直接输出，不弹出选单）

## 部署

```bash
# 修改源文件后应用
chezmoi -S . apply

# 触发 Rime 重新部署
fcitx5-remote -r

# 或重启 fcitx5
pkill fcitx5 && sleep 1 && fcitx5 -d
```
