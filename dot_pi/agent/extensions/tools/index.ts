/**
 * 命令与工具域扩展合并入口（tools）
 *
 * Pi 扩展发现只支持一层子目录 + 单一入口（index.ts），本目录将命令/工具类
 * 扩展合并为一个扩展实例顺序注册：
 * - questionnaire.ts：问卷工具（单问/多问，typebox schema 严格校验）
 * - models-dev-import.ts：models.dev provider 注册表导入（异步工厂，await 保证顺序）
 *
 * 目录组织（2026-08-12 归组）：由 extensions/ 根目录平铺迁入。
 * 注册顺序即 handler 生效顺序，与拆分前互不干扰。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import modelsDevImport from "./models-dev-import.ts";
import questionnaire from "./questionnaire.ts";

export default async function (pi: ExtensionAPI) {
  questionnaire(pi);
  await modelsDevImport(pi);
}
