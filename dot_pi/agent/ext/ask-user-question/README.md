# pi-meow-ask-user-question

结构化问卷工具：模型把需要用户决定的事情一次性摊开，用户在终端对话框里选选项、写自定义答案、加备注，选择以结构化的形式回到模型。

本包 vendored 自 [`@juicesharp/rpiv-ask-user-question@2.15.0`](https://www.npmjs.com/package/@juicesharp/rpiv-ask-user-question)（MIT，[juicesharp/rpiv-mono](https://github.com/juicesharp/rpiv-mono)），在本仓内冻结维护。上游代码基线不再跟进，
本地改动见下文与 [`docs/ai/pi-ask-user-question-limits.md`](../../../../docs/ai/pi-ask-user-question-limits.md)。

## 本地注册

本包不是 npm 发布物，不要用 `pi install npm:@juicesharp/rpiv-ask-user-question`。它由本仓的 Pi 配置注册：

```json
{
  "packages": ["./ext/ask-user-question"]
}
```

源文件在 `dot_pi/agent/ext/ask-user-question/`，经 chezmoi 部署到 `~/.pi/agent/ext/ask-user-question/`。改完源文件运行 `chezmoi apply`，重启 Pi 或在 Pi 内执行 `/reload`。

## 与上游 2.15.0 的差异

- **题数上限移除**：`MAX_QUESTIONS` 常量、schema `maxItems`、运行时 `too_many_questions` 校验与错误码、提示词中的题数文案全部删除；`minItems: 1` 保留。options 2 到 4 个、header 16 字符、label 60 字符的限制不变。
- **参数硬限制进提示词**：吸收上游 #309 的思路，把 header 与 label 的长度限制写进 tool description 与 guidance，减少问卷打开前的 schema 拒绝。
- **多题 tab 条**：题数变多后 tab 条以活动项为中心开窗，Submit 固定在右侧；窗口过窄时降级为 `□ i/N`。
- **reconcile 只剥离**：无 UI 的运行里把工具从活动集移除；交互态不再强制加回，尊重 `--tools` / `-xt` 与工具集管理扩展（上游 #149）。
- **依赖内联**：`@juicesharp/rpiv-config` 的核心配置加载内联为 `internal/rpiv-config.ts`；`@juicesharp/rpiv-i18n` 保持 optional peer，运行时动态软加载，缺失时界面回退英文。
- **排版与测试**：整包由 oxfmt 统一为 2 空格；新增 `node:test` 单测，覆盖校验、参数归一化、答案封装、tab 条与 reconcile。

`#241`（Ctrl+C 清草稿而非取消）与 `#194`（RPC fallback 的草稿状态机）是上游仍打开的 issue，本包暂不跟。

## 配置

配置文件路径 `~/.config/rpiv-ask-user-question/config.json`，只读不写。文件不存在或 JSON 损坏时按默认值运行；单个值不合法时静默回到默认值，不会报错。

| 配置项 | 作用 | 默认值 |
| --- | --- | --- |
| `collapseKey` | 折叠/展开对话框的按键，写 Pi 键位 id 或 `"off"` | `"ctrl+]"` |
| `notesKey` | 打开备注编辑器的按键，单字符或 Pi 键位 id | `"n"` |
| `guidance.description` | 整体替换给模型看的 tool description | 内置文案 |
| `guidance.promptSnippet` | 系统提示里的一行工具摘要 | 内置文案 |
| `guidance.promptGuidelines` | 给模型的用法条目数组 | 内置 5 条 |

```json
{ "collapseKey": "alt+o" }
```

## 文档

- [工具 schema](docs/tool-schema.md)：参数、限制、校验错误、返回结构、事件。
- [键盘与布局](docs/keyboard.md)：按键、备注、折叠、预览与溢出行为。
- [配置](docs/configuration.md)：路径解析、键位语法、guidance 覆盖。
- [宿主与运行时](docs/hosts.md)：终端、RPC、非交互三种宿主的行为与降级。
- [本地化](docs/localization.md)：九种语言、locale 选择与新增语言的方法。
- [启动性能](docs/startup-performance.md)：上游的 import 解析与预热记录。

以上文档保留上游英文原文，只修正与本地改动冲突的事实。

## 验证

在本仓根目录：

```sh
pnpm check   # Pi 运行时版本漂移检查 + tsc
pnpm lint    # oxlint
pnpm test    # 模型域与扩展单测
```

`pnpm check` 会比对 `pi --version`、根 `node_modules` 里 `@earendil-works/pi-*` 的安装版本与 `typebox` 的 pin；不一致时直接失败。pre-commit 也会跑同一项检查。

## 许可

MIT，见 [LICENSE](LICENSE)。上游版权归 juicesharp。
