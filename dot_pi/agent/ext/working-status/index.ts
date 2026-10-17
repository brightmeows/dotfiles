/**
 * Working 状态扩展（working-status）
 *
 * 目标：把 pi 流式期间的 Working 指示行从静态 "Working" 改为随 agent
 * 生命周期切换的中文状态文案（转圈动画帧沿用内置默认，不附中断键提示）。
 *
 * 状态机（事件驱动，文案相同不重复设置）：
 *   agent_start / before_provider_request → 等待模型响应…
 *   message_start（仅 assistant 消息）     → 生成中…
 *   tool_execution_start                   → 执行工具 <toolName>…
 *   tool_execution_end                     → 嵌套调用回退父工具名，顶层保持
 *   agent_end                              → 复位为内置默认文案
 *
 * 设计说明：
 * - message_start 对 user/toolResult 消息也触发，仅 assistant 切“生成中”；
 *   后续 delta（message_update）不重复设置，状态切换只在事件边界发生
 * - codemode 嵌套工具调用（parentToolCallId 存在）结束后回退显示父工具，
 *   避免状态闪成嵌套工具名后回不去；父子映射随 start 记录、end 清理
 * - 准备窗口（agent_start 到 before_provider_request 之间，毫秒级）
 *   并入“等待模型响应”，不单独设状态
 * - retry / compaction / branchSummary 阶段由内置指示器整体接管
 *   （指示器 kind 不同），本扩展不干预；agent_end 复位保证下一轮干净
 * - setWorkingMessage 不带参数即恢复内置默认；文案变化才调用，
 *   避免逐 delta 触发无谓重渲染
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const WAITING = "等待模型响应…";
const GENERATING = "生成中…";

export default function workingStatus(pi: ExtensionAPI): void {
  let current: string | undefined;
  const parents = new Map<string, string>();

  const setStatus = (ctx: ExtensionContext, message: string | undefined): void => {
    if (current === message) {
      return;
    }
    current = message;
    ctx.ui.setWorkingMessage(message);
  };

  pi.on("agent_start", (_event, ctx) => setStatus(ctx, WAITING));
  pi.on("before_provider_request", (_event, ctx) => setStatus(ctx, WAITING));
  pi.on("message_start", (event, ctx) => {
    if (event.message.role === "assistant") {
      setStatus(ctx, GENERATING);
    }
  });
  pi.on("tool_execution_start", (event, ctx) => {
    parents.set(event.toolCallId, event.toolName);
    setStatus(ctx, `执行工具 ${event.toolName}…`);
  });
  pi.on("tool_execution_end", (event, ctx) => {
    parents.delete(event.toolCallId);
    const parentName = event.parentToolCallId ? parents.get(event.parentToolCallId) : undefined;
    if (parentName !== undefined) {
      setStatus(ctx, `执行工具 ${parentName}…`);
    }
  });
  pi.on("agent_end", (_event, ctx) => {
    parents.clear();
    if (current === undefined) {
      return;
    }
    current = undefined;
    ctx.ui.setWorkingMessage();
  });
}
