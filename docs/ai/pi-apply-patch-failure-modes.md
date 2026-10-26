# apply_patch 失败率：实测、原因与本地修复层

> 记录于 2026-10-26。执行层基线是 @d3ara1n/pi-apply-patch 0.2.0 的 vendored 副本；上游已发布 0.4.1，渲染层 PR #24/#25 已合并。

## 结论

失败率高的主因不在写入算法，而在三条输入契约上：Add File body 每行必须带 `+`、hunk 上下文必须逐行命中、整包暂存让一个坏 hunk 连坐全部文件。渲染层不是瓶颈。

本机会话实测 45 次 apply_patch 调用，8 次失败（17.8%），其中 5 次可以由纯文本输入修复层救回，3 次是上下文漂移，需要模型重读文件。

## 实测样本

扫描 `~/.pi/agent/sessions` 下 641 个会话文件，时间范围 2026-10-25 11:34 UTC 到 2026-10-26 02:02 UTC，共 4 个会话。

| 项目 | 数值 |
|---|---|
| 调用次数 | 45 |
| 失败次数 | 8 |
| 成功次数 | 37 |
| 模型分布 | glm-5.3-flash 43 次 7 错；deepseek-v4.1-flash 2 次 1 错 |

失败分类：

| 类别 | 次数 | 典型证据 |
|---|---|---|
| Add File 内容行缺 `+` | 3 | 空行、`///` 注释行、`(` 代码行各一次 |
| Update 上下文不匹配 | 3 | rustfmt 重排、文档注释扩写、上下文混入另一个测试块 |
| 同文件重复 Update | 1 | 两个 `*** Update File:` 指向同一文件 |
| 空 Update hunk | 1 | `*** Update File:` 后直接 `*** End Patch` |

7 次失败在下一轮重试成功；1 次同会话内没有重试，文件后来由其他会话或工具创建。调用级失败率不等于任务级失败率，但重试成本是真实的：失败包最大 18KB，重发一次等于再生成一遍。

## 实现链路

1. `src/tool.ts` 注册工具，`input` 是一整段字符串；`constrainedSampling` 只对支持 lark grammar 的 provider 生效。
2. `src/apply.ts` 解析补丁、解析路径、校验工作区边界、按路径排序取文件队列。
3. 所有操作先预检：每个 update 文件跑 `planUpdate`，收集全部未命中 hunk；任何文件失败就抛错，一个字节都不写。
4. 预检通过后进入写入循环，写入前重新读源文件，内容变了就重新匹配。
5. `src/core/parser.ts` 是严格 Codex 格式解析器；`src/core/matcher.ts` 只有 exact、trimEnd、trim、Unicode 标点归一化四档比较。

## 失败原因

### Add File 行前缀

`src/core/parser.ts` 的 Add File 分支只接受以 `+` 开头的行。空行、或模型中途漏写 `+` 的内容行，会落到“不是合法 hunk header”的通用报错。

Codex 官方提示词写明“Every following line is a + line”“You must prefix new lines with + even when creating a new file”。
fork 的工具描述只写了“Prefix added lines with +”，没有把“Add File 的每一行都算 added line，空行也要加”说透。
GLM、DeepSeek 这类没有 Codex 格式训练的模型最先丢这一条，而 `constrainedSampling` 对它们不生效。

实测中最严重的一次是 100 行 Add File 只有前 4 行带 `+`，其余 95 行都没有前缀。纯文本层补前缀可以完整救回，因为 Add File 段内每一行都是内容，没有歧义。

### 上下文漂移

`planUpdate` 要求 hunk 的每一条 context 行都命中，四档比较没有模糊匹配。实测三种漂移：

- rustfmt 把 `let channel_str = ...` 从三行重排成两行，patch 的 `-` 行按旧格式写，整包被拒。
- 文档注释被扩写，13 行上下文只差 1 行，整包被拒。
- 模型把另一个测试块的 `const result = ...` 混进当前上下文，开头多一行，后续整体错位。

诊断报告会给出 closest match、期望行和实际行，模型下一轮基本能修好。失败成本是整包重发，而不是只修那一个 hunk。

`src/core/update.ts` 的 `cursor` 只向前推进，hunk 必须按文件顺序排列。模型如果先写下面的 hunk 再写上面的，会得到“outside the searched range”。这次样本没有出现，但这是同一条匹配规则下的坑。

### 整包暂存与重复目标

`src/apply.ts` 拒绝同一路径的多次操作，并把所有文件预检完；任何文件失败就整包拒绝：

```text
apply_patch verification failed: 1 of 7 operations failed; no files were written.
verified but not written: ...
```

Codex 上游是逐操作读、改、写的：前面的文件已经落盘，后面的操作失败时前面的保留；同一文件的多个 Update 块也能顺序执行。这个移植版改成了事务式暂存，安全性更好，代价是连坐：

- 7 个文件里 1 个 hunk 失败，6 个已验证文件一个都不写。
- 8 个文件里 1 个空 Update，整包拒绝。
- 同一文件的第二个 Update 块直接判为非法。

它还禁掉了依赖式操作：先 Add 再 Update 同一路径、先 Move 再 Update 目标路径、先 Move 再 Delete 源路径。这些在 Codex 里能顺序走通，在这里会被重复检查挡住或在预检时读不到文件。

### 未命中的格式坑

这些这次样本没有出现，但代码路径明确：

