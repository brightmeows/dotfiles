# MiyakoMeow Rime 配置

Fcitx5 Rime 输入法配置，单方案：**小鹤双拼**（rime-ice 雾凇方案基座）。
五笔98 于 2026-08-29 移除（历史版本见 git）。

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

## 方案

| 方案 ID | 名称 | 基座 | 词库 |
|---------|------|------|------|
| `double_pinyin_flypy` | 小鹤双拼 | rime-ice 雾凇 flypy（rime-ice-data 包） | `custom` 聚合（见下） |

雾凇基座自带：英文混输（melt_eng）、v 模式符号、lua 农历、部件拆字、emoji 开关。

## 快捷键一览

| 快捷键 | 功能 | 层级 |
|--------|------|------|
| **Ctrl+Space** | 中/英切换 | fcitx5 |
| **Ctrl+Shift+3** | 符号分类入口（候选窗提示，再按 1-9 选类） | Rime |
| **Ctrl+Shift+4** | 简繁切换 | Rime |
| `-` / `=` 或 `[` / `]` | 翻页 | Rime |
| `Tab` / `Shift+Tab` | 按音节移动光标 | Rime |
| `Alt+←` / `Alt+→` | 按音节移动光标 | Rime |
| 小键盘数字/运算符 | 等同主键盘（输入时可用） | Rime |

## 标点符号

中文状态（Rime 激活时）全程中文标点，一键直出、不弹候选。半角模式对齐 fcitx5 官方中文标点表（`punc.mb.zh_CN`）；全角模式（F4 方案选单内可临时切换）为真全角，字母数字同样转全角。

| 按键 | 半角（默认） | 全角 |
|------|------------|------|
| `,` `.` `;` `:` `!` `?` | `，` `。` `；` `：` `！` `？` | 同左 |
| `'` `"` | `‘’`、`“”` 交替 | 同左 |
| `(` `)` `<` `>` `[` `]` | `（）` `《》` `【】` | 同左 |
| `{` `}` `\` `^` `_` | `「」` `、` `……` `——` | 同左 |
| `` ` `` | `·` | `·` |
| `$` | `¥` | `￥` |
| `~` | `～` | `～` |
| `/` `\|` `@` `#` `%` `&` `*` `-` `+` `=` | 保持半角 | `／` `｜` `＠` `＃` `％` `＆` `＊` `－` `＋` `＝` |

- 中英标点开关无快捷键、不写入记忆；需要英文标点时用 `Ctrl+Space` 切 keyboard-us，或在 F4 方案选单内临时切换（`Ctrl+Shift+3` 已改作符号分类入口）
- 数字后输入 `,` `.` `:` 保持半角以支持小数（`punctuator/digit_separators`）
- 映射定义在 `default.custom.yaml` 的 `punctuator/{half_shape,full_shape}`；patch 语义为整体覆盖节点，改动时须写完整映射表

## 符号输入

中文状态下 `Ctrl+Shift+3` 调出符号分类，候选窗列出九个分类，再按对应数字进入该类符号表（合计两键）。第一层提示项只作展示，直接按数字即可；按空格会把提示文字打出来。

| 数字 | 分类 | 内容举例 |
|------|------|---------|
| 1 | 标点 | 、。「」『』【】〈〉《》〃〄々〆〇 |
| 2 | 数学 | ± ÷ × ∈ ∏ ∑ √ ∞ ∠ ∥ ¬ ⊕ ∧ ∨ |
| 3 | 箭头 | ← → ↑ ↓ ↔ ↕ ⇐ ⇒ ⇑ ⇓ ➜ |
| 4 | 单位 | ℃ ℉ ‰ ㎜ ㎝ ㎞ ㎡ Ω Å |
| 5 | 货币 | ￥ ¥ € £ ￠ ¢ ₩ ₹ |
| 6 | 括号 | 「」『』“”‘’（）《》〈〉【】〖〗〔〕［］｛｝ |
| 7 | 带圈序号 | ⓪ ① ⑩ ㉑ ❶ ⓿ |
| 8 | 符号 | © ® ™ ☎ ☐ ☑ ☕ ♻ ⚠ ⚡ |
| 9 | 分数 | ½ ⅓ ¼ ⅕ ⅙ ⅛ ⅟ ↉ |

- 实现：快捷键注入入口标记 `ZQ`（避开 V 前缀命名空间与英文词条），数字经识别码 `ZQ1` 至 `ZQ9` 进入分类；别名用 `__include` 指向 rime-ice 原表，内容不重复维护
- rime-ice 自带的 206 张分类表不受影响，`Shift+V` 加分类码仍可用（如 `Vbd` 标点、`Vsx` 数学、`Vjt` 箭头、`Vdw` 单位、`Vhb` 货币、`Vjz` 括号、`Vfh` 符号、`Vszq` 带圈序号、`Vfs` 分数）
- 分类入口与别名定义在 `double_pinyin_flypy.custom.yaml`（`recognizer/patterns/punct` 与 `punctuator/symbols`），快捷键定义在 `default.custom.yaml` 的 `key_binder`

## 文件结构

```
~/.config/fcitx5/
├── profile                      # 输入法列表（keyboard-us + rime）
└── conf/
    ├── hotkey.conf              # 全局快捷键（Ctrl+Space trigger）
    └── globalhotkey.conf

~/.local/share/fcitx5/rime/
├── default.custom.yaml          # 全局设置（方案列表、按键、标点）
├── double_pinyin_flypy.custom.yaml  # 小鹤双拼键级适配
├── custom.dict.yaml             # 聚合词库（cn_dicts + zhwiki + moegirl + 补字）
└── build/                       # Rime 编译输出（自动生成）

# 词库来源（全部为包，无手工下载）：
#   /usr/share/rime-data/cn_dicts/        rime-ice-data（AUR）
#   /usr/share/rime-data/zhwiki.dict.yaml rime-pinyin-zhwiki（官方 extra）
#   /usr/share/rime-data/moegirl.dict.yaml rime-pinyin-moegirl（AUR）
```

## 配置要点

- **双拼默认中文**（`switches/@0/reset: 0`，键级 patch 保留雾凇全部开关）
- **Rime 内中英切换全部禁用**（`ascii_composer` 所有键设为 `noop`）
- **候选词 9 个**（`menu/page_size: 9`）
- **顶字上屏**（`auto_select: true`），无重码自动上屏
- **关闭自学习**（`enable_user_dict: false`），词序固定为词库权重，不记录用户词典、不自动调频
- **中文状态全程中文标点**（半角表对齐 fcitx5 中文标点表，全角表为真全角；中英标点无快捷键、不记忆，见“标点符号”节）

## 自定义词库

`custom.dict.yaml` 通过 `import_tables` 聚合：cn_dicts（雾凇词库：8105 字表 + base/ext/tencent）、zhwiki、moegirl，并在 `...` 分隔符后补收缺失字音（如“垌 dòng”）。rime 编译时合并为单个 `table.bin`。

**添加字/词**：在 `...` 之后追加一行，列以 Tab 分隔：

```
垌	dong
你好	ni hao	500
```

- 拼音用全拼书写，多音节词以空格分隔音节
- 权重可省略（取默认词频）；填整数频次可调整候选排序
- 编辑后须重新部署（见下节）

## 部署

```bash
# 修改源文件后应用
chezmoi -S . apply

# 重新部署 Rime（重启 fcitx5 触发词库重新编译；
# fcitx5 由 omarchy-fcitx5.service 管理，勿手动 setsid 拉起）
systemctl --user restart omarchy-fcitx5
```
