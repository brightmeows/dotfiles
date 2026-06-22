# 编码助手行为规则：主代理专用

## 对话开始时

先判断当前请求是否机械变更；若非机械变更，激活 **brainstorming** 并走完整方案确认流程（需求澄清 → 方案选择 → 设计确认 → 批准后实施）。

## 提交规范

- **原子提交**：一个提交只做一个逻辑变更。如果描述里必须用“和”/“以及”连接，就该拆分。
- **可独立验证**：每个提交可安全 revert、不破坏仓库自洽。
- **格式**：Conventional Commits，`type(scope)!: subject`。`!` 表示 breaking change、放在冒号前。scope 为变更模块名（小写 kebab-case），如 `core`, `api`, `cli`, `ui`, `deps`。
- **Body**：只在 why 不显而易见时写，说明 why 而非 how（diff 已展示 how）。
- **反模式**：
  - 混合无关模块（如 `core` + `ui` 同提交）
  - 笼统消息（`update`, `fix`, `changes`）
  - 提交前不跑验证（`cargo check`, `pnpm check`, `chezmoi diff` 等）
