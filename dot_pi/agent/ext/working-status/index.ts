/**
 * Working 状态扩展（working-status）
 *
 * 目标：把 pi 流式期间的 Working 指示行从静态 "Working" 改为随 agent
 * 生命周期切换的中文状态文案，全状态带持续计时（转圈动画帧沿用内置
 * 默认，不附中断键提示）：
 *   等待模型响应（3s） / 生成中（12s） / 执行工具 bash（2s）
 *
 * 状态机（事件驱动，文案相同不重复设置）：
 *   agent_start / before_provider_request → 等待模型响应
 *   message_start（仅 assistant 消息）     → 生成中
 *   tool_execution_start                   → 执行工具 <toolName>
 *   tool_execution_end                     → 嵌套调用回退父工具名，顶层保持
 *   agent_end                              → 复位为内置默认文案
 *
 * 计时：每次状态切换重置秒表（显示当前状态的持续秒数），interval 每秒
 * 刷新，前 1 秒内显示（1s）避免（0s）；秒表仅状态活跃时运行。
 *
 * 设计说明：
 * - 计时重锚定：每次状态切换重建 interval，tick 落在 since+k 秒整点，
 *   消除沿用旧相位导致的显示偏晚（最多 1 秒）
 * - 工具计时按调用者计：start 时记录各 callId 真实起点，显示谁就用谁的
 *   起点——嵌套子工具用子起点、回退父工具恢复父起点（真实父耗时）；
 *   相邻同名顶层调用 callId 不同，计时各自重置（旧实现按文案判重，
 *   并行同名工具的连续计时会跨调用累加）
 * - retry / compaction / branchSummary 阶段由内置指示器整体接管
 *   （指示器 kind 不同，实测 500 重试退避窗口本扩展文案被整体替换），
 *   本扩展不干预；agent_end 复位保证下一轮干净
 * - message_start 对 user/toolResult 消息也触发，仅 assistant 切生成中；
 *   后续 delta（message_update）不重复设置，状态切换只在事件边界发生
 * - codemode 嵌套工具调用（parentToolCallId 存在）结束后回退显示父工具，
 *   避免状态闪成嵌套工具名后回不去
 * - setWorkingMessage 不带参数即恢复内置默认；文案变化才调用，
 *   避免逐 delta 触发无谓重渲染
 * - 秒表 timer 存 globalThis 槽，重装先清旧（reload 幂等，旧闭包
 *   不得残留 stale ctx 调用）
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const WAITING = "等待模型响应";
const GENERATING = "生成中";
const TICK_MS = 1000;

const TIMER_KEY = Symbol.for("pi-meow-working-status:timer");

export default function workingStatus(pi: ExtensionAPI): void {
  let current: string | undefined;
  let since = 0;
  let lastCtx: ExtensionContext | undefined;
  const names = new Map<string, string>();
  const starts = new Map<string, number>();

  const label = (base: string): string =>
    `${base}（${Math.max(1, Math.floor((Date.now() - since) / TICK_MS))}s）`;

  const stopTimer = (): void => {
    const globals = globalThis as unknown as Record<symbol, unknown>;
    const timer = globals[TIMER_KEY] as ReturnType<typeof setInterval> | undefined;
    if (timer !== undefined) {
      clearInterval(timer);
      delete globals[TIMER_KEY];
    }
  };

  const ensureTimer = (): void => {
    const globals = globalThis as unknown as Record<symbol, unknown>;
    if (globals[TIMER_KEY] !== undefined) {
      return;
    }
    globals[TIMER_KEY] = setInterval(() => {
      if (current === undefined || lastCtx === undefined) {
        return;
      }
      lastCtx.ui.setWorkingMessage(label(current));
    }, TICK_MS);
  };

  const setStatus = (ctx: ExtensionContext, base: string, clockStart?: number): void => {
    if (current === base) {
      return;
    }
    current = base;
    since = clockStart ?? Date.now();
    lastCtx = ctx;
    stopTimer();
    ctx.ui.setWorkingMessage(label(base));
    ensureTimer();
  };

  const reset = (ctx: ExtensionContext): void => {
    stopTimer();
    names.clear();
    starts.clear();
    if (current === undefined) {
      return;
    }
    current = undefined;
    since = 0;
    ctx.ui.setWorkingMessage();
  };

  pi.on("agent_start", (_event, ctx) => setStatus(ctx, WAITING));
  pi.on("before_provider_request", (_event, ctx) => setStatus(ctx, WAITING));
  pi.on("message_start", (event, ctx) => {
    if (event.message.role === "assistant") {
      setStatus(ctx, GENERATING);
    }
  });
  pi.on("tool_execution_start", (event, ctx) => {
    names.set(event.toolCallId, event.toolName);
    starts.set(event.toolCallId, Date.now());
    setStatus(ctx, `执行工具 ${event.toolName}`, starts.get(event.toolCallId));
  });
  pi.on("tool_execution_end", (event, ctx) => {
    starts.delete(event.toolCallId);
    names.delete(event.toolCallId);
    const parentId = event.parentToolCallId;
    if (parentId === undefined) {
      return;
    }
    const parentName = names.get(parentId);
    if (parentName !== undefined) {
      setStatus(ctx, `执行工具 ${parentName}`, starts.get(parentId));
    }
  });
  pi.on("agent_end", (_event, ctx) => reset(ctx));
  pi.on("session_shutdown", () => stopTimer());
}
