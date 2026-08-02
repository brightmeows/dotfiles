# 工程质量准则

> 铁律：客观、可被工具/编译器/校验器判真伪的硬规则。

## 确定性优先

能用工具/编译器/校验器自动处理的事，不手动做。

- **读**（分析/检查）：用 linter、类型检查器、schema 校验器等，而非人工审阅
- **写**（执行/修复）：用格式化、`--fix`、codemod 等自动功能

**工具真空带**：目标格式无现成校验器/linter（如 KDL、Nu、自定义 JSONC）时，不得用弱校验（如纯 diff）冒充强校验（语义校验）；提交说明须注明该处为人工校验，确定性低于工具校验。

## 知识时效

你作为助手自身的记忆数据有截止日期，落后当前半年以上。遇到版本号、API 签名、配置项、CLI 参数等**可变事实**，先联网搜索确认，不依赖记忆。

## 行为修正

本节记录常见易错行为及其修正。

### 中文引号

**简体中文横排必须使用弯引号**（全角、有向），遵循 GB/T 15834-2011：

- 双引号用 **“ ”**（U+201C/201D），单引号用 **‘ ’**（U+2018/2019）
- 嵌套顺序：先双后单（“…‘…’…”）

**严禁**以下引号：

- 直引号 `" '`（半角，U+0022/0027）——仅代码字符串标识可用
- 全角无向引号 `＂`（U+FF02）——兼容字符，中文不使用
- 直角引号 `「 」『 』`（U+300C-300F）——繁中/日文/简中直排的标准，非简中横排所用

#### 检查命令参考

检查 Markdown 文件：

````bash
python3 - 文件.md << 'PYEOF'
import re, sys
in_code = False
with open(sys.argv[1], encoding="utf-8") as fh:
    for i, line in enumerate(fh, 1):
        if re.match(r"^(```|~~~)", line):
            in_code = not in_code
            continue
        if in_code:
            continue
        if re.search("[\u0022\u0027\uFF02\u300C\u300D\u300E\u300F]", re.sub(r"`[^`]*`", "", line)):
            print(f"{i}: {line.rstrip()}")
PYEOF
````

## 文档同步

修改仓库功能或配置后，必须同步更新相关文档。

- 面向代理的文档的同步（仓库各 `AGENTS.md` 等），使用 `writing-agent-docs` 技能及其子技能。

## 提交规范

**格式**：Conventional Commits，`type(scope)!: subject`。`!` 表示 breaking change、放在冒号前。scope 为变更模块名（小写 kebab-case），如 `core`, `api`, `cli`, `ui`, `deps`。

**反模式**：

- 笼统消息（`update`, `fix`, `changes`）

## 提交粒度

- **高频小提交优先**：粒度随意、信息随意，执行期零纠结
- **每个提交可独立验证**：可安全 revert、不破坏仓库自洽
- **工具链门槛**：项目有工具链配置时，每个提交至少通过基本检查（如 `pnpm check`、`cargo check`、lint）
