# 技能编写最佳实践（Anthropic 官方补充）

> 本文件仅保留 **writing-agent-docs（通用写作规则）与 writing-skills（SKILL.md 专属）未覆盖** 的 Anthropic 官方补充指导。简洁、渐进式披露、description 规范、命名、评估迭代等主题见那两个 skill。完整、随官方更新的原文见 [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)。

---

## 设定适当的自由度

将详细程度与任务的脆弱性和可变性相匹配。

**高自由度**（基于文本的指令）——适用于多种方法都可行、决策取决于上下文、启发式指导方法：

```markdown
## 代码审查流程
1. 分析代码结构和组织
2. 检查潜在 bug 或边界情况
3. 建议可读性和可维护性改进
4. 验证是否符合项目规范
```

**中自由度**（伪代码或带参数的脚本）——适用于存在偏好的模式、允许一定变化、配置影响行为。

**低自由度**（具体脚本，很少或无需参数）——适用于操作脆弱易错、一致性至关重要、必须遵循特定顺序：

````markdown
## 数据库迁移

精确运行此脚本：

```bash
python scripts/migrate.py --verify --backup
```

不要修改命令或添加额外参数。
````

**类比**：把 Claude 想象成探索路径的机器人——两边是悬崖的窄桥（如数据库迁移）给低自由度的精确护栏；没有危险的广阔田野（如代码审查）给高自由度的大致方向，相信它找到最佳路线。

---

## 在所有计划使用的模型上测试

技能作为模型的附加内容发挥作用，效果取决于底层模型。在所有计划使用的模型上测试。

**按模型的测试考量**：

- **Haiku**（快速、经济）：技能是否提供了足够的指导？
- **Sonnet**（平衡）：技能是否清晰高效？
- **Opus**（强推理）：技能是否避免了过度解释？

对 Opus 完美的内容可能需要对 Haiku 更详细。目标是让指令在所有模型上都运行良好。

---

## 避免提供过多选项

除非必要，不要呈现多种方法：

```markdown
# 坏：过多选择（令人困惑）
"You can use pypdf, or pdfplumber, or PyMuPDF, or pdf2image, or……"

# 好：提供默认方案（含备选出口）
"Use pdfplumber for text extraction. For scanned PDFs requiring OCR, use pdf2image with pytesseract."
```

---

## 进阶：带可执行代码的技能

以下聚焦包含可执行脚本的技能。仅用 markdown 指令的技能可跳过。

### 解决问题，而非推给 Claude

编写技能脚本时，处理错误条件而非推给 Claude：

```python
# 好：明确处理错误，失败时创建默认文件
def process_file(path):
    try:
        with open(path) as f:
            return f.read()
    except FileNotFoundError:
        with open(path, "w") as f:
            f.write("")
        return ""
    except PermissionError:
        return ""

# 坏：直接失败，让 Claude 自己想办法
def process_file(path):
    return open(path).read()
```

配置参数应合理说明，避免“巫毒常数”（Ousterhout 法则）：

```python
# 好：自文档化
REQUEST_TIMEOUT = 30  # HTTP 请求通常在 30 秒内完成
MAX_RETRIES = 3       # 三次重试在可靠性与速度间取得平衡

# 坏：魔法数字
TIMEOUT = 47  # 为什么是 47？
```

### 提供实用脚本

预制脚本比让 Claude 现场生成更可靠、省 token、确保一致性。在指令中明确 Claude 应**执行脚本**（最常见）还是**作为参考阅读**（用于复杂逻辑）：

````markdown
## 实用脚本

**analyze_form.py**：从 PDF 提取所有表单字段

```bash
python scripts/analyze_form.py input.pdf > fields.json
```

**validate_boxes.py**：检查重叠的边界框

```bash
python scripts/validate_boxes.py fields.json  # 返回 "OK" 或列出冲突
```
````

### 可视化分析

当输入可渲染为图像时，让 Claude 分析它们（视觉能力有助于理解布局和结构）：

```markdown
1. 将 PDF 转换为图像：python scripts/pdf_to_images.py form.pdf
2. 分析每页图像以识别表单字段
```

### 创建可验证的中间输出

复杂、开放的任务易出错。用“计划-验证-执行”模式早期捕获错误：分析 → **创建计划文件** → **用脚本验证计划** → 执行 → 验证。

适用于批量操作、破坏性变更、复杂验证规则、高风险操作。技巧：让验证脚本输出详细错误信息（如“字段 'signature_date' 未找到。可用字段：…”）以帮助 Claude 修复。

### 运行时环境

技能在带文件系统、bash、代码执行的环境中运行。编写时注意：

- **元数据预加载**：启动时仅 `name` + `description` 进系统提示；SKILL.md 与参考文件按需读取
- **脚本执行不占上下文**：仅脚本输出消耗 token，脚本代码本身不进上下文
- **大文件无惩罚**：参考文件读取前不消耗 token——可放心打包完整 API 文档、大量示例
- **明确执行意图**：区分“运行 X 提取字段”（执行）与“参见 X 了解算法”（参考阅读）
- **确定性操作首选脚本**：写 `validate_form.py` 而非让 Claude 生成验证代码
- **测试文件访问**：通过真实请求验证 Claude 能导航你的目录结构

### 打包依赖项

- **claude.ai**：可从 npm / PyPI 安装包，可从 GitHub 拉取
- **Anthropic API**：无网络访问、无运行时包安装

在 SKILL.md 中列出所需包。

### MCP 工具引用

使用 MCP 工具时，始终用完全限定名称 `ServerName:tool_name` 避免找不到工具：

```markdown
Use the BigQuery:bigquery_schema tool to retrieve table schemas.
Use the GitHub:create_issue tool to create issues.
```

### 避免假设工具已安装

```markdown
# 坏：假设已安装
"Use the pdf library to process the file."

# 好：明确依赖
"Install: pip install pypdf. Then: from pypdf import PdfReader; reader = PdfReader('file.pdf')"
```
