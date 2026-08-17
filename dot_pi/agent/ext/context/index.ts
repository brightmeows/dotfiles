/**
 * 上下文注入域扩展合并入口（context）
 *
 * Pi 扩展发现只支持一层子目录 + 单一入口（index.ts），本目录将 LLM 上下文
 * 注入相关扩展合并为一个扩展实例顺序注册：
 * - inline-context.ts：环境摘要注入（日期/系统环境/Git 状态，systemPrompt 注入）
 * - subdir-agents-md.ts：子目录 AGENTS.md 懒加载（访问路径时按需注入）
 *
 * 目录组织（2026-08-12 归组）：由 extensions/ 根目录平铺迁入。
 * 注册顺序即 handler 生效顺序，与拆分前互不干扰。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import inlineContext from "./inline-context.ts";
import subdirAgentsMdExtension from "./subdir-agents-md.ts";

export default function (pi: ExtensionAPI) {
  inlineContext(pi);
  subdirAgentsMdExtension(pi);
}
