---
name: querying-clippy-lints
description: 当用户查询 Clippy lint 的含义、分组、级别、适用性或版本时使用；顺带提及 lint 名而任务与 lint 信息无关时不加载。
---

# 查询 Clippy Lint 信息

## 概览

Clippy lint 文档发布在 `https://rust-lang.github.io/rust-clippy/`，是一个单页 HTML 应用。所有 lint 元数据（名称、分组、级别、版本、适用性、说明）在构建时嵌入页面——无需后端查询。

页面有 **800+ lint**，内容约 500KB。URL 参数（`?groups=`、`?levels=`、`?search=`）和锚点（`#lint_name`）均为**客户端 JavaScript 行为**，服务端无视这些参数。**无法通过简单 URL 请求获得筛选结果。**

本 skill 提供两种查询方式，**优先使用脚本**。

---

## 查询方式

### 方式一（推荐）：使用解析脚本 `clippy-lint-query.py`

> 脚本与本 SKILL.md 同目录。

Python 3 脚本，可下载/解析 Clippy lint 文档页面，按条件筛选并输出。

#### 推荐工作流：curl → 脚本（缓存自动管理）

```bash
# 1. 下载一次（~3 秒），缓存自动写至 /tmp/clippy-lints-<VER>.html
python3 clippy-lint-query.py --group pedantic --table

# 2. 后续查询复用缓存（瞬时完成）
python3 clippy-lint-query.py --search needless_return --docs
python3 clippy-lint-query.py --applicability MachineApplicable --table
python3 clippy-lint-query.py --level deny --since 1.70 --table

# 3. 缓存过期后强制重新下载
python3 clippy-lint-query.py --fetch --group perf --table
```

#### 指定版本

```bash
# stable（默认）
python3 clippy-lint-query.py --version stable --group pedantic

# master（最新未发布 lint）
python3 clippy-lint-query.py --version master --since 1.90 --table

# 特定版本（如 1.80）
python3 clippy-lint-query.py --version 1.80 --search vec_box
```

#### 完整参数

| 参数 | 说明 | 示例 |
|------|------|------|
| `--version VER` | 文档版本：`stable`、`master`、`1.80`（默认 stable） | `--version master` |
| `--cache FILE` | 指定缓存 HTML 文件路径 | `--cache ./page.html` |
| `--fetch` | 强制重新下载，更新缓存 | `--fetch` |
| `--search NAME` | 按名称搜索（子串匹配，忽略大小写） | `--search needless` |
| `--group GROUP` | 按分组筛选 | `--group pedantic` |
| `--level LEVEL` | 按级别筛选 | `--level deny` |
| `--applicability VAL` | 按适用性筛选 | `--applicability MachineApplicable` |
| `--since VER` | 最低版本（如 1.60） | `--since 1.70` |
| `--until VER` | 最高版本（如 1.70） | `--until 1.70` |

| 输出参数 | 效果 |
|---------|------|
| `--table`（默认） | 对齐文本表格 |
| `--docs` | 完整文档（说明、示例、配置） |
| `--json` | JSON Lines 格式，每行一个 lint 对象 |

> `--json` 输出为 JSON Lines（每行一个独立 JSON 对象，非数组）。字段：`id`、`group`、`level`、`version`、`applicability`；加 `--docs` 时增加 `docs` 字段。

### 方式二（备用）：手动获取页面后搜索

当 Python 不可用时，用环境的网页提取工具（如 `anysearch_extract`）获取页面，在返回文本中搜索：

- 按名称：搜索 `"lint_name"`（lint 名前有 `¶` 标记）
- 按分组+级别：搜索 `"group level"`（如 `restriction allow`、`correctness deny`）
- 按版本：搜索 `Added in: X.XX.0`
- 按适用性：搜索 `Applicability: X`

---

## 源码位置

Lint 定义在 `clippy_lints/src/` 目录下：

- 每个 lint（或关联组）对应一个文件或模块
- lint 结构体上的文档注释 → 官网的 `docs` 字段
- 通过 `declare_clippy_lint!` 宏注册

查找某 lint 的源码：

```
https://github.com/rust-lang/rust-clippy/blob/master/clippy_lints/src/{lint_name}.rs
```

---

## 常见查询模式

| 用户提问 | 做法 |
|---------|------|
| “`needless_return` 是做什么的？” | `python3 clippy-lint-query.py --search needless_return --docs` |
| “列出所有 pedantic lint” | `python3 clippy-lint-query.py --group pedantic` |
| “1.70+ 中 warn 级别的 correctness lint” | `python3 clippy-lint-query.py --group correctness --level warn --since 1.70` |
| “哪些 lint 是 MachineApplicable？” | `python3 clippy-lint-query.py --applicability MachineApplicable` |
| “这个 lint 在最新版里还有吗？” | `python3 clippy-lint-query.py --version master --search lint_name` |
| “所有 deny 级别的 lint” | `python3 clippy-lint-query.py --level deny` |
| “1.80 之后新增了哪些 lint” | `python3 clippy-lint-query.py --since 1.80` |
| “获取 1.65 版本的文档” | `python3 clippy-lint-query.py --version 1.65 --search vec_box --docs` |

---

## 何时不使用本 Skill

- 用户问的是 `rustc` 内置 lint（应查编译器文档）
- 问题涉及 `clippy.toml` 配置（应查 [Clippy 配置手册](https://doc.rust-lang.org/clippy/)）
