/**
 * 输入域扩展合并入口（input）
 *
 * Pi 扩展发现只支持一层子目录 + 单一入口（index.ts），本目录将键盘与编辑器
 * 输入相关扩展合并为一个扩展实例顺序注册：
 * - esc-hold.ts：Esc 防误触（单击提示不中断，双击/长按才中断）
 * - editor-input-tweaks.ts：编辑器输入增强（/ 补全停留 + 标记符着色）
 *
 * 目录组织（2026-08-12 归组）：由 extensions/ 根目录平铺迁入。
 * 注册顺序即 handler 生效顺序，与拆分前互不干扰。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import escHold from "./esc-hold.ts";
import editorInputTweaks from "./editor-input-tweaks.ts";

export default function (pi: ExtensionAPI) {
  escHold(pi);
  editorInputTweaks(pi);
}
