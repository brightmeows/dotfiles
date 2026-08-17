/**
 * 命令别名域扩展合并入口（aliases）
 *
 * Pi 扩展发现只支持一层子目录 + 单一入口（index.ts），本目录收纳斜杠命令
 * 别名类扩展：
 * - command-aliases.ts：斜杠命令别名（/clear → /new、/exit → /quit）
 *
 * 目录组织（2026-08-12 归组）：由 tools/ 拆出独立成域，与"命令与工具"域
 * 分离，便于后续按别名主题增补扩展。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import commandAliases from "./command-aliases.ts";

export default function (pi: ExtensionAPI) {
  commandAliases(pi);
}
