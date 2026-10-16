/**
 * Thinking Flow 扩展（thinking-flow）
 *
 * 目标：重新定义 pi 助手消息中 thinking 块的默认可见性与视觉呈现。
 * 流式进行中的 thinking 完整渲染（"Thinking" 粗体标题行 + thinkingText
 * 斜体正文，无前缀符号），历史 thinking 收起为一行彩色占位（可鼠标点开
 * 单块）；ctrl+t 在全量展示与本默认行为间一键切换。
 *
 * 行为（两态）：
 * ┌ flow 态（hideThinkingBlock === false，settings 默认值）
 * │  进行中的 thinking run（流式中最后一段、其后无非空正文）
 * │    完整 Markdown 渲染 + "Thinking" 加粗标题行（与内置原生渲染同款）
 * │  历史 thinking run
 * │    一行彩色占位：> 前缀（accent）+ Thinking（thinkingText 粗体）
 * │    + · 已折叠（dim）+ · 点击展开（muted），随主题自动适配
 * │  鼠标点击占位/展开块：单块 toggle（内置 overrides 机制保留）
 * └ expanded 态（hideThinkingBlock === true，ctrl+t 切换）
 *    全部 thinking run 完整渲染 + 同款装饰
 *
 * 模式语义（对内置的接管，以本注释为准）：
 * - 内置 hideThinkingBlock 语义是"隐藏 thinking"（true = 全部收起占位）；
 *   本扩展把它反转为"全量展示"（true = expanded 态），"全部收起"态不再存在。
 * - ctrl+t 的 status 文案（"Thinking blocks: hidden/visible"）与 /settings
 *   的开关文案沿用内置，与本扩展实际行为相反，不另改文案。
 * - hideThinkingBlock 经 settingsManager 持久化，跨会话保持。
 *
 * 实现说明：
 * - 接管 AssistantMessageComponent.prototype.updateContent。pi 对 thinking
 *   渲染暂无 replace 钩子（官方 issue can1357/oh-my-pi#1728 讨论中），
 *   monkey-patch 是唯一路径，与 pi-thinking-box / pi-thinking-steps 同手法；
 *   渲染逻辑按 pi 1.2.0 assistant-message.js 等价重写，thinking 分支外
 *   行为不变（text 渲染、Spacer 节奏、abort/error/length 尾注全保留）
 * - 私有成员经形状守卫读取（家规：bun 打包未初始化字段丢弃，in 探测 +
 *   降级 original 原生渲染），结构不匹配时不崩溃
 * - reload 幂等：原生方法引用存 globalThis Symbol 槽（见 thinking-flow.ts）
 * - 主题色取 globalThis 共享 theme 单例，token 用 thinkingText（主题语义色，
 *   换主题自动适配）；单例不可用（headless 等）时降级裸文本
 * - createMarkdownTransform 为包内副本（内部模块未公开导出，家规"自备副本"）
 *
 * 已知边界：
 * - pi 升级若改 assistant-message.js 渲染结构，需同步本扩展：升 pi 后按
 *   ext/AGENTS.md"运行时验证"节跑一次 tmux 实测
 * - 流式中 thinking 后紧跟 toolCall（interleaved reasoning）时该 run 视为
 *   进行中持续显示，直到正文 text 流出才收起
 * - expanded 态长会话中每个历史 run 都带标题与斜体正文，视觉分段为预期行为
 */

import { AssistantMessageComponent, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installThinkingFlowPatch } from "./internal/thinking-flow.ts";

export default function thinkingFlow(_pi: ExtensionAPI): void {
  installThinkingFlowPatch(AssistantMessageComponent);
}
