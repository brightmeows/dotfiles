/**
 * 技能扩展合并入口（skill-ext）
 *
 * Pi 扩展发现只支持一层子目录 + 单一入口（index.ts），本目录将全部技能域
 * 扩展合并为一个扩展实例顺序注册：
 * - index-rewrite.ts：技能索引重写（before_agent_start 改写系统提示词技能索引段）
 * - ref-hint.ts：技能引用提示（tool_result 拦截，SKILL.md 读后追加子文件清单）
 *
 * 目录组织（2026-08-11 归组）：由 extensions/ 根目录平铺的 skill-index-rewrite.ts /
 * skill-ref-hint.ts 迁入；index-rewrite 内部拆出 source-labels / path-canon / render
 * 三个纯函数模块。注册顺序即 handler 生效顺序，与拆分前互不干扰的
 * before_agent_start / tool_result 两个事件保持一致。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerIndexRewrite } from "./index-rewrite.ts";
import { registerRefHint } from "./ref-hint.ts";
import { registerSubskillHint } from "./subskill-hint.ts";

export default function (pi: ExtensionAPI) {
  registerIndexRewrite(pi);
  registerRefHint(pi);
  registerSubskillHint(pi);
}
