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

- **双拼词典**：使用 `custom` 词库（继承内置 `luna_pinyin` + 自定义补充，见 `custom.dict.yaml`）
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
├── custom.dict.yaml            # 自定义词库（继承 luna_pinyin + 补充缺字）
├── wubi98.schema.yaml           # 五笔98 方案定义
├── wubi98.dict.yaml             # 五笔98 码表
├── build/                       # Rime 编译输出（自动生成）
├── lua/                         # 当前为空（无自定义处理器）
└── opencc/                      # （保留目录，未使用）
```

## 配置要点

- **双拼默认中文**（`ascii_mode reset: 0`），激活即可输入
- **Rime 内中英切换全部禁用**（`ascii_composer` 所有键设为 `noop`）
- **候选词 9 个**（`menu/page_size: 9`）
- **顶字上屏**（`auto_select: true`），无重码自动上屏
- **直接上屏标点**（`half_shape` 符号直接输出，不弹出选单）

## 自定义词库

`custom.dict.yaml` 供双拼方案使用，通过 `import_tables` 继承系统 `luna_pinyin` 全量词典（含单字与词组），再补收 luna_pinyin 缺失的字音（如“垌 dòng”）。rime 编译时将两者合并为单个 `table.bin`。

**添加字/词**：在文件 `...` 分隔符之后追加一行，列以 Tab 分隔：

```
垌	dong
你好	ni hao	500
```

- rime 不区分“字库”与“词库”，单字、词组格式一致
- 拼音用全拼书写，多音节词以空格分隔音节
- 权重可省略（取默认词频）；填整数频次可调整候选排序
- 编辑后须重新部署（见下节）

## 部署

```bash
# 修改源文件后应用
chezmoi -S . apply

# 重新部署 Rime（必须重启 fcitx5；fcitx5-remote -r 仅 reload 配置，不触发词库重新编译）
pkill -x fcitx5 && sleep 1 && setsid fcitx5 </dev/null >/dev/null 2>&1 &
```
