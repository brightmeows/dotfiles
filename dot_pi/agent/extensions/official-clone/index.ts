/**
 * 官方示例克隆区入口（official-clone）
 *
 * Pi 扩展发现只支持一层子目录 + 单一入口（index.ts），本目录将收录的官方
 * 示例克隆合并为一个扩展实例顺序注册。各克隆工具独立成文件，导出
 * `registerXxx(pi)`，于此汇总调用：
 * - questionnaire.ts：questionnaire 工具（复制自 pi 0.84.1 官方
 *   `examples/extensions/questionnaire.ts`，注册工具名 `questionnaire`）
 *
 * 模块间 import 用 `./xxx.ts` 写法（tsconfig 已开 `allowImportingTsExtensions`）。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerQuestionnaire } from "./questionnaire.ts";

export default function (pi: ExtensionAPI) {
  registerQuestionnaire(pi);
}
