/**
 * 命令与工具域扩展合并入口（tools）
 *
 * Pi 扩展发现只支持一层子目录 + 单一入口（index.ts），本目录将命令/工具类
 * 扩展合并为一个扩展实例顺序注册：
 * - questionnaire.ts：问卷工具（单问/多问，typebox schema 严格校验）
 *
 * 目录组织（2026-08-12 归组）：由 extensions/ 根目录平铺迁入；models.dev
 * 导入 2026-08-27 拆包至 models-dev/。
 * 注册顺序即 handler 生效顺序，与拆分前互不干扰。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import questionnaire from "./questionnaire.ts";

export default function (pi: ExtensionAPI) {
  questionnaire(pi);
}
