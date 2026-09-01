/**
 * 技能扩展合并入口（better-skill，2026-08-30 由 skill-ext 改名）
 *
 * Pi 扩展发现只支持一层子目录 + 单一入口（index.ts），本目录将全部技能域
 * 扩展合并为一个扩展实例顺序注册：
 * - index-rewrite.ts：技能索引重写（before_agent_start 改写系统提示词技能
 *   索引段，维护技能名空间缓存与消歧通知）
 * - read-hint.ts：技能 read 兜底增强（tool_result 拦截，read 技能文件后追
 *   加附属文件清单 / 嵌套技能清单 / agent-browser 提醒；2026-09-01 由
 *   ref-hint / nested-skill-hint / agent-browser-notice 三拦截合并；同批
 *   将新增 skill-tool.ts 作为按名加载主通道）
 *
 * 加载通道分工（2026-09-01 主人确认）：skill 工具为主通道（索引激活规则
 * 指向它），read 拦截为兜底通道（resume 旧会话、模型绕过工具、read 子技
 * 能文件）；两通道共用 internal/skill-content.ts 的增强段组装，信息面完
 * 全一致。
 *
 * 包内纯库（internal/，2026-08-31 归组）：
 * - skill-content.ts：技能文件增强段组装（附属清单 / 嵌套名单 / browser
 *   提醒），read 拦截与 skill 工具共用
 * - namespace.ts：全局唯一技能名空间（预扫描构建、重名消歧别名、按名查询）
 * - inject-notice.ts：统一“LLM 注入且用户需知情”提示渲染（包内副本）
 * - path-canon.ts：~ 前缀展开（expandHome，read 拦截消费）
 *
 * 注册顺序即 handler 生效顺序；before_agent_start / tool_result 两个事件
 * 面互不干扰。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerIndexRewrite } from "./index-rewrite.ts";
import { registerReadHint } from "./read-hint.ts";

export default function (pi: ExtensionAPI) {
  registerIndexRewrite(pi);
  registerReadHint(pi);
}