- 整段 patch 外套 Markdown 围栏，`*** Begin Patch` 不是第一行，直接报错。
- 用统一 diff 的 `@@ -2,3 +2,3 @@` 做 hunk 头，解析器会把 `-2,3 +2,3 @@` 当成 anchor 文本去文件里找，找不到就失败。
- `@@foo` 没有空格，不算 anchor，落到“Expected update hunk to start with a @@ context marker”。
- 补丁被输出上限截断，最后一行不是 `*** End Patch`，直接失败。
- Pi 从子目录启动时，工作区边界就是 `ctx.cwd`，父目录文件会被拒绝。

## 本地修复层

新增包 `dot_pi/agent/ext/apply-patch-tweaks/`，包名 `pi-meow-apply-patch-tweaks`。它独立于执行层，同时兼容 vendored fork 和后续 npm 包。

接线：

- `before_agent_start`：把补丁编写规则补进 `systemPromptOptions.toolGuidelines.apply_patch`，按精确字符串去重。工具描述已经带 Add File 规则时跳过 Add File 补丁，避免和上游重复。
- `tool_call`：只处理 `apply_patch`，纯文本修复 `input`，按 `toolCallId` 记录修复说明。
- `tool_result`：把修复说明追加到工具结果，模型能看到“输入被修过”。
- `session_start`：清空备注表。
- 修复函数抛异常时只打日志，原输入原样放行。修复层永远 fail open。

修复规则：

| 规则 | 触发 | 变换 | 风险 |
|---|---|---|---|
| 去围栏 | 整段 patch 外层有 Markdown 围栏，内部以 `*** Begin Patch` 开头 | 去掉首尾围栏行 | 低 |
| Add File 补前缀 | Add File 段内某行不以 `+` 开头 | 行首补 `+`，空行也补 | 低 |
| 合并重复 Update | 同一路径的连续 Update 块，都没有 Move，也都没有 `*** End of File` | 后续块 hunk 接到第一个块下 | 中：只支持文件顺序向下的 hunk |
| 丢弃空 Update | Update 头后没有任何 body，也没有 Move | 整块删掉 | 低：语义上是 no-op |
| 数字 hunk 头降级 | `@@ -1,3 +1,3 @@` 且 chunk 至少有一条 context 或删除行 | 改成裸 `@@` | 中：纯 `+` 的 chunk 不降级 |
| `@@` 补空格 | 行首 `@@` 但不是单独 `@@`、不是 `@@` 后接空格、也不是数字头 | 改成 `@@` 加空格再加原文 | 低 |

不做的修复：

- 不补缺失的 `*** End Patch`。截断补丁补结束符会把半截内容写进文件。
- 不改 context 行，不做模糊匹配。删除行和上下文行必须精确命中。
- 不重排 hunk。纯文本层拿不到真实文件行号。
- 不改尾换行。上游 fixture 014 和 README 明确把“更新补尾换行”当作 Codex 兼容行为。
- 不处理 `*** Move to:` 的位置错误，让解析器报原始错误。
- 不放宽工作区边界，路径越界是安全边界。

## 上游状态

- PR #24（折叠态结果 diff）与 #25（流式预览）已在 2026-10-25 合并，随后发布 0.3.0、0.4.0、0.4.1。main CI 绿，PR 的 Test 与 Typecheck 全过，没有 review 评论。
- 上游 0.4.1 没有失败率相关的提示词修复：工具描述仍是旧版，没有 `promptGuidelines`。
- 提示词契约 [PR #26](https://github.com/d3ara1n/pi-extensions/pull/26) 只改 `packages/pi-apply-patch/src/tool.ts`、README 和 tool 测试，checks 全过，等待合并发版：
  - description 补 Add File 每行 `+`（含空行）和不要围栏。
  - promptGuidelines 补单文件单 Update 头、文件顺序、裸 `@@`、上下文过期重读、小补丁。
  - 不改执行层，不改尾换行，不做解析器容错。
- 提示词 PR 合并发版后，删除 vendored 目录，settings 改为 `npm:@d3ara1n/pi-apply-patch`；`apply-patch-tweaks` 保留。

## 切换与验证

切换步骤：

1. 改 `dot_pi/agent/settings.meow.json`，删除 `./ext/apply-patch`，加入 npm 包。
2. 删除 `dot_pi/agent/ext/apply-patch/`。
3. `chezmoi apply`。
4. 手动删除部署区孤儿 `~/.pi/agent/ext/apply-patch`。
5. 启动 pi，确认 `apply_patch` 只注册一次，做一次 Add File 和一次 Update 的运行时冒烟。
6. 回滚时 revert 切换提交，恢复 `./ext/apply-patch` 和 fork 目录；`apply-patch-tweaks` 不用动。

本地验证：

```bash
pnpm check
pnpm test
pnpm format:check
```

运行时验证：

```bash
pi -p -e ./dot_pi/agent/ext/apply-patch-tweaks/index.ts -e /tmp/dump-apply.ts --no-session "读取 bad.patch，原样调用 apply_patch"
```

dump 扩展在 `tool_call` 里记录修复后的 input，在 `tool_result` 里记录追加的说明；文件落盘结果与补丁字面意图一致即通过。

## 未采纳的方案

- 上下文模糊匹配：会引入改错位置的风险。本次 3 次上下文漂移里，只有 1 次是单行 context 漂移，另外 2 次涉及删除行重排或上下文混块，安全版本救不了。
- 尾换行修复：上游 fixture 014、README 和 Codex `text_file.rs` 都把它当兼容行为。
- 逐文件部分写入：会降低重试成本，但失败后仓库处于半应用状态。当前全包验证符合“能回滚的才敢上”，暂不改变。
