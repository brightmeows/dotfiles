/**
 * Working 状态扩展（working-status）
 *
 * 目标：把 pi 流式期间的 Working 指示行从静态 "Working" 改为随 agent
 * 生命周期切换的中文状态文案，全状态带持续计时（转圈动画帧沿用内置
 * 默认，不附中断键提示），状态样例：
 *   等待模型响应（3s） / 发送请求 36 KB（2s） / 发送请求 36 KB · 重试1（2s）
 *   生成中（12s） / 执行工具 bash（2s）
 *
 * 状态机（事件驱动，文案相同不重复设置）：
 *   before_agent_start                       → 重试计数清零（仅真实新 run 触发）
 *   agent_start                              → 等待模型响应（run 启动与组装并入）
 *   before_provider_request                  → 发送请求 <大小>（失败过则附重试序号）
 *   message_start（assistant 且非 error）    → 生成中，重试计数清零
 *   message_end（assistant stopReason=error）→ 重试计数 +1，不切状态
 *   tool_execution_start                     → 执行工具 <toolName>
 *   tool_execution_end                       → 嵌套调用回退父工具名，顶层保持
 *   agent_end                                → 复位为内置默认文案
 *
 * 计时：每次状态切换重置秒表（显示当前状态的持续秒数），interval 每秒
 * 刷新且每次切换重建（tick 落在 since+k 秒整点），前 1 秒内显示（1s）
 * 避免（0s）；秒表仅状态活跃时运行。
 *
 * 实测事实（pi 1.4.0，tmux 捕帧 + 本地 500/SSE 服务器）：
 * - after_provider_response 仅在响应成功到达时触发；500 等错误路径不触发，
 *   错误以 stopReason="error" + errorMessage 的合成 assistant 消息送达
 *   （message_start/message_end 均携带）——重试计数挂 message_end，
 *   顺带覆盖流中途出错（message_start 时 stopReason 还是 pending）的情形
 * - 重试退避窗口（Retrying (1/3) in 2s...）由内置指示器整体接管，
 *   本扩展文案被替换；重试序号改挂在下一次请求的文案上可见
 * - provider 层重试表现为 agent_end → agent_start 的新 agent run
 *   （turnIndex 重置为 0，无 before_agent_start）——计数清零挂
 *   before_agent_start，跨重试 run 延续
 * - 请求 payload 为对象，大小按 JSON 序列化字节数估算（KB 向上取整）
 * - ui_prompt_start/end 与“等待确认”态经实测放弃：阻塞式对话框会整块
 *   替换指示行所在区域（文本不可能可见），且 pi 默认不对工具调用弹审批
 *   （security.md），预期的触发面不存在——工具卡死与用户操作的区分
 *   改由对话框自身可见性承担
 *
 * 设计说明：
 * - 请求段不细分“上传中”：HTTP 客户端事件面不存在上传结束钩子，
 *   before_provider_request 到 after_provider_response 之间是连接+上传+
 *   服务器排队+模型 prefill 的整体；KB 大且久偏上行/代理，KB 小且久偏
 *   模型端，以大小为人工判据，不硬造不可观测的状态
 * - 工具计时按调用者计：start 记录各 callId 真实起点，显示谁用谁的起点
 *   ——嵌套子工具用子起点，回退父工具恢复父真实耗时；相邻同名调用
 *   callId 不同，计时各自重置（旧实现按文案判重会跨调用累加）
 * - 等待确认态已实测放弃（见实测事实节），无需处理 ui_prompt；
 * - retry / compaction / branchSummary 阶段由内置指示器整体接管，
 *   本扩展不干预；agent_end 复位保证下一轮干净
 * - message_start 对 user/toolResult 消息也触发，仅 assistant 处理；
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
const KB = 1024;
const MB = KB * 1024;

const TIMER_KEY = Symbol.for("pi-meow-working-status:timer");

const fmtSize = (bytes: number): string =>
  bytes < MB ? `${Math.ceil(bytes / KB)} KB` : `${(bytes / MB).toFixed(1)} MB`;

const payloadSize = (payload: unknown): number => {
  try {
    if (typeof payload === "string") {
      return payload.length;
    }
    if (payload !== null && typeof payload === "object") {
      return JSON.stringify(payload).length;
    }
  } catch {
    // 序列化失败按无大小处理
  }
  return 0;
};

interface Ticker {
  show: (ctx: ExtensionContext, base: string, clockStart?: number) => void;
  clear: (ctx: ExtensionContext) => void;
}

const createTicker = (): Ticker => {
  let current: string | undefined;
  let since = 0;
  let lastCtx: ExtensionContext | undefined;

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

  return {
    show: (ctx, base, clockStart) => {
      if (current === base) {
        return;
      }
      current = base;
      since = clockStart ?? Date.now();
      lastCtx = ctx;
      stopTimer();
      ctx.ui.setWorkingMessage(label(base));
      ensureTimer();
    },
    clear: (ctx) => {
      stopTimer();
      if (current === undefined) {
        return;
      }
      current = undefined;
      since = 0;
      ctx.ui.setWorkingMessage();
    },
  };
};

export default function workingStatus(pi: ExtensionAPI): void {
  const ticker = createTicker();
  const names = new Map<string, string>();
  const starts = new Map<string, number>();
  let failedAttempts = 0;

  pi.on("before_agent_start", (_event, _ctx) => {
    // 仅真实新 run（用户提示/自定义消息）清零。Provider 层重试走的
    // 是 agent_end → agent_start 的新 agent run，不触发本事件，计数延续
    failedAttempts = 0;
  });
  pi.on("agent_start", (_event, ctx) => {
    ticker.show(ctx, WAITING);
  });
  pi.on("before_provider_request", (event, ctx) => {
    const bytes = payloadSize(event.payload);
    const size = bytes > 0 ? ` ${fmtSize(bytes)}` : "";
    const retry = failedAttempts > 0 ? ` · 重试${failedAttempts}` : "";
    ticker.show(ctx, `发送请求${size}${retry}`);
  });
  pi.on("message_start", (event, ctx) => {
    if (event.message.role !== "assistant") {
      return;
    }
    const { stopReason } = event.message as { stopReason?: string };
    if (stopReason === "error") {
      return;
    }
    failedAttempts = 0;
    ticker.show(ctx, GENERATING);
  });
  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant") {
      return;
    }
    const { stopReason } = event.message as { stopReason?: string };
    if (stopReason === "error") {
      failedAttempts += 1;
    }
  });
  pi.on("tool_execution_start", (event, ctx) => {
    names.set(event.toolCallId, event.toolName);
    starts.set(event.toolCallId, Date.now());
    ticker.show(ctx, `执行工具 ${event.toolName}`, starts.get(event.toolCallId));
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
      ticker.show(ctx, `执行工具 ${parentName}`, starts.get(parentId));
    }
  });
  pi.on("agent_end", (_event, ctx) => {
    // 重试紧随 agent_end 而来，此处清零计数会让下一次请求丢掉重试序号；
    // 计数清零只挂 before_agent_start
    names.clear();
    starts.clear();
    ticker.clear(ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => ticker.clear(ctx));
}
