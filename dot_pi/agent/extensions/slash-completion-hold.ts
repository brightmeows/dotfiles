/**
 * 斜杠命令补全停留扩展（slash-completion-hold）
 *
 * 目标：pi 默认对 / 开头的斜杠命令补全“选中即执行”——按 enter 确认补全后
 * 直接 fall through 到提交。本扩展把这个行为改成“选中只填入输入框”，
 * 与 @/#/文件路径等补全一致，需再按一次 enter 才提交。
 *
 * 行为对照：
 * - 补全菜单激活时按确认键（tui.select.confirm，默认 enter）：
 *   - / 命令补全：填入输入框，不执行（改动点）
 *   - @/#/文件补全：填入输入框，不执行（pi 原生行为，不变）
 * - 补全菜单未激活时按 enter：正常提交（不变）
 * - 补全菜单激活时按 Tab：填入不执行（pi 原生行为，不变）
 *
 * 实现原理：
 * - pi-tui 的 Editor.handleInput 里，/ 补全确认后走 applyCompletion →
 *   cancelAutocomplete → fall through → submitValue（直接执行）；其他补全
 *   确认后走 applyCompletion → return（停留在输入框）。
 * - Editor 暴露 public 的 disableSubmit 开关：submit 分支与
 *   shouldSubmitOnBackslashEnter 均检查 `if (this.disableSubmit) return`。
 * - 本扩展继承 CustomEditor，在“补全激活 + 确认键”场景临时置 disableSubmit=true
 *   包裹 super.handleInput：补全仍被应用（applyCompletion 在 submit 检查之前），
 *   但随后的 fall-through 提交被 disableSubmit 拦下。super 返回后立即恢复原值。
 * - 因为 @/# 等补全确认在 submit 检查之前就 return 了，disableSubmit 对它们
 *   无影响——所以本拦截只改变 / 补全的行为，其余场景纹丝不动。
 *
 * app 兼容性：
 * - setCustomEditorComponent 对带 actionHandlers 的编辑器（即继承 CustomEditor）
 *   会自动复制所有 app 级 handler（escape 中断、Ctrl+P 模型切换、Ctrl+D 退出、
 *   补全 provider、外观等），用 duck typing 判断，跨升级安全。
 *
 * 设计权衡（2026-08-07 主人确认）：
 * - 不加环境变量开关，固定启用此行为
 * - 改动后 / 命令需多按一次 enter（选中→填入，再 enter→执行），这是
 *   “停留在输入框待确认”的必然代价
 */

import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getKeybindings } from "@earendil-works/pi-tui";

/**
 * 斜杠命令补全停留编辑器。
 *
 * 继承 CustomEditor 以保留全部 app 级键绑定与 handler，仅重写 handleInput
 * 拦截“补全菜单激活时的确认键”。
 */
class SlashCompletionHoldEditor extends CustomEditor {
  override handleInput(data: string): void {
    // 补全菜单激活时按确认键：临时禁用提交。补全仍会被应用，但 / 命令补全
    // 后续的 fall-through 提交被拦下。其他补全（@/#/文件）在 submit 检查前已 return，不受影响。
    if (getKeybindings().matches(data, "tui.select.confirm") && this.isShowingAutocomplete()) {
      const prev = this.disableSubmit;
      this.disableSubmit = true;
      try {
        super.handleInput(data);
      } finally {
        this.disableSubmit = prev;
      }
      return;
    }
    super.handleInput(data);
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    // 编辑器组件仅 TUI 模式有意义；其他模式 setEditorComponent 为 no-op，跳过避免无谓实例化
    if (ctx.mode !== "tui") {
      return;
    }
    ctx.ui.setEditorComponent(
      (tui, theme, keybindings) => new SlashCompletionHoldEditor(tui, theme, keybindings),
    );
  });
}
