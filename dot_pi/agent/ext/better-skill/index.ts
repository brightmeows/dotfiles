/**
 * 技能扩展合并入口（better-skill，2026-08-30 由 skill-ext 改名）
 *
 * Pi 扩展发现只支持一层子目录 + 单一入口（index.ts），本目录将全部技能域
 * 扩展合并为一个扩展实例顺序注册：
 * - index-rewrite.ts：技能索引重写（before_agent_start 改写系统提示词技能索引段）
 * - ref-hint.ts：技能文件枚举提示（tool_result 拦截，SKILL.md 读后追加目录文件清单）
 * - nested-skill-hint.ts：嵌套技能发现（tool_result 拦截，read 技能文件后追加
 *   skills/ 子技能与 frontmatter 散布文件两形态的结构化清单，自相似触发）
 * - agent-browser-notice.ts：agent-browser 技能专属提醒（tool_result 拦截，
 *   SKILL.md 读后追加 skills get 全文读取与默认 --headed 两条提醒）
 *
 * 目录组织（2026-08-11 归组）：由 extensions/ 根目录平铺的 skill-index-rewrite.ts /
 * skill-ref-hint.ts 迁入；index-rewrite 内部拆出 source-labels / path-canon / render
 * 三个纯函数模块。注册顺序即 handler 生效顺序，与拆分前互不干扰的
 * before_agent_start / tool_result 两个事件保持一致。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAgentBrowserNotice } from "./agent-browser-notice.ts";
import { registerIndexRewrite } from "./index-rewrite.ts";
import { registerNestedSkillHint } from "./nested-skill-hint.ts";
import { registerRefHint } from "./ref-hint.ts";

export default function (pi: ExtensionAPI) {
  registerIndexRewrite(pi);
  registerRefHint(pi);
  registerNestedSkillHint(pi);
  registerAgentBrowserNotice(pi);
}
