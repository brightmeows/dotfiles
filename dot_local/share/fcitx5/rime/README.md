# MiyakoMeow Rime 配置

Fcitx5 Rime 输入法配置，双方案：**小鹤双拼** + **五笔98**。

## 方案一览

| 方案 ID | 名称 | 类型 | 切换 |
|---------|------|------|------|
| `double_pinyin_flypy` | 小鹤双拼 | 双拼（自然码码表） | Ctrl+Shift+Space 或 Ctrl+` |
| `wubi98` | 五笔98 | 形码（五笔字型98版） | 同上 |

- **默认英文模式**（双拼）：打开即英文状态，减少终端/代码场景干扰
- **Ctrl+Space**：唯一中英切换键（禁用了 Shift/Ctrl 切换，避免误触）

## 功能特性

### 词库

| 词库 | 来源 | 说明 |
|------|------|------|
| **万象词库** (`rime_mint.*`) | oh-my-rime | 双拼主词库，含单字/基础/联想/兼容/关联约 30MB |
| **melt_eng** | 雾凇英文扩展 | 中英混输，双拼和五笔下均可输入英文单词 |
| **wubi98** | ibus-table + 五笔小筑 | 形码码表，约 98K 条目 |

### Emoji

输入中文后在候选区出现对应 Emoji。例如：
- 输入 `kaixin` → 候选 `开心 😄`
- 输入 `weixiao` → 候选 `微笑 😊`

开关：**Ctrl+Shift+E**（或输入法状态栏切换）

### 简繁切换

默认简体输出。**Ctrl+Shift+4** 切换简繁。

### 中英标点切换

**Ctrl+Shift+3** 在 `。，` / `.,` 之间切换。

### 翻页

- `-` / `=` 或 `[` / `]`

### 光标移动

- `←` / `→`：按字符移动
- `Shift+←` / `Shift+→`：按音节移动

### 小键盘

数字/运算符/回车映射到主键盘，输入时可用小键盘方便输入数字和表达式。

### Lua 处理器

- `switch_ascii.lua` — 接管中英切换，切换时自动上屏未确认输入
- `switch_schema.lua` — 接管方案切换，切换时自动上屏未确认输入

## 文件结构

```
~/.local/share/fcitx5/rime/
├── default.custom.yaml              # 全局设置（方案列表、按键、标点）
├── double_pinyin_flypy.custom.yaml  # 小鹤双拼自定义（万象词库、英文、Emoji）
├── wubi98.schema.yaml               # 五笔98 方案定义
├── wubi98.custom.yaml               # 五笔98 Lua processor
├── wubi98.dict.yaml                 # 五笔98 码表
├── meow_flypy.dict.yaml             # 双拼→万象的桥接词典
├── rime_mint.dict.yaml              # 万象主词典（导入子词典）
├── melt_eng.dict.yaml               # 英文词典
├── melt_eng.schema.yaml             # 英文方案
├── dicts/                           # 万象词库子文件（10 个）
│   ├── rime_mint.base.dict.yaml
│   ├── rime_mint.chars.dict.yaml
│   ├── rime_mint.ext.dict.yaml
│   ├── rime_mint.correlation.dict.yaml
│   ├── rime_mint.compatible.dict.yaml
│   ├── rime_ice.en.dict.yaml
│   ├── rime_ice.en_ext.dict.yaml
│   ├── rime_ice.others.dict.yaml
│   ├── other_kaomoji.dict.yaml
│   └── custom_simple.dict.yaml
├── opencc/                          # OpenCC 配置（Emoji 等）
│   ├── emoji.json
│   ├── emoji.txt
│   ├── others.txt
│   └── spoken.txt
└── lua/
    ├── switch_ascii.lua
    └── switch_schema.lua
```

## 快捷键一览

| 快捷键 | 功能 |
|--------|------|
| **Ctrl+Space** | 切换中/英 |
| **Ctrl+Shift+Space** 或 **Ctrl+`** | 切换方案（双拼 ↔ 五笔） |
| **Ctrl+Shift+E** | 切换 Emoji |
| **Ctrl+Shift+4** | 切换简繁 |
| **Ctrl+Shift+3** | 切换中英标点 |
| `-` / `=` | 翻页 |
| `[` / `]` | 翻页 |
| `Tab` / `Shift+Tab` | 按音节移动光标 |
| `Alt+←` / `Alt+→` | 按音节移动光标 |
| 小键盘数字/运算符 | 等同主键盘（输入时可用） |

## 部署

```bash
# 修改源文件后应用
chezmoi -S . apply

# 触发 Rime 重新部署
fcitx5-remote -r
```

## 参考

- [oh-my-rime (薄荷输入法)](https://github.com/Mintimate/oh-my-rime) — 万象词库、配置参考
- [雾凇拼音](https://github.com/iDvel/rime-ice) — 英文词库
