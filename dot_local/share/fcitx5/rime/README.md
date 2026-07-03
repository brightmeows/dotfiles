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

- **双拼词典**：使用 `custom` 词库（系统 luna_pinyin 底座 + rime_ice 现代词库 + zhwiki 维基百科 + moegirl 萌娘百科 + 自定义补充）
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
├── custom.dict.yaml            # 自定义词库（import luna_pinyin + rime_ice + zhwiki + moegirl + 补字）
├── wubi98.schema.yaml           # 五笔98 方案定义
├── wubi98.dict.yaml             # 五笔98 码表
├── cn_dicts/                    # rime_ice 词库（8105/base/ext/tencent，由脚本下载）
├── build/                       # Rime 编译输出（自动生成）
├── lua/                         # 当前为空（无自定义处理器）
└── opencc/                      # （保留目录，未使用）

~/.local/bin/
└── fetch-rime-dict.sh          # 下载第三方词库（rime_ice/zhwiki/moegirl，不入版本控制）

# 第三方词库（由脚本下载，不入版本控制）：
# ~/.local/share/fcitx5/rime/cn_dicts/*.dict.yaml   ~44 MB（rime_ice 通用词库）
# ~/.local/share/fcitx5/rime/zhwiki.dict.yaml       ~53 MB（维基百科词条）
# ~/.local/share/fcitx5/rime/moegirl.dict.yaml      ~4 MB（萌娘百科词条）
```

## 配置要点

- **双拼默认中文**（`ascii_mode reset: 0`），激活即可输入
- **Rime 内中英切换全部禁用**（`ascii_composer` 所有键设为 `noop`）
- **候选词 9 个**（`menu/page_size: 9`）
- **顶字上屏**（`auto_select: true`），无重码自动上屏
- **直接上屏标点**（`half_shape` 符号直接输出，不弹出选单）
- **关闭自学习**（`enable_user_dict: false`），词序固定为词库权重，不记录用户词典、不自动调频

## 自定义词库

`custom.dict.yaml` 供双拼方案使用，通过 `import_tables` 聚合多组词库：系统 `luna_pinyin`（底座，始终存在）、rime_ice 现代词库（8105 字表 + base/ext/tencent）、zhwiki、moegirl，并补收缺失字音（如“垌 dòng”）。rime 编译时合并为单个 `table.bin`。

**添加字/词**：在文件 `...` 分隔符之后追加一行，列以 Tab 分隔：

```
垌	dong
你好	ni hao	500
```

- rime 不区分“字库”与“词库”，单字、词组格式一致
- 拼音用全拼书写，多音节词以空格分隔音节
- 权重可省略（取默认词频）；填整数频次可调整候选排序
- 编辑后须重新部署（见下节）

## 第三方词库

rime_ice（雾凇拼音）、zhwiki（维基百科词条）、moegirl（萌娘百科词条）为第三方大数据文件，**不入版本控制**，由 `fetch-rime-dict.sh` 拉取（rime_ice 从 git raw、其余从 release）。`custom.dict.yaml` 通过 `import_tables` 将它们与系统 `luna_pinyin` 底座一并编译进单个 `table.bin`。

rime_ice 提供现代精校通用词库（基础词、扩展词、腾讯词向量），是系统 luna_pinyin（2018 版）的超集与现代化替代。其计算机/AI 词覆盖加上 zhwiki，已能兼顾日常技术词汇输入。

```bash
# 首次 / 更新（默认拉取全部；可指定单个如 moegirl）
fetch-rime-dict.sh
fetch-rime-dict.sh moegirl

# 然后重启 fcitx5 重新编译
```

新机器部署 dotfiles 后须手动跑一次脚本拉取词库。加新词库只需在脚本的 `REGISTRY` 追加一行，再在 `custom.dict.yaml` 的 `import_tables` 加对应项。

## 部署

```bash
# 修改源文件后应用
chezmoi -S . apply

# 重新部署 Rime（必须重启 fcitx5；fcitx5-remote -r 仅 reload 配置，不触发词库重新编译）
pkill -x fcitx5 && sleep 1 && setsid fcitx5 </dev/null >/dev/null 2>&1 &
```
