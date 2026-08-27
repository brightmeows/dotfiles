/**
 * 模型目录导入域扩展合并入口（models-dev）
 *
 * Pi 扩展发现只支持一层子目录 + 单一入口（index.ts），本目录收纳 models.dev
 * provider 注册表导入扩展：
 * - models-dev-import.ts：从 models.dev/api.json 拉取注册表并注册 provider
 *   （异步 factory，入口 await 保证顺序）
 *
 * 目录组织（2026-08-27 拆包）：由 tools/ 拆出独立成域（纯移动，行为不变），
 * 便于与"协议感知"相关的 provider 注册逻辑独立演进。tools/ 仅剩 questionnaire。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import modelsDevImport from "./models-dev-import.ts";

export default async function (pi: ExtensionAPI) {
  await modelsDevImport(pi);
}
