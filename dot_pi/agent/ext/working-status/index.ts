/**
 * Working 状态扩展（working-status）
 *
 * 目标：把 pi 流式期间的 Working 指示行从静态 "Working" 改为随 agent
 * 生命周期切换的中文状态文案，全状态带持续计时（转圈动画帧沿用内置
 * 默认，不附中断键提示）：
 *   等待模型响应（3s） / 生成中（12s） / 执行工具 bash（2s）
 *
 * 状态机（事件驱动，基础文案相同不重复设置）：
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
  const parents = new Map<string, string>();

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

  const setStatus = (ctx: ExtensionContext, base: string): void => {
    if (current === base) {
      return;
    }
    current = base;
    since = Date.now();
    lastCtx = ctx;
    ctx.ui.setWorkingMessage(label(base));
    ensureTimer();
  };

  const reset = (ctx: ExtensionContext): void => {
    stopTimer();
    parents.clear();
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
    parents.set(event.toolCallId, event.toolName);
    setStatus(ctx, `执行工具 ${event.toolName}`);
  });
  pi.on("tool_execution_end", (event, ctx) => {
    parents.delete(event.toolCallId);
    const parentName = event.parentToolCallId ? parents.get(event.parentToolCallId) : undefined;
    if (parentName !== undefined) {
      setStatus(ctx, `执行工具 ${parentName}`);
    }
  });
  pi.on("agent_end", (_event, ctx) => reset(ctx));
  pi.on("session_shutdown", () => stopTimer());
}
